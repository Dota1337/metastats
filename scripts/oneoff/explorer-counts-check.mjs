// Gegenrechnung der Brett-Zaehler (scripts/lib/explorer-counts.mjs): SQL-Fassung
// gegen JS-Fassung an echten Rohzeilen, dazu Zeiten wie im Bau (threads 1,
// 900 MB) und der Build-Schluessel. Liest Postgres nur, schreibt nur in eine
// eigene Arbeitsdatei.
//
// Aufruf auf der Box (Env aus /etc/metastats-crawler/env):
//   node scripts/oneoff/explorer-counts-check.mjs --dir=/mnt/HC_Volume_105869432/mcounts --n=200000
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  COUNT_COLS, COUNT_KEYS, TRAITS_JSON_TYPE, UNITS_JSON_TYPE, boardCounts, buildKeyJs, buildKeySql, countsLists, countsSelectSql,
  unitIdSql,
} from '../lib/explorer-counts.mjs';
import { componentsFromBundle } from '../lib/explorer-components.mjs';
import { compListSql } from '../lib/explorer-agg.mjs';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DIR = arg('dir', '/mnt/HC_Volume_105869432/mcounts');
const N = Number(arg('n', '200000'));
const SET = Number(arg('set', '18'));
const CACHE = arg('cache', null);
const DUCK = arg('duckdb', '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');

const bundle = JSON.parse(fs.readFileSync(path.join(ROOT, `public/tft-assets-${SET}.json`), 'utf8'));
const L = countsLists(bundle);
const comps = componentsFromBundle(bundle);
const { DuckDBInstance } = await import(pathToFileURL(DUCK).href);
fs.rmSync(DIR, { recursive: true, force: true });
fs.mkdirSync(`${DIR}/spill`, { recursive: true });
const db = await DuckDBInstance.create(`${DIR}/check.duckdb`);
const c = await db.connect();
const log = (...a) => console.log(`[counts-check ${new Date().toISOString().slice(11, 19)}]`, ...a);
const J = (v) => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? Number(x) : x));
const all = async (sql) => (await c.runAndReadAll(sql)).getRowObjectsJS();
async function t(label, sql) {
  const t0 = Date.now();
  const r = await all(sql);
  log(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return r;
}
let bad = 0;
try {
  for (const s of [`SET memory_limit='900MB'`, 'SET threads=1', 'SET preserve_insertion_order=false', `SET temp_directory='${DIR}/spill'`,
    `SET extension_directory='${path.join(path.dirname(DIR), 'explorer/ext')}'`, 'INSTALL postgres', 'LOAD postgres',
    `ATTACH '${process.env.DATABASE_URL.replace(/'/g, "''")}' AS pg (TYPE postgres, READ_ONLY)`]) await c.run(s);
  const since = Date.now() - 2 * 86_400_000;
  const pgSql = `select match_id, puuid, game_datetime, units::text as units, traits::text as traits from tft_player_match_cache
    where set_number = ${SET} and queue_id = 1100 and game_datetime >= ${since} limit ${N}`;
  // --cache=<datei.parquet>: Stichprobe einmal holen und wiederverwenden (Postgres-Lesen ~3 min).
  if (CACHE && fs.existsSync(CACHE)) await t('Rohzeilen (Cache)', `CREATE TABLE raw AS SELECT * FROM read_parquet('${CACHE}')`);
  else {
    await t('Rohzeilen', `CREATE TABLE raw AS SELECT (row_number() OVER ())::UINTEGER AS bid, * FROM postgres_query('pg', '${pgSql.replace(/'/g, "''")}')`);
    if (CACHE) await c.run(`COPY raw TO '${CACHE}' (FORMAT parquet)`);
  }
  await c.run('DETACH pg');
  await t('zerlegen + Zaehler (wie b0)', `CREATE TABLE cnt AS ${countsSelectSql(
    `(SELECT bid, from_json(units, ${UNITS_JSON_TYPE}) AS ul, from_json(traits, ${TRAITS_JSON_TYPE}) AS tl FROM raw)`, L)}`);
  await t('nu aus ul + Build-Schluessel', `CREATE TABLE nu AS SELECT bid, ${unitIdSql('u.characterId', L.aliases)} AS unit,
    u.items[1] AS i1, u.items[2] AS i2, u.items[3] AS i3, ${buildKeySql('u.items[1]', 'u.items[2]', 'u.items[3]', compListSql(comps))} AS bk
    FROM (SELECT bid, unnest(ul) AS u FROM cnt) WHERE u.characterId IS NOT NULL`);
  const nulls = await all(`SELECT ${Object.values(COUNT_COLS).map(col => `count(*) - count(${col}) AS ${col}`).join(', ')}, count(*) - count(tags) AS tags FROM cnt`);
  const nNull = Object.values(nulls[0]).reduce((a, b) => a + Number(b), 0);
  log(`NULL in Zaehlern: ${nNull}`);
  if (nNull) bad++;
  // JS gegen SQL, je Brett.
  const diff = Object.fromEntries([...COUNT_KEYS, 'tags'].map(k => [k, 0]));
  const ex = [];
  let n = 0;
  let bkDiff = 0;
  let bkN = 0;
  const cols = [...COUNT_KEYS.map(k => `c.${COUNT_COLS[k]} AS ${k}`), 'c.tags AS tags'].join(', ');
  for (let lo = 1; lo <= N; lo += 20_000) {
    const rows = await all(`SELECT r.bid, r.units, r.traits, ${cols} FROM raw r JOIN cnt c USING (bid) WHERE r.bid BETWEEN ${lo} AND ${lo + 19_999}`);
    for (const r of rows) {
      n++;
      const want = boardCounts(JSON.parse(r.units ?? 'null'), JSON.parse(r.traits ?? 'null'), L);
      for (const k of Object.keys(diff)) {
        if (Number(r[k]) !== want[k]) { diff[k]++; if (ex.length < 8) ex.push({ bid: r.bid, k, sql: Number(r[k]), js: want[k] }); }
      }
    }
    const us = await all(`SELECT r.units, list(n.bk ORDER BY n.rowid) AS bks FROM raw r JOIN nu n USING (bid)
      WHERE r.bid BETWEEN ${lo} AND ${lo + 1999} GROUP BY r.bid, r.units`);
    for (const r of us) {
      const units = (JSON.parse(r.units ?? '[]') || []).filter(u => u && u.characterId != null);
      const want = units.map(u => buildKeyJs(u.items, comps)).sort((a, b) => String(a).localeCompare(String(b)));
      const got = [...r.bks].sort((a, b) => String(a).localeCompare(String(b)));
      bkN++;
      if (JSON.stringify(want) !== JSON.stringify(got)) bkDiff++;
    }
  }
  log(`Bretter ${n}, Abweichungen je Zaehler ${J(diff)}${ex.length ? `, Beispiele ${J(ex)}` : ''}`);
  log(`Build-Schluessel: ${bkN} Bretter geprueft, ${bkDiff} abweichend`);
  if (Object.values(diff).some(Boolean) || bkDiff) bad++;
  const dist = await all(`SELECT ${COUNT_KEYS.map(k => `round(avg(${COUNT_COLS[k]}), 3)::DOUBLE AS ${k}`).join(', ')},
    round(count(*) FILTER (WHERE c_extra = 0) / count(*), 4)::DOUBLE AS extra0 FROM cnt`);
  log(`Mittelwerte ${J(dist[0])}`);
} finally {
  c.closeSync?.();
  db.closeSync?.();
  fs.rmSync(DIR, { recursive: true, force: true });
}
log(bad ? 'ABWEICHUNG' : 'GLEICH');
process.exit(bad ? 1 : 0);

#!/usr/bin/env node
// Baut den Analyse-Speicher fuer den TFT Data Explorer (/tft/explorer).
//
// Liest die Set-Partien der letzten N Tage aus der lokalen Postgres der Box
// (tft_player_match_cache) und legt sie flach in eine DuckDB-Datei:
//   boards  — eine Zeile je Spieler-Board (Platz, Level, Runde, Gold, Patch, Region, Rang, Comp-Familie)
//   units   — eine Zeile je Unit auf dem Board (Stern, Items)
//   traits  — eine Zeile je aktivem Trait (Stufe, Anzahl, Ueberfuellung)
//   meta    — Datenstand
//
// Warum Vollbuild statt Delta: die Tabelle hat keinen Index auf Zeit oder
// fetched_at (47 GB, nur PK + (set_number, region)). Ein Delta muesste ohnehin
// alle Set-Zeilen lesen; ein Index auf der laufenden Sammler-Tabelle ist das
// groessere Risiko. Gemessen 2026-09-28: Vollscan ~2 min.
//
// Trait-Stufe: Riots `tier_current` (nicht `style` — Elderwood 7 und 9 haben
// beide style 5). Ueberfuellung = num_units − minUnits der aktiven Stufe aus
// dem Asset-Bundle; bei Traits mit nur einer Stufe NULL.
//
// Patch je Tag: Supabase-RPC get_tft_available_patches (Service-Key), Rueckfall
// public/tft-set.json patchCuts. Ohne beides: Abbruch, alte Datei bleibt.
// Rang: naechster Eintrag desselben Spielers innerhalb ±3 Tagen aus
// Marktwert-Snapshot (Diamant+) oder Rangliste tft_ladder_daily (Emerald+),
// bei Gleichstand der fruehere. Die Rangliste haelt nur 10 Tage — deshalb
// sichert jeder Build den Rang je Board in board_rank, der naechste Build
// uebernimmt ihn, wenn die Quelle weg ist. Sonst NULL (in der UI ausgeblendet).
//
// Datei-Tausch: Build in <out>.tmp, CHECKPOINT, schliessen, rename. Bei Fehler
// bleibt die alte Datei unangetastet. Doppellauf verhindert die Unit per flock.
//
// Aufruf: node scripts/build-explorer-store.mjs [--out=/pfad/explorer.duckdb]
//         [--days=45] [--set=18] [--limit=N (nur Test)]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
};

const OUT = arg('out', process.env.EXPLORER_DB_PATH || '/mnt/HC_Volume_105869432/explorer/explorer.duckdb');
const DAYS = Number(arg('days', '45'));
const LIMIT = Number(arg('limit', '0'));
const DUCKDB_MODULE = process.env.EXPLORER_DUCKDB_MODULE
  || '/opt/metastats-explorer/node_modules/@duckdb/node-api/lib/index.js';
const QUEUE_RANKED = 1100;

function log(...a) { console.log(`[explorer-build ${new Date().toISOString()}]`, ...a); }

function readSetNumber() {
  const override = arg('set', null);
  if (override) return Number(override);
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/tft-set.json'), 'utf8'));
  const n = Number(j.setNumber);
  if (!Number.isInteger(n) || n < 1) throw new Error('tft-set.json: Set-Nummer nicht lesbar');
  return n;
}

// Stufen-Schwellen je Trait aus dem Asset-Bundle. Nur Traits mit >1 Stufe
// bekommen eine Ueberfuellung; einstufige (UniqueTrait, Solar …) nicht.
function readTraitThresholds(setNumber) {
  const p = path.join(ROOT, `public/tft-assets-${setNumber}.json`);
  const a = JSON.parse(fs.readFileSync(p, 'utf8'));
  const rows = [];
  for (const [id, t] of Object.entries(a.traits || {})) {
    const mins = (t.tiers || []).map((x) => Number(x.minUnits)).filter(Number.isFinite);
    mins.forEach((m, i) => rows.push({ id, lvl: i + 1, min: m, tiers: mins.length }));
  }
  if (!rows.length) throw new Error(`${p}: keine Trait-Stufen`);
  return rows;
}

// Abweichende Riot-Kennungen (`aliasOf` im Bundle, z. B. TFT18_Akali →
// DA_18_Akali_AD). Die Auswahlliste zeigt nur die Quelle; ohne Umschreiben
// waeren die Spiele unter der alten Kennung im Explorer nicht erreichbar.
function readUnitAliases(setNumber) {
  const a = JSON.parse(fs.readFileSync(path.join(ROOT, `public/tft-assets-${setNumber}.json`), 'utf8'));
  return Object.entries(a.champions || {})
    .filter(([, c]) => typeof c?.aliasOf === 'string')
    .map(([id, c]) => [id, c.aliasOf]);
}

const RANGE_CACHE = path.join(path.dirname(OUT), 'patch-ranges.json');

// Der juengste Patch endet bei Supabase am letzten Aggregat-Tag (meist
// gestern); nach vorn offen, sonst fehlt der heutige Tag.
function openNewest(ranges) {
  const newest = ranges.reduce((a, b) => (b.from > a.from ? b : a));
  newest.to = '2999-12-31';
  return ranges;
}

// Roh-Bereiche (echtes last_day) je Set, nur fuer den Rueckfall. Ein Fehler
// beim Schreiben bricht den Build nicht ab.
function writeRangeCache(setNumber, ranges) {
  try {
    const tmp = `${RANGE_CACHE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ set: setNumber, savedAt: new Date().toISOString(), ranges }));
    fs.renameSync(tmp, RANGE_CACHE);
  } catch (e) {
    log('Patch-Cache nicht geschrieben', e.message);
  }
}

function readRangeCache(setNumber) {
  try {
    const c = JSON.parse(fs.readFileSync(RANGE_CACHE, 'utf8'));
    if (Number(c.set) === setNumber && Array.isArray(c.ranges) && c.ranges.length) return c;
  } catch { /* kein Cache */ }
  return null;
}

// Patch-Bereiche [{patch, from, to}] fuer das Set. Tage, die in zwei Bereichen
// liegen, markiert der Build als Wechseltag.
async function readPatchRanges(setNumber) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/get_tft_available_patches`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_days: DAYS + 10 }),
        signal: AbortSignal.timeout(20_000),
      });
      if (res.ok) {
        const rows = (await res.json()).filter((r) => Number(r.set_number) === setNumber && r.patch);
        if (rows.length) {
          const ranges = rows.map((r) => ({ patch: r.patch, from: r.first_day, to: r.last_day }));
          writeRangeCache(setNumber, ranges);
          return { source: 'supabase', ranges: openNewest(ranges) };
        }
      } else {
        log('Patch-RPC HTTP', res.status);
      }
    } catch (e) {
      log('Patch-RPC Fehler', e.message);
    }
  }
  // Rueckfall 1: die zuletzt von Supabase gelesenen Bereiche (echte Tage je
  // Patch), ergaenzt um Schnitte, die danach dazukamen. patchCuts allein kennen
  // den Starttag eines Basis-Patches nicht — bei mehreren Schnitten landeten
  // z. B. die 18.2-Tage sonst unter 18.1b.
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/tft-set.json'), 'utf8'));
  const cuts = (j.patchCuts || []).filter((c) => Number(c.set) === setNumber && c.from_day);
  const cache = readRangeCache(setNumber);
  if (cache) {
    const ranges = cache.ranges.map((r) => ({ ...r }));
    for (const c of [...cuts].sort((a, b) => a.from_day.localeCompare(b.from_day))) {
      const newestFrom = ranges.reduce((m, r) => (r.from > m ? r.from : m), '');
      if (c.from_day <= newestFrom || ranges.some((r) => r.patch === c.patch)) continue;
      // Vorherige Bereiche am Schnitt schliessen (ein Tag Ueberlappung =
      // Wechseltag), sonst traegt jeder spaetere Tag zwei Patches.
      for (const r of ranges) if (r.to > c.from_day) r.to = c.from_day;
      ranges.push({ patch: c.patch, from: c.from_day, to: c.from_day });
    }
    return { source: `Cache vom ${cache.savedAt}`, ranges: openNewest(ranges) };
  }
  // Rueckfall 2: ohne Cache nur patchCuts. Bei mehr als einem Schnitt fehlen
  // die Basis-Tage dazwischen — dann lieber abbrechen, alte Datei bleibt.
  if (cuts.length > 1) throw new Error('Patch-RPC aus, kein Cache und mehrere B-Patches — Abbruch, alte Datei bleibt');
  if (cuts.length) {
    cuts.sort((a, b) => a.from_day.localeCompare(b.from_day));
    const ranges = [];
    if (j.setStartDate && j.setStartDate < cuts[0].from_day) ranges.push({ patch: cuts[0].base, from: j.setStartDate, to: null });
    cuts.forEach((c) => ranges.push({ patch: c.patch, from: c.from_day, to: null }));
    for (let i = 0; i < ranges.length - 1; i++) ranges[i].to = ranges[i + 1].from;
    ranges[ranges.length - 1].to = '2999-12-31';
    return { source: 'tft-set.json', ranges };
  }
  throw new Error('keine Patch-Quelle erreichbar — Abbruch, alte Datei bleibt');
}

const sqlStr = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL fehlt');
  const setNumber = readSetNumber();
  const thresholds = readTraitThresholds(setNumber);
  const aliases = readUnitAliases(setNumber);
  const patches = await readPatchRanges(setNumber);
  log(`Set ${setNumber}, ${DAYS} Tage, Patch-Quelle ${patches.source} (${patches.ranges.length} Bereiche), Ziel ${OUT}`);

  const { DuckDBInstance } = await import(DUCKDB_MODULE);
  const dir = path.dirname(OUT);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${OUT}.tmp`;
  // Arbeitsdatei fuer Rohdaten + Zwischenschritte (5 GB Text passen nicht in
  // den RAM). Die fertigen Tabellen werden am Ende sortiert in eine frische,
  // kompakte Datei kopiert; die Arbeitsdatei wird geloescht.
  const work = path.join(dir, 'work.duckdb');
  const cleanup = () => { for (const f of [tmp, `${tmp}.wal`, work, `${work}.wal`]) fs.rmSync(f, { force: true }); };
  cleanup();

  const t0 = Date.now();
  const db = await DuckDBInstance.create(work);
  const c = await db.connect();
  let tStep = Date.now();
  const run = async (s) => {
    const r = await c.run(s);
    const m = /^\s*CREATE (?:TEMP )?TABLE ([\w.]+)/.exec(s);
    if (m) { log(`  ${m[1]} ${((Date.now() - tStep) / 1000).toFixed(1)} s`); }
    tStep = Date.now();
    return r;
  };
  const one = async (s) => (await c.runAndReadAll(s)).getRowObjects()[0];

  await run(`SET memory_limit='900MB'`);
  await run(`SET threads=1`);
  await run(`SET preserve_insertion_order=false`);
  await run(`SET temp_directory=${sqlStr(path.join(dir, 'tmp'))}`);
  await run(`SET extension_directory=${sqlStr(path.join(dir, 'ext'))}`);
  await run(`INSTALL postgres; LOAD postgres;`);
  await run(`ATTACH ${sqlStr(process.env.DATABASE_URL)} AS pg (TYPE postgres, READ_ONLY)`);

  // 1) Rohdaten in einem einzigen Lauf holen. jsonb kommt als Text und wird in
  //    DuckDB zerlegt — Postgres macht nur den Scan.
  const sinceMs = Date.now() - DAYS * 86_400_000;
  const pgSql = `select match_id, puuid, game_datetime, placement, level, last_round, gold_left, total_damage,
      comp_cluster_key, units::text as units, traits::text as traits
    from tft_player_match_cache
    where set_number = ${setNumber} and queue_id = ${QUEUE_RANKED} and game_datetime >= ${sinceMs}
    ${LIMIT ? `limit ${LIMIT}` : ''}`;
  await run(`CREATE TABLE raw AS SELECT * FROM postgres_query('pg', ${sqlStr(pgSql)})`);
  const rawN = Number((await one('SELECT count(*) n FROM raw')).n);
  log(`Rohdaten: ${rawN} Boards in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  if (rawN === 0) throw new Error('0 Boards gelesen — Abbruch, alte Datei bleibt');

  const snapSql = `select puuid, snapshot_date, tier from tft_player_marketvalue_snapshots
    where set_number = ${setNumber} and tier in ('DIAMOND','MASTER','GRANDMASTER','CHALLENGER')`;
  await run(`CREATE TABLE snaps AS SELECT * FROM postgres_query('pg', ${sqlStr(snapSql)})`);
  // Rangliste (Emerald+, taeglich 04:30) als zweite Rang-Quelle. Sie wird nach
  // 10 Tagen geloescht — deshalb wird der Rang je Board unten gesichert.
  const ladderSql = `select puuid, day, tier from tft_ladder_daily
    where set_number = ${setNumber} and tier in ('EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER')`;
  await run(`CREATE TABLE ladder AS SELECT * FROM postgres_query('pg', ${sqlStr(ladderSql)})`);
  await run(`DETACH pg`);
  await run(`CREATE TABLE obs AS
    SELECT puuid, snapshot_date::DATE AS day, tier FROM snaps
    UNION ALL SELECT puuid, day::DATE, tier FROM ladder`);
  await run(`DROP TABLE snaps`);
  await run(`DROP TABLE ladder`);

  // Rang aus dem vorigen Build: Boards, deren Rang-Quelle inzwischen geloescht
  // ist, behalten ihn. Schluessel = md5 aus Partie + Spieler (stabil ueber Builds).
  let prevRanks = false;
  if (fs.existsSync(OUT)) {
    try {
      await run(`ATTACH ${sqlStr(OUT)} AS prev (READ_ONLY)`);
      const has = await one(`SELECT count(*) n FROM duckdb_tables() WHERE database_name = 'prev' AND table_name = 'board_rank'`);
      if (Number(has.n) > 0) {
        await run(`CREATE TABLE prev_rank AS SELECT * FROM prev.board_rank`);
        prevRanks = true;
      }
      await run(`DETACH prev`);
    } catch (e) {
      log(`vorige Raenge nicht lesbar (${e.message}) — ohne Uebernahme weiter`);
    }
  }
  if (!prevRanks) await run(`CREATE TABLE prev_rank(k UBIGINT, rank VARCHAR)`);

  // 2) Hilfstabellen: Patch je Tag, Trait-Schwellen.
  await run(`CREATE TABLE patch_ranges(patch VARCHAR, d_from DATE, d_to DATE)`);
  for (const r of patches.ranges) {
    await run(`INSERT INTO patch_ranges VALUES (${sqlStr(r.patch)}, ${sqlStr(r.from)}::DATE, ${sqlStr(r.to)}::DATE)`);
  }
  await run(`CREATE TABLE trait_min(trait VARCHAR, lvl UTINYINT, min_units UTINYINT, tiers UTINYINT)`);
  const vals = thresholds.map((t) => `(${sqlStr(t.id)}, ${t.lvl}, ${t.min}, ${t.tiers})`).join(',');
  await run(`INSERT INTO trait_min VALUES ${vals}`);

  // 3) boards. bid = fortlaufende Board-Nummer, mid = Partie-Nummer (fuer den
  //    Vertrauensbereich je Partie, weil ~2,5 unserer Spieler je Lobby sitzen).
  await run(`CREATE TABLE b0 AS
    SELECT row_number() OVER ()::UINTEGER AS bid, *,
      CAST(to_timestamp(game_datetime / 1000) AT TIME ZONE 'UTC' AS DATE) AS day,
      md5_number_upper(match_id || puuid) AS rk_key
    FROM raw`);
  await run(`DROP TABLE raw`);

  await run(`CREATE TABLE boards AS
    WITH day_patch AS (
      SELECT d.day, arg_max(p.patch, p.d_from) AS patch, count(p.patch) > 1 AS patch_edge
      FROM (SELECT DISTINCT day FROM b0) d
      LEFT JOIN patch_ranges p ON d.day BETWEEN p.d_from AND p.d_to
      GROUP BY d.day
    ),
    -- Naechster Eintrag aus Snapshot + Rangliste binnen ±3 Tagen, bei
    -- Gleichstand der fruehere (Stand vor der Partie). Erst je Spieler+Tag,
    -- dann an die Boards — spart den Join ueber alle Boards.
    pd AS (
      SELECT p.puuid, p.day,
        arg_min(o.tier, abs(date_diff('day', o.day, p.day)) * 2 + CASE WHEN o.day > p.day THEN 1 ELSE 0 END) AS rank
      FROM (SELECT DISTINCT puuid, day FROM b0) p
      JOIN obs o ON o.puuid = p.puuid AND o.day BETWEEN p.day - INTERVAL 3 DAY AND p.day + INTERVAL 3 DAY
      GROUP BY p.puuid, p.day
    ),
    rk AS (
      SELECT b.bid, b.rk_key, coalesce(pd.rank, pr.rank) AS rank
      FROM b0 b
      LEFT JOIN pd ON pd.puuid = b.puuid AND pd.day = b.day
      LEFT JOIN prev_rank pr ON pr.k = b.rk_key
    ),
    mids AS (SELECT match_id, (row_number() OVER ())::UINTEGER AS mid FROM (SELECT DISTINCT match_id FROM b0))
    SELECT b.bid, m.mid, b.day, dp.patch, coalesce(dp.patch_edge, false) AS patch_edge,
      lower(regexp_extract(b.match_id, '^([A-Za-z0-9]+)_', 1)) AS region,
      rk.rank,
      b.placement::UTINYINT AS placement, b.level::UTINYINT AS level, b.last_round::USMALLINT AS last_round,
      b.gold_left::SMALLINT AS gold_left, b.total_damage::USMALLINT AS damage,
      b.comp_cluster_key AS comp_key,
      CASE WHEN regexp_matches(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)')
        THEN regexp_extract(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)', 1) || '__' || regexp_extract(b.comp_cluster_key, '^(.+)@(\\d+)_([^#*~]+)', 3)
        ELSE b.comp_cluster_key END AS family
    FROM b0 b
    JOIN mids m USING (match_id)
    LEFT JOIN day_patch dp USING (day)
    LEFT JOIN rk USING (bid)`);

  // 4) units: characterId, Stern, bis zu 3 Items. Alias-Kennungen werden auf
  //    ihre Quelle umgeschrieben (readUnitAliases).
  const unitExpr = aliases.length
    ? `CASE u->>'characterId' ${aliases.map(([id, src]) => `WHEN ${sqlStr(id)} THEN ${sqlStr(src)}`).join(' ')} ELSE u->>'characterId' END`
    : `u->>'characterId'`;
  await run(`CREATE TABLE units AS
    SELECT bid, ${unitExpr} AS unit, (u->>'tier')::UTINYINT AS star,
      json_array_length(u->'items')::UTINYINT AS n_items,
      u->'items'->>0 AS i1, u->'items'->>1 AS i2, u->'items'->>2 AS i3
    FROM (SELECT bid, unnest(json_extract(units::JSON, '$[*]')) AS u FROM b0)
    WHERE u->>'characterId' IS NOT NULL`);

  // 5) traits: nur aktive (tier_current > 0, num_units > 0).
  await run(`CREATE TABLE traits AS
    WITH t AS (
      SELECT bid, x->>'name' AS trait, (x->>'tier_current')::UTINYINT AS lvl, (x->>'num_units')::UTINYINT AS num_units
      FROM (SELECT bid, unnest(json_extract(traits::JSON, '$[*]')) AS x FROM b0)
    )
    SELECT t.bid, t.trait, t.lvl, t.num_units,
      CASE WHEN tm.tiers > 1 THEN (t.num_units::TINYINT - tm.min_units::TINYINT) END AS overcap
    FROM t LEFT JOIN trait_min tm ON tm.trait = t.trait AND tm.lvl = t.lvl
    WHERE t.lvl > 0 AND t.num_units > 0`);
  await run(`CREATE TABLE board_rank AS
    SELECT b.rk_key AS k, bo.rank FROM b0 b JOIN boards bo USING (bid) WHERE bo.rank IS NOT NULL`);
  await run(`DROP TABLE b0`);

  const stats = await one(`SELECT (SELECT count(*) FROM boards) boards, (SELECT count(DISTINCT mid) FROM boards) matches,
    (SELECT count(*) FROM units) units, (SELECT count(*) FROM traits) traits,
    (SELECT count(*) FROM boards WHERE rank IS NOT NULL) ranked,
    (SELECT count(*) FROM boards WHERE patch IS NULL) no_patch,
    (SELECT max(day) FROM boards) max_day, (SELECT min(day) FROM boards) min_day`);
  const nNoTraitMin = Number((await one(`SELECT count(*) n FROM traits t WHERE NOT EXISTS
    (SELECT 1 FROM trait_min m WHERE m.trait = t.trait)`)).n);

  await run(`CREATE TABLE meta AS SELECT
    now() AS built_at, ${setNumber}::INTEGER AS set_number, ${DAYS}::INTEGER AS days,
    ${sqlStr(patches.source)} AS patch_source,
    ${Number(stats.boards)}::BIGINT AS boards, ${Number(stats.matches)}::BIGINT AS matches,
    ${sqlStr(String(stats.min_day))}::DATE AS min_day, ${sqlStr(String(stats.max_day))}::DATE AS max_day`);

  // Plausibilitaet vor dem Tausch: Boards je Partie muss >=1 und <=8 sein.
  const perMatch = Number(stats.boards) / Math.max(1, Number(stats.matches));
  if (!(perMatch >= 1 && perMatch <= 8)) throw new Error(`Boards je Partie ${perMatch} unplausibel — kein Tausch`);

  // Sortiert kopieren: units nach Unit, traits nach Trait — Filter "mit Unit X"
  // lesen dann nur die passenden Bloecke.
  await run(`ATTACH ${sqlStr(tmp)} AS outdb`);
  await run(`CREATE TABLE outdb.boards AS SELECT * FROM boards ORDER BY bid`);
  await run(`CREATE TABLE outdb.units AS SELECT * FROM units ORDER BY unit, bid`);
  await run(`CREATE TABLE outdb.traits AS SELECT * FROM traits ORDER BY trait, bid`);
  await run(`CREATE TABLE outdb.meta AS SELECT * FROM meta`);
  await run(`CREATE TABLE outdb.board_rank AS SELECT * FROM board_rank`);
  await run(`CHECKPOINT outdb`);
  await run(`DETACH outdb`);
  c.closeSync?.();
  db.closeSync?.();

  fs.renameSync(tmp, OUT);
  for (const f of [`${tmp}.wal`, work, `${work}.wal`]) fs.rmSync(f, { force: true });
  const size = fs.statSync(OUT).size;
  // Datenstand fuer den Vertrag explorer/datei-frische (infra/contracts.json).
  const statusPath = path.join(path.dirname(OUT), 'status.json');
  fs.writeFileSync(`${statusPath}.tmp`, JSON.stringify({
    builtAt: new Date().toISOString(), setNumber, boards: Number(stats.boards), matches: Number(stats.matches),
    minDay: String(stats.min_day), maxDay: String(stats.max_day), bytes: size,
  }, null, 2));
  fs.renameSync(`${statusPath}.tmp`, statusPath);
  log(`fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${stats.boards} Boards / ${stats.matches} Partien / ${stats.units} Units / ${stats.traits} Traits,`
    + ` Rang bekannt ${stats.ranked}, ohne Patch ${stats.no_patch}, Traits ohne Bundle-Schwelle ${nNoTraitMin},`
    + ` ${stats.min_day}..${stats.max_day}, ${(size / 1e6).toFixed(0)} MB`);
}

main().catch((e) => {
  console.error(`[explorer-build] FEHLER: ${e.stack || e.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// Abgleich der Tages-Teilsummen (Paket 5b) gegen eine LOKALE Kopie der
// Explorer-Datei. Fasst die Quelle nie an: alles laeuft auf zwei Kopien im
// --tmp-Ordner.
//
//   B  Vollaufbau der Summen (Fenster ohne den ersten Tag)       → Pruefung (a)
//   A  "gestern": Kopie ohne die juengsten Boards, Raenge ab der Frost-Grenze
//      teils verfaelscht, Patch eines Tages verfaelscht; Summen voll gerechnet.
//      Dann "heute": juengste Boards dazu, Raenge + Patch zurueck, erster Tag
//      raus, Summen per Teil-Schritt nachgefuehrt.                → Pruefung (b)
//   (b) verlangt: A und B haben Zeile fuer Zeile dieselben Summen.
//
// Aufruf: node scripts/oneoff/explorer-agg-equality.mjs --duckdb=<.../node-api/lib/index.js>
//           --src=<explorer.duckdb> --tmp=<Ordner>
// Exit 0 = alles gleich, 1 = Abweichung oder Fehler.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { aggStep, aggChecks } from '../lib/explorer-agg-build.mjs';
import { compListSql } from '../lib/explorer-agg.mjs';
import { readComponents, componentsHash } from '../lib/explorer-components.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DUCK = arg('duckdb');
const SRC = arg('src');
const TMP = arg('tmp');
if (!DUCK || !SRC || !TMP) { console.error('--duckdb, --src und --tmp angeben'); process.exit(1); }
const fwd = (p) => p.split(path.sep).join('/');
const log = (...a) => console.log(`[agg-eq ${new Date().toISOString().slice(11, 19)}]`, ...a);
const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const { DuckDBInstance } = await import(pathToFileURL(DUCK).href);
fs.mkdirSync(TMP, { recursive: true });
const P = (f) => path.join(TMP, f);
for (const f of ['A.duckdb', 'B.duckdb', 'work.duckdb']) for (const x of [P(f), `${P(f)}.wal`]) fs.rmSync(x, { force: true });
fs.copyFileSync(SRC, P('A.duckdb'));
fs.copyFileSync(SRC, P('B.duckdb'));

const inst = await DuckDBInstance.create(P('work.duckdb'), {
  threads: '1', memory_limit: '900MB', preserve_insertion_order: 'false', temp_directory: fwd(P('spill')),
});
const c = await inst.connect();
const exec = (s) => c.run(s);
const all = async (s) => (await c.runAndReadAll(s)).getRowObjects();
const one = async (s) => (await all(s))[0];
await exec(`ATTACH '${fwd(SRC)}' AS src (READ_ONLY)`);

const setNumber = Number((await one('SELECT set_number::DOUBLE AS v FROM src.meta')).v);
const components = readComponents(ROOT, setNumber, log);
const compList = compListSql(components);
const compHash = componentsHash(components);
const st = await one(`SELECT min(day)::VARCHAR AS w, max(day)::VARCHAR AS n, max(bid)::DOUBLE AS mx,
  quantile_disc(bid, 0.97)::DOUBLE AS k FROM src.boards`);
const n = st.n;
const f = addDay(n, -7);
const w0 = st.w;
const w1 = addDay(w0, 1);
const K = Number(st.k);
const nextBid = Number(st.mx) + 1;
const days = (await all('SELECT DISTINCT day::VARCHAR AS d FROM src.boards ORDER BY 1')).map((r) => r.d);
const X = days[Math.floor(days.length / 2)];
log(`Set ${setNumber}, Tage ${w0}..${n} (${days.length}), Frost ${f}, Schnitt bid ${K} (naechste ${nextBid}), Patch-Tag ${X}, ${components.length} Komponenten`);

const files = (tag) => ({ aggwork: P(`${tag}.aggwork`), aggtry: P(`${tag}.aggtry`) });
const base = { exec, all, log, compList, compHash, t0Ms: Date.now(), budgetRaw: '99999' };
const dropBefore = async (o, w) => {
  for (const t of ['units', 'traits', 'board_rank']) await exec(`DELETE FROM ${o}.${t} WHERE bid IN (SELECT bid FROM ${o}.boards WHERE day < DATE '${w}')`);
  await exec(`DELETE FROM ${o}.boards WHERE day < DATE '${w}'`);
};
let ok = true;
const fail = (m) => { ok = false; log(`ABWEICHUNG: ${m}`); };

// ── B: Vollaufbau, Fenster ab w1 ───────────────────────────────────────────
await exec(`ATTACH '${fwd(P('B.duckdb'))}' AS outdb`);
await dropBefore('outdb', w1);
const rB = await aggStep({ ...base, outdb: 'outdb', mode: 'full', win: { w: w1, f, n }, startBid: 1, nextBid, files: files('B') });
log(`B: token ${rB.token ? 'ja' : 'NEIN'}, ${rB.covered}/${rB.total} Tage, ${rB.s} s, Alarme ${JSON.stringify(rB.alarms)}`);
if (!rB.token || rB.covered !== rB.total || rB.alarms.length) fail('(a) Vollaufbau nicht vollstaendig oder mit Alarm');
await exec('DETACH outdb');

// ── A: "gestern" ───────────────────────────────────────────────────────────
await exec(`ATTACH '${fwd(P('A.duckdb'))}' AS outdb`);
for (const t of ['units', 'traits', 'board_rank']) await exec(`DELETE FROM outdb.${t} WHERE bid >= ${K}`);
await exec(`DELETE FROM outdb.boards WHERE bid >= ${K}`);
await exec(`UPDATE outdb.boards SET rank = CASE WHEN rank = 'IRON' THEN 'GOLD' ELSE 'IRON' END WHERE day >= DATE '${f}' AND bid % 7 = 0`);
await exec(`UPDATE outdb.boards SET patch = 'zz.test' WHERE day = DATE '${X}'`);
const rA0 = await aggStep({ ...base, outdb: 'outdb', mode: 'full', win: { w: w0, f, n }, startBid: 1, nextBid: K, files: files('A') });
log(`A gestern: ${rA0.covered}/${rA0.total} Tage, ${rA0.s} s, Alarme ${JSON.stringify(rA0.alarms)}`);
if (!rA0.token) fail('A gestern ohne Summen');
await exec('DROP TABLE outdb.meta');
await exec(`CREATE TABLE outdb.meta AS SELECT '${rA0.token}'::VARCHAR AS agg_token`);

// ── A: "heute" ─────────────────────────────────────────────────────────────
await exec(`UPDATE outdb.boards AS t SET rank = s.rank, patch = s.patch FROM src.boards s
  WHERE t.bid = s.bid AND (t.rank IS DISTINCT FROM s.rank OR t.patch IS DISTINCT FROM s.patch)`);
await dropBefore('outdb', w1);
await exec(`CREATE OR REPLACE TABLE nb AS SELECT * FROM src.boards WHERE bid >= ${K} AND day >= DATE '${w1}'`);
await exec('INSERT INTO outdb.boards BY NAME SELECT * FROM nb');
await exec(`INSERT INTO outdb.units BY NAME SELECT * FROM src.units WHERE bid IN (SELECT bid FROM nb)`);
await exec(`INSERT INTO outdb.traits BY NAME SELECT * FROM src.traits WHERE bid IN (SELECT bid FROM nb)`);
const rA = await aggStep({ ...base, outdb: 'outdb', mode: 'delta', win: { w: w1, f, n }, startBid: K, nextBid, patchChanged: [X], files: files('A') });
log(`A heute: ${rA.covered}/${rA.total} Tage, ${rA.newDays} neu gerechnet, Partie-Delta ${rA.partMatches} Partien, ${rA.s} s, Alarme ${JSON.stringify(rA.alarms)}`);
if (!rA.token) fail('A heute ohne Summen');
if (rA.partMatches === 0) fail('Partie-Delta nicht ausgeloest — Test sagt nichts');
if (rA.newDays < 2) fail(`erwartet mind. 2 neu gerechnete Tage (Patch-Tag + Folgetag), waren ${rA.newDays}`);

// ── Vergleich ──────────────────────────────────────────────────────────────
await exec(`ATTACH '${fwd(P('B.duckdb'))}' AS b (READ_ONLY)`);
const bc = await one(`SELECT (SELECT count(*) FROM outdb.boards)::DOUBLE AS a, (SELECT count(*) FROM b.boards)::DOUBLE AS b`);
if (bc.a !== bc.b) fail(`Boards A ${bc.a} ≠ B ${bc.b}`);
for (const t of ['agg_rows', 'agg_head', 'agg_days', 'day_patches']) {
  const d = await one(`SELECT
    (SELECT count(*) FROM (SELECT * FROM outdb.${t} EXCEPT ALL SELECT * FROM b.${t}))::DOUBLE AS ab,
    (SELECT count(*) FROM (SELECT * FROM b.${t} EXCEPT ALL SELECT * FROM outdb.${t}))::DOUBLE AS ba,
    (SELECT count(*) FROM b.${t})::DOUBLE AS nb`);
  log(`${t}: ${d.nb} Zeilen, nur in A ${d.ab}, nur in B ${d.ba}`);
  if (d.ab || d.ba) fail(`${t} unterscheidet sich`);
}
const fA = await aggChecks({ all, outdb: 'outdb' });
if (fA.length) fail(`Pruefungen A: ${fA.join('; ')}`);
await exec('DETACH b');
await exec('DETACH outdb');
c.closeSync?.();
inst.closeSync?.();
log(ok ? 'GLEICH — Teil-Schritt liefert dieselben Summen wie der Vollaufbau' : 'NICHT GLEICH');
process.exit(ok ? 0 : 1);

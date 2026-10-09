#!/usr/bin/env node
// Abgleich der Platz-Masken (Paket 6) gegen eine LOKALE Stichprobe der
// Explorer-Datei. Fasst die Quelle nie an: alles laeuft auf Kopien im
// --tmp-Ordner, die am Ende geloescht werden (--keep laesst sie liegen).
//
//   S  Stichprobe: die letzten sechs Tage D0..D5, jede MOD-te Partie (immer
//      ganze Partien).
//   R  Referenz: Vollaufbau D1..D5. Zusaetzlich gegen eine unabhaengig
//      formulierte Rechnung direkt aus units/traits geprueft.
//   A  Teil-Aufbau. "Gestern": ohne D5, ohne neue Partien an D2..D4, halbe
//      Partien (Plaetze 5–8 fehlen) an D1..D4, alte Komponenten-Liste.
//      "Heute": alles dazu, D0 raus → Nachzug, neuer Tag, Tag-Wegfall,
//      ui-Nachrechnung. Muss Zeile fuer Zeile = R sein.
//   C  Vollaufbau mit Uebernahme: vorige Datei ohne neue/halbe Partien, an
//      D3 ein Stern verfaelscht; neue Datei mit neu vergebenen
//      Board-Nummern. D3 wird neu gerechnet, der Rest uebernommen und um die
//      neuen Partien nachgezogen; Ergebnis = R.
//   G  Negativ: je Tag ein Verstoss (doppelter Platz, Platz 0, Platz 9,
//      Stern leer, Stern 5), D5 sauber → nur D5 gedeckt, fuenf Tage in
//      mask_fail. Danach: gesperrte Tage bleiben gesperrt, reparierter Tag
//      wird neu gerechnet, falsche Kennung → alles neu, liegengebliebener
//      Versuchs-Stempel → nur Masken geleert, AGG_BUDGET_S=0 → Masken leer,
//      AGG_MASKS=0 → Masken-Tabellen weg.
//
// Aufruf: node scripts/oneoff/explorer-mask-equality.mjs --duckdb=<.../node-api/lib/index.js>
//           --src=<explorer.duckdb> --tmp=<Ordner> [--mod=4] [--keep]
// Exit 0 = alles gleich, 1 = Abweichung oder Fehler.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { maskStep } from '../lib/explorer-mask-build.mjs';
import { MASK_DATA_TABLES, MASK_TABLES, MASK_SIG, STAR_VALUES, OVER_VALUES, maskMultiDaySql } from '../lib/explorer-mask.mjs';
import { aggFingerprint, aggCarryMatch, lit, inList } from '../lib/explorer-agg-build.mjs';
import { compListSql } from '../lib/explorer-agg.mjs';
import { readComponents, componentsHash } from '../lib/explorer-components.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const DUCK = arg('duckdb');
const SRC = arg('src');
const TMP = arg('tmp');
const MOD = Number(arg('mod') ?? 4);
const KEEP = process.argv.includes('--keep');
if (!DUCK || !SRC || !TMP) { console.error('--duckdb, --src und --tmp angeben'); process.exit(1); }
const fwd = (p) => p.split(path.sep).join('/');
const log = (...a) => console.log(`[mask-eq ${new Date().toISOString().slice(11, 19)}]`, ...a);
const addDay = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const { DuckDBInstance } = await import(pathToFileURL(DUCK).href);
fs.mkdirSync(TMP, { recursive: true });
const P = (f) => path.join(TMP, f);
const TAGS = ['S', 'R', 'A', 'P', 'N', 'G', 'work'];
const dbFile = (tag) => P(`${tag}.duckdb`);
const files = (tag) => ({ maskwork: P(`${tag}.maskwork`), masktry: P(`${tag}.masktry`) });
const rmTag = (tag) => {
  const fl = files(tag);
  for (const x of [dbFile(tag), `${dbFile(tag)}.wal`, fl.maskwork, `${fl.maskwork}.wal`, fl.masktry]) {
    try { fs.rmSync(x, { force: true }); } catch (e) { log(`Loeschen ${x} gescheitert: ${e.message}`); }
  }
};
for (const t of TAGS) rmTag(t);

const inst = await DuckDBInstance.create(dbFile('work'), {
  threads: '2', memory_limit: '900MB', preserve_insertion_order: 'false', temp_directory: fwd(P('spill')),
});
const c = await inst.connect();
const exec = (s) => c.run(s);
const all = async (s) => (await c.runAndReadAll(s)).getRowObjects();
const one = async (s) => (await all(s))[0];
const num = async (s) => Number((await one(s)).v);

let ok = true;
const fail = (m) => { ok = false; log(`ABWEICHUNG: ${m}`); };
const expect = (cond, m) => { if (!cond) fail(m); };
// Erwartete Ergebnis-Felder; failed/alarms als Anzahl, token als ja/nein.
const want = (label, r, exp) => {
  for (const [k, v] of Object.entries(exp)) {
    const got = k === 'token' ? !!r.token : (k === 'failed' || k === 'alarms') ? r[k].length : r[k];
    if (got !== v) fail(`${label}: ${k} = ${JSON.stringify(got)}, erwartet ${JSON.stringify(v)}`);
  }
};

try {
  await exec(`ATTACH '${fwd(SRC)}' AS src (READ_ONLY)`);
  const setNumber = await num('SELECT set_number::DOUBLE AS v FROM src.meta');
  const components = readComponents(ROOT, setNumber, log);
  const compList = compListSql(components);
  const compHash = componentsHash(components);
  const D = (await all('SELECT DISTINCT day::VARCHAR AS v FROM src.boards ORDER BY 1 DESC LIMIT 6')).map((r) => String(r.v)).reverse();
  if (D.length < 6) throw new Error(`Quelle hat nur ${D.length} Tage`);
  const f = addDay(D[5], -7);
  const win = (w) => ({ w, f, n: D[5] });
  log(`Set ${setNumber}, Tage ${D.join(', ')}, jede ${MOD}. Partie, ${components.length} Komponenten`);

  // ── S: Stichprobe ────────────────────────────────────────────────────────
  await exec(`ATTACH '${fwd(dbFile('S'))}' AS s`);
  await exec(`CREATE TABLE s.boards AS SELECT * FROM src.boards WHERE day >= DATE '${D[0]}' AND hash(mid) % ${MOD} = 0 ORDER BY bid`);
  const minBid = await num('SELECT min(bid)::DOUBLE AS v FROM s.boards');
  for (const t of ['units', 'traits', 'board_rank']) {
    await exec(`CREATE TABLE s.${t} AS SELECT * FROM src.${t} WHERE bid >= ${minBid} AND bid IN (SELECT bid FROM s.boards) ORDER BY bid`);
  }
  await exec('CREATE TABLE s.meta AS SELECT * FROM src.meta');
  const st = await one(`SELECT (SELECT count(*) FROM s.boards)::DOUBLE AS b, (SELECT count(DISTINCT mid) FROM s.boards)::DOUBLE AS m,
    (SELECT count(*) FROM s.units)::DOUBLE AS u, (SELECT count(*) FROM s.traits)::DOUBLE AS t`);
  const multi = (await all(maskMultiDaySql('s'))).length;
  log(`S: ${st.b} Boards, ${st.m} Partien, ${st.u} Units, ${st.t} Traits, Tage mit Partien an mehreren Tagen ${multi}`);
  if (multi) fail('Stichprobe hat Partien an mehreren Tagen — Referenz waere unvollstaendig');
  await exec('CHECKPOINT s');
  await exec('DETACH s');
  await exec('DETACH src');
  if (fs.existsSync(`${dbFile('S')}.wal`)) throw new Error('S.duckdb.wal nach DETACH vorhanden — Kopie waere unvollstaendig');

  const open = async (tag) => {
    fs.copyFileSync(dbFile('S'), dbFile(tag));
    await exec(`ATTACH '${fwd(dbFile(tag))}' AS outdb`);
  };
  const delBoards = async (where) => {
    await exec(`CREATE OR REPLACE TABLE del_b AS SELECT bid FROM outdb.boards WHERE ${where}`);
    for (const t of ['units', 'traits', 'board_rank']) await exec(`DELETE FROM outdb.${t} WHERE bid IN (SELECT bid FROM del_b)`);
    await exec('DELETE FROM outdb.boards WHERE bid IN (SELECT bid FROM del_b)');
    const k = await num('SELECT count(*)::DOUBLE AS v FROM del_b');
    await exec('DROP TABLE del_b');
    return k;
  };
  // Kennung wie der Bau sie nach dem Schritt in meta schreibt.
  const setToken = async (tok) => {
    await exec('DROP TABLE IF EXISTS outdb.meta');
    await exec(`CREATE TABLE outdb.meta AS SELECT ${tok == null ? 'NULL' : lit(tok)}::VARCHAR AS mask_token`);
  };
  const run = async (tag, label, opts) => {
    const r = await maskStep({
      exec, all, log, outdb: 'outdb', compList, compHash, t0Ms: Date.now(), aggStartMs: Date.now(),
      budgetRaw: '99999', masksEnv: '1', files: files(tag), ...opts,
    });
    log(`${label}: Kennung ${r.token ? 'ja' : 'NEIN'}, ${r.covered}/${r.total} Tage, ${r.newDays} neu, ${r.carried} uebernommen,`
      + ` ${r.dropped} raus, Nachzug ${r.partMatches} Partien an ${r.partDays} Tagen, ui neu ${r.uiRedone}, ${r.failed.length} gescheitert,`
      + ` Grund ${r.reason ?? '-'}, ${r.s} s, Alarme ${JSON.stringify(r.alarms)}`);
    const fl = files(tag);
    if (fs.existsSync(fl.masktry)) fail(`${label}: Versuchs-Stempel liegt noch`);
    if (fs.existsSync(fl.maskwork) || fs.existsSync(`${fl.maskwork}.wal`)) fail(`${label}: Masken-Arbeitsdatei liegt noch`);
    if (r.token) {
      const mm = await all('SELECT sig, token FROM outdb.mask_meta');
      if (mm.length !== 1 || mm[0].token !== r.token || mm[0].sig !== MASK_SIG) fail(`${label}: mask_meta passt nicht zur Kennung`);
    }
    return r;
  };
  // outdb gegen die Referenz R (als ref angehaengt), wahlweise nur einige Tage.
  const compare = async (tag, days = null) => {
    const flt = days ? ` WHERE day IN (${inList(days)})` : '';
    for (const t of [...MASK_DATA_TABLES, 'mask_days']) {
      const d = await one(`SELECT
        (SELECT count(*) FROM (SELECT * FROM outdb.${t}${flt} EXCEPT ALL SELECT * FROM ref.${t}${flt}))::DOUBLE AS ab,
        (SELECT count(*) FROM (SELECT * FROM ref.${t}${flt} EXCEPT ALL SELECT * FROM outdb.${t}${flt}))::DOUBLE AS ba,
        (SELECT count(*) FROM ref.${t}${flt})::DOUBLE AS n`);
      log(`${tag} ${t}: ${d.n} Zeilen, nur in ${tag} ${d.ab}, nur in R ${d.ba}`);
      if (d.ab || d.ba) fail(`${tag} ${t} unterscheidet sich von R`);
      if (!d.n) fail(`${tag} ${t}: Referenz leer — Vergleich sagt nichts`);
    }
  };
  const countMaskRows = async (where = '') => {
    let k = 0;
    for (const t of MASK_DATA_TABLES) k += await num(`SELECT count(*)::DOUBLE AS v FROM outdb.${t}${where}`);
    return k;
  };

  // ── R: Referenz ──────────────────────────────────────────────────────────
  await open('R');
  await delBoards(`day < DATE '${D[1]}'`);
  const rR = await run('R', 'R Vollaufbau', { mode: 'full', win: win(D[1]) });
  want('R', rR, { token: true, reason: 'Vollaufbau', covered: 5, total: 5, newDays: 5, failed: 0, alarms: 0 });
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.mask_fail') === 0, 'R: mask_fail nicht leer');
  // Unabhaengige Formulierung: direkt aus units/traits, ohne keySelect/maskSql.
  const BIT = '(1::UTINYINT << (b.placement - 1))';
  const z = (cond) => `coalesce(bit_or(${BIT}) FILTER (WHERE ${cond}), 0)::UTINYINT`;
  const items = (extra) => `SELECT b.day, b.mid, x.it AS item, bit_or(${BIT}) AS m
    FROM (SELECT DISTINCT bid, it FROM (SELECT bid, unnest([i1, i2, i3]) AS it FROM outdb.units) WHERE it IS NOT NULL${extra}) x
    JOIN outdb.boards b USING (bid) GROUP BY ALL`;
  const indep = {
    mask_um: `SELECT b.day, b.mid, x.unit, ${STAR_VALUES.map((s) => `${z(`x.st = ${s}`)} AS m${s}`).join(', ')}
      FROM (SELECT bid, unit, max(star) AS st FROM outdb.units GROUP BY ALL) x JOIN outdb.boards b USING (bid) GROUP BY ALL`,
    mask_ui: items(` AND NOT list_contains(${compList}, it)`),
    mask_ut: `SELECT b.day, b.mid, x.trait, x.lvl, ${OVER_VALUES.map((v) => `${z(`x.overcap = ${v}`)} AS o${v}`).join(', ')},
      ${z('x.overcap IS NULL')} AS onull
      FROM (SELECT DISTINCT bid, trait, lvl, overcap FROM outdb.traits) x JOIN outdb.boards b USING (bid) GROUP BY ALL`,
    mask_uk: items(''),
  };
  for (const t of MASK_DATA_TABLES) {
    const d = await one(`SELECT
      (SELECT count(*) FROM (SELECT * FROM outdb.${t} EXCEPT ALL (${indep[t]})))::DOUBLE AS ab,
      (SELECT count(*) FROM ((${indep[t]}) EXCEPT ALL SELECT * FROM outdb.${t}))::DOUBLE AS ba,
      (SELECT count(*) FROM outdb.${t})::DOUBLE AS n`);
    log(`R ${t} gegen unabhaengige Rechnung: ${d.n} Zeilen, nur in R ${d.ab}, nur unabhaengig ${d.ba}`);
    if (d.ab || d.ba || !d.n) fail(`R ${t} weicht von der unabhaengigen Rechnung ab`);
  }
  const uiVsUk = await one(`SELECT (SELECT count(*) FROM outdb.mask_ui)::DOUBLE AS ui, (SELECT count(*) FROM outdb.mask_uk)::DOUBLE AS uk`);
  log(`R: ui ${uiVsUk.ui} Zeilen, uk ${uiVsUk.uk} Zeilen (Komponenten nur in uk)`);
  expect(uiVsUk.uk > uiVsUk.ui, 'R: uk hat nicht mehr Zeilen als ui — Komponenten-Filter wirkungslos?');
  await exec('DETACH outdb');
  await exec(`ATTACH '${fwd(dbFile('R'))}' AS ref (READ_ONLY)`);

  // ── A: Teil-Aufbau ───────────────────────────────────────────────────────
  await open('A');
  await exec(`CREATE OR REPLACE TABLE sel_new AS SELECT DISTINCT mid FROM outdb.boards
    WHERE day IN (${inList(D.slice(2, 5))}) AND hash(mid, 'neu-a') % 10 = 0`);
  await exec(`CREATE OR REPLACE TABLE sel_half AS SELECT DISTINCT mid FROM outdb.boards
    WHERE day IN (${inList(D.slice(1, 5))}) AND hash(mid, 'halb-a') % 10 = 0 AND mid NOT IN (SELECT mid FROM sel_new)`);
  const delA = await delBoards(`day = DATE '${D[5]}' OR mid IN (SELECT mid FROM sel_new)
    OR (mid IN (SELECT mid FROM sel_half) AND placement >= 5)`);
  log(`A gestern: ${delA} Boards entfernt (D5, neue und halbe Partien)`);
  const rA0 = await run('A', 'A gestern', { mode: 'full', win: win(D[0]), compList: '[]::VARCHAR[]', compHash: 'alt' });
  want('A gestern', rA0, { token: true, covered: 5, total: 5, failed: 0, alarms: 0 });
  await setToken(rA0.token);
  await exec(`ATTACH '${fwd(dbFile('S'))}' AS s (READ_ONLY)`);
  await exec(`CREATE OR REPLACE TABLE nb AS SELECT bid, mid, day FROM s.boards
    WHERE day >= DATE '${D[1]}' AND bid NOT IN (SELECT bid FROM outdb.boards)`);
  const mixedA = await num('SELECT count(DISTINCT mid)::DOUBLE AS v FROM nb WHERE mid IN (SELECT mid FROM outdb.boards)');
  for (const t of ['boards', 'units', 'traits', 'board_rank']) {
    await exec(`INSERT INTO outdb.${t} BY NAME SELECT * FROM s.${t} WHERE bid IN (SELECT bid FROM nb)`);
  }
  await exec('DETACH s');
  await delBoards(`day < DATE '${D[1]}'`);
  const oldDaysA = inList(D.slice(1, 5));
  const expPmA = await num(`SELECT count(DISTINCT mid)::DOUBLE AS v FROM nb WHERE day IN (${oldDaysA})`);
  const expPdA = await num(`SELECT count(DISTINCT day)::DOUBLE AS v FROM nb WHERE day IN (${oldDaysA})`);
  log(`A heute: ${await num('SELECT count(*)::DOUBLE AS v FROM nb')} neue Boards, ${expPmA} Partien auf gedeckten Tagen,`
    + ` davon ${mixedA} halbe Partien (gestern schon teilweise da)`);
  if (!mixedA) fail('A: keine halben Partien — Nachzug bestehender Partien ungetestet');
  const rA = await run('A', 'A heute', { mode: 'delta', win: win(D[1]), newBoards: 'nb' });
  want('A heute', rA, {
    token: true, reason: null, covered: 5, total: 5, newDays: 1, dropped: 1, partMatches: expPmA, partDays: expPdA,
    uiRedone: 4, failed: 0, alarms: 0,
  });
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.mask_fail') === 0, 'A: mask_fail nicht leer');
  await compare('A');
  for (const t of ['nb', 'sel_new', 'sel_half']) await exec(`DROP TABLE IF EXISTS ${t}`);
  await exec('DETACH outdb');

  // ── C: vorige Datei ──────────────────────────────────────────────────────
  await open('P');
  await exec(`CREATE OR REPLACE TABLE sel_new AS SELECT DISTINCT mid FROM outdb.boards
    WHERE day IN (${inList(D.slice(2))}) AND hash(mid, 'neu-c') % 10 = 0`);
  await exec(`CREATE OR REPLACE TABLE sel_half AS SELECT DISTINCT mid FROM outdb.boards
    WHERE day IN (${inList(D.slice(1))}) AND hash(mid, 'halb-c') % 10 = 0 AND mid NOT IN (SELECT mid FROM sel_new)`);
  const delP = await delBoards('mid IN (SELECT mid FROM sel_new) OR (mid IN (SELECT mid FROM sel_half) AND placement >= 5)');
  // Eine (Board, Unit) mit genau einer Zeile: Stern bleibt in 1–4, der Tag also gueltig.
  const uniqUnit = (d) => one(`SELECT x.bid::DOUBLE AS bid, x.unit, any_value(x.star)::DOUBLE AS star
    FROM outdb.units x JOIN outdb.boards b USING (bid) WHERE b.day = DATE '${d}' GROUP BY ALL HAVING count(*) = 1 ORDER BY 1, 2 LIMIT 1`);
  const uP = await uniqUnit(D[3]);
  await exec(`UPDATE outdb.units SET star = ${uP.star === 1 ? 2 : 1} WHERE bid = ${uP.bid} AND unit = ${lit(uP.unit)}`);
  log(`C vorige: ${delP} Boards entfernt (neue und halbe Partien), Stern an ${D[3]} verfaelscht`);
  const rP = await run('P', 'C vorige', { mode: 'full', win: win(D[0]) });
  want('C vorige', rP, { token: true, covered: 6, total: 6, failed: 0, alarms: 0 });
  await setToken(rP.token);
  for (const t of ['sel_new', 'sel_half']) await exec(`DROP TABLE IF EXISTS ${t}`);
  await exec('DETACH outdb');

  // ── C: neue Datei, Board-Nummern neu vergeben ────────────────────────────
  await open('N');
  await delBoards(`day < DATE '${D[1]}'`);
  for (const t of ['boards', 'units', 'traits', 'board_rank']) {
    await exec(`CREATE TABLE outdb.${t}_r AS SELECT * REPLACE (CAST(3000000000 - bid AS UINTEGER) AS bid) FROM outdb.${t}`);
    await exec(`DROP TABLE outdb.${t}`);
    await exec(`ALTER TABLE outdb.${t}_r RENAME TO ${t}`);
  }
  // Fingerabdruecke wie im Bau: alt = alle Boards der vorigen Datei
  // (aggCarrySave), neu = alte Boards in der neuen Datei (aggCarryMatch).
  await exec(`ATTACH '${fwd(dbFile('P'))}' AS prev (READ_ONLY)`);
  await exec('CREATE OR REPLACE TABLE cv_kd AS SELECT br.k, br.bid, b.day FROM prev.board_rank br JOIN prev.boards b USING (bid)');
  const oldFp = await aggFingerprint({ all, db: 'prev', kd: 'cv_kd', f });
  await exec('DROP TABLE cv_kd');
  await exec('CREATE OR REPLACE TABLE prev_rank AS SELECT DISTINCT k FROM prev.board_rank');
  await exec('DETACH prev');
  const m = await aggCarryMatch({ exec, all, outdb: 'outdb', prevKeys: 'prev_rank', f, prep: { covered: [...oldFp.keys()], oldFp, s: 0 } });
  const differ = D.slice(1).filter((d) => oldFp.get(d) !== m.newFp.get(d));
  const carryDays = D.slice(1).filter((d) => !differ.includes(d));
  const mixedC = await num(`SELECT count(DISTINCT mid)::DOUBLE AS v FROM cv_nb
    WHERE mid IN (SELECT mid FROM outdb.boards WHERE bid NOT IN (SELECT bid FROM cv_nb))`);
  const expPmC = await num(`SELECT count(DISTINCT mid)::DOUBLE AS v FROM cv_nb WHERE day IN (${inList(carryDays)})`);
  const expPdC = await num(`SELECT count(DISTINCT day)::DOUBLE AS v FROM cv_nb WHERE day IN (${inList(carryDays)})`);
  log(`C Fingerabdruck: anders ${JSON.stringify(differ)}, ${m.nNew} neue Boards, ${expPmC} Partien auf uebernommenen Tagen,`
    + ` davon ${mixedC} halbe`);
  if (JSON.stringify(differ) !== JSON.stringify([D[3]])) fail(`C: anders erwartet ["${D[3]}"]`);
  if (!mixedC) fail('C: keine halben Partien — Nachzug bestehender Partien ungetestet');
  const rN = await run('N', 'C neu', {
    mode: 'full', win: win(D[1]), newBoards: 'cv_nb', carry: { path: fwd(dbFile('P')), oldFp, newFp: m.newFp },
  });
  want('C neu', rN, {
    token: true, reason: null, carried: 4, newDays: 1, covered: 5, total: 5, dropped: 0, partMatches: expPmC, partDays: expPdC,
    uiRedone: 0, failed: 0, alarms: 0,
  });
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.mask_fail') === 0, 'C: mask_fail nicht leer');
  await compare('N');
  for (const t of ['cv_nb', 'prev_rank']) await exec(`DROP TABLE IF EXISTS ${t}`);
  await exec('DETACH outdb');

  // ── G: Verstoesse ────────────────────────────────────────────────────────
  await open('G');
  const dup = await one(`SELECT mid::VARCHAR AS m FROM outdb.boards WHERE day = DATE '${D[0]}' GROUP BY mid
    HAVING count(*) FILTER (WHERE placement = 1) = 1 AND count(*) FILTER (WHERE placement = 2) = 1 ORDER BY mid LIMIT 1`);
  await exec(`UPDATE outdb.boards SET placement = 1 WHERE mid = ${dup.m} AND placement = 2`);
  const minBidOf = (d) => num(`SELECT min(bid)::DOUBLE AS v FROM outdb.boards WHERE day = DATE '${d}'`);
  await exec(`UPDATE outdb.boards SET placement = 0 WHERE bid = ${await minBidOf(D[1])}`);
  await exec(`UPDATE outdb.boards SET placement = 9 WHERE bid = ${await minBidOf(D[2])}`);
  const u3 = await uniqUnit(D[3]);
  await exec(`UPDATE outdb.units SET star = NULL WHERE bid = ${u3.bid} AND unit = ${lit(u3.unit)}`);
  const u4 = await uniqUnit(D[4]);
  await exec(`UPDATE outdb.units SET star = 5 WHERE bid = ${u4.bid} AND unit = ${lit(u4.unit)}`);
  const expWhy = {
    [D[0]]: 'doppelter Platz', [D[1]]: 'Platz leer oder ausserhalb 1–8', [D[2]]: 'Platz leer oder ausserhalb 1–8',
    [D[3]]: 'Stern leer oder ausserhalb 1–4', [D[4]]: 'Stern leer oder ausserhalb 1–4',
  };
  const failRows = async () => (await all('SELECT day::VARCHAR AS d, why FROM outdb.mask_fail ORDER BY 1'))
    .map((r) => ({ d: String(r.d), why: String(r.why) }));
  const coveredDays = async () => (await all('SELECT day::VARCHAR AS d FROM outdb.mask_days ORDER BY 1')).map((r) => String(r.d));

  const rG1 = await run('G', 'G Verstoesse', { mode: 'full', win: win(D[0]) });
  want('G Verstoesse', rG1, { token: true, covered: 1, total: 6, newDays: 1, failed: 5 });
  expect(rG1.alarms.some((a) => a.includes('5 Tage gescheitert')), 'G: Alarm fuer gescheiterte Tage fehlt');
  const fr1 = await failRows();
  for (const r of fr1) log(`G mask_fail ${r.d}: ${r.why}`);
  expect(JSON.stringify(fr1.map((r) => r.d)) === JSON.stringify(D.slice(0, 5)), 'G: mask_fail-Tage falsch');
  for (const r of fr1) expect(r.why.includes(expWhy[r.d] ?? '?'), `G ${r.d}: Grund "${r.why}" ohne "${expWhy[r.d]}"`);
  expect(JSON.stringify(await coveredDays()) === JSON.stringify([D[5]]), 'G: gedeckt sollte nur D5 sein');
  expect(await countMaskRows(` WHERE day <> DATE '${D[5]}'`) === 0, 'G: Masken-Zeilen fuer gescheiterte Tage');
  await compare('G', [D[5]]);
  await setToken(rG1.token);

  // Gesperrte Tage bleiben gesperrt (gleicher Fingerabdruck → kein neuer Versuch).
  await exec('CREATE OR REPLACE TABLE nb0 AS SELECT bid, mid, day FROM outdb.boards WHERE false');
  const rG2 = await run('G', 'G zweiter Lauf', { mode: 'delta', win: win(D[0]), newBoards: 'nb0' });
  want('G zweiter Lauf', rG2, { token: true, reason: null, covered: 1, newDays: 0, failed: 0, alarms: 0 });
  expect((await failRows()).length === 5, 'G zweiter Lauf: mask_fail nicht mehr 5 Zeilen');
  await setToken(rG2.token);

  // D4 repariert → anderer Fingerabdruck → neu gerechnet.
  await exec(`UPDATE outdb.units SET star = ${u4.star} WHERE bid = ${u4.bid} AND unit = ${lit(u4.unit)}`);
  const rG3 = await run('G', 'G D4 repariert', { mode: 'delta', win: win(D[0]), newBoards: 'nb0' });
  want('G D4 repariert', rG3, { token: true, reason: null, covered: 2, newDays: 1, failed: 0, alarms: 0 });
  expect(JSON.stringify((await failRows()).map((r) => r.d)) === JSON.stringify(D.slice(0, 4)), 'G D4 repariert: mask_fail-Tage falsch');
  await compare('G', [D[4], D[5]]);

  // Falsche Kennung → Masken der Datei gelten nicht, alles neu.
  await setToken('falsch');
  const rG4 = await run('G', 'G falsche Kennung', { mode: 'delta', win: win(D[0]), newBoards: 'nb0' });
  want('G falsche Kennung', rG4, { token: true, covered: 2, newDays: 2, failed: 4 });
  expect(/Kennung/.test(rG4.reason ?? ''), `G falsche Kennung: Grund ${rG4.reason}`);
  await compare('G', [D[4], D[5]]);
  await setToken(rG4.token);

  // Liegengebliebener Versuchs-Stempel → nur Masken geleert, Rest bleibt.
  await exec('CREATE TABLE outdb.agg_probe AS SELECT range AS x FROM range(1000)');
  const nB = await num('SELECT count(*)::DOUBLE AS v FROM outdb.boards');
  fs.writeFileSync(files('G').masktry, JSON.stringify({ pid: 0, startedAt: 'Test' }));
  const rG5 = await run('G', 'G Stempel', { mode: 'delta', win: win(D[0]), newBoards: 'nb0' });
  want('G Stempel', rG5, { token: false, covered: 0 });
  expect(rG5.alarms.some((a) => a.includes('abgestuerzt')), 'G Stempel: Alarm fehlt');
  for (const t of MASK_TABLES) expect(await num(`SELECT count(*)::DOUBLE AS v FROM outdb.${t}`) === 0, `G Stempel: ${t} nicht leer`);
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.agg_probe') === 1000, 'G Stempel: Probe-Tabelle veraendert');
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.boards') === nB, 'G Stempel: Boards veraendert');

  // Naechster Lauf rechnet wieder (Kennung fehlt → neu begonnen).
  const rG6 = await run('G', 'G nach Stempel', { mode: 'delta', win: win(D[0]), newBoards: 'nb0' });
  want('G nach Stempel', rG6, { token: true, covered: 2, failed: 4 });
  await setToken(rG6.token);

  // AGG_BUDGET_S=0 → Masken leer, Tabellen bleiben.
  const rG7 = await run('G', 'G Budget 0', { mode: 'delta', win: win(D[0]), newBoards: 'nb0', budgetRaw: '0' });
  want('G Budget 0', rG7, { token: false, covered: 0 });
  for (const t of MASK_TABLES) expect(await num(`SELECT count(*)::DOUBLE AS v FROM outdb.${t}`) === 0, `G Budget 0: ${t} nicht leer`);

  // AGG_MASKS=0 → Masken-Tabellen weg, Rest bleibt.
  const rG8 = await run('G', 'G AGG_MASKS=0', { mode: 'delta', win: win(D[0]), newBoards: 'nb0', masksEnv: '0' });
  want('G AGG_MASKS=0', rG8, { token: false, covered: 0 });
  const left = (await all(`SELECT table_name AS v FROM duckdb_tables() WHERE database_name = 'outdb' AND table_name LIKE 'mask%'`))
    .map((r) => String(r.v));
  expect(!left.length, `G AGG_MASKS=0: Tabellen uebrig ${JSON.stringify(left)}`);
  expect(await num('SELECT count(*)::DOUBLE AS v FROM outdb.agg_probe') === 1000, 'G AGG_MASKS=0: Probe-Tabelle veraendert');
  await exec('DROP TABLE IF EXISTS nb0');
  await exec('DETACH outdb');
} catch (e) {
  ok = false;
  log(`FEHLER: ${e.stack ?? e.message}`);
} finally {
  for (const d of ['outdb', 'ref', 's', 'prev', 'src']) {
    try { await exec(`DETACH DATABASE IF EXISTS ${d}`); } catch { /* egal */ }
  }
  try { c.closeSync?.(); } catch { /* egal */ }
  try { inst.closeSync?.(); } catch { /* egal */ }
  if (!KEEP) {
    for (const t of TAGS) rmTag(t);
    try { fs.rmSync(P('spill'), { recursive: true, force: true }); } catch { /* egal */ }
  }
}
log(ok ? 'GLEICH — Teil-Aufbau, Uebernahme und Verstoesse verhalten sich wie geplant' : 'NICHT GLEICH');
process.exit(ok ? 0 : 1);

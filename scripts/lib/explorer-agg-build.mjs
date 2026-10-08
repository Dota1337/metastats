// Bau-Schritt der Tages-Teilsummen (Paket 5b). Laeuft im Explorer-Bau nach
// den Pruefungen und vor meta, auf derselben Verbindung: Standard-Datenbank =
// Arbeitsdatei, `outdb` = die neue Explorer-Datei. Eigene Datei, damit das
// Einmal-Skript scripts/oneoff/explorer-agg-equality.mjs den Schritt gegen
// eine lokale Kopie fahren kann, ohne den Bau zu laden.
//
// DuckDB-Regel (lokal nachgestellt): eine Transaktion schreibt nur in EINE
// angehaengte Datei, und nach einem Fehler rollt COMMIT still zurueck. Jede
// Transaktion hier schreibt deshalb nur in outdb; Zwischentabellen entstehen
// vorher in der Arbeitsdatei, und im Fehlerfall gibt es ein ausdrueckliches
// ROLLBACK. Invariante: agg_rows/agg_head enthalten nur Tage aus agg_days.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { AGG_SIG, VARIANTS, variantRowsSql, aggBudgetS, aggCoveredDays, planAgg, aggDue } from './explorer-agg.mjs';

export const AGG_SUM_COLS = ['m1', 'n1', 's1', 't4', 't1', 'ss11', 'sn11', 'nn11', 's1S', 's1N', 'n1S', 'n1N', 'n3'];
export const AGG_HEAD_COLS = ['matches', 'n', 's', 'ss', 'sn', 'nn', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'];
const HIST = [1, 2, 3, 4, 5, 6, 7, 8];
// Arbeitskopie je Block statt einmal fuer alle Tage: gemessen 2,1 s fuer
// 1 Tag, 28 s fuer 7, 84 s fuer 21 Tage bei ~1 GB Spitzenspeicher.
const BLOCK_DAYS = 7;
const TABLES = ['agg_rows', 'agg_head', 'agg_days', 'day_patches', 'agg_meta'];

const qi = (c) => `"${c}"`;
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const dLit = (d) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Tag ${d} ungueltig`);
  return `DATE '${d}'`;
};
const inList = (days) => days.map(dLit).join(', ');

export const aggTablesDdl = (o) => [
  `CREATE TABLE ${o}.agg_rows(variant VARCHAR, day DATE, patch VARCHAR, region VARCHAR, key VARCHAR, sub INTEGER, sub2 INTEGER, `
    + `${AGG_SUM_COLS.map((c) => `${qi(c)} DOUBLE`).join(', ')})`,
  `CREATE TABLE ${o}.agg_head(day DATE, patch VARCHAR, region VARCHAR, ${AGG_HEAD_COLS.map((c) => `${c} DOUBLE`).join(', ')})`,
  `CREATE TABLE ${o}.agg_days(day DATE)`,
  `CREATE TABLE ${o}.day_patches(day DATE, patch VARCHAR)`,
  `CREATE TABLE ${o}.agg_meta(sig VARCHAR, token VARCHAR, base_next_bid BIGINT, comp_hash VARCHAR)`,
];

// Partie-Summen: n Boards, s Platzsumme, Platz-Histogramm. Tag, Patch und
// Region sind je Partie gleich (Pruefung d).
export const aggClSql = (b) => `SELECT mid, any_value(day) AS day, any_value(patch) AS patch, any_value(region) AS region,
  count(*) AS n, sum(placement) AS s, ${HIST.map((i) => `count(*) FILTER (WHERE placement = ${i}) AS h${i}`).join(', ')}
  FROM ${b} GROUP BY mid`;

// Kopf je (Tag, Patch, Region): Partien, Boards, Platzsumme, Partie-Produkte, Histogramm.
export const aggHeadSql = (cl) => `SELECT day, patch, region, count(*)::DOUBLE AS matches, sum(n)::DOUBLE AS n, sum(s)::DOUBLE AS s,
  sum(s * s)::DOUBLE AS ss, sum(s * n)::DOUBLE AS sn, sum(n * n)::DOUBLE AS nn, ${HIST.map((i) => `sum(h${i})::DOUBLE AS h${i}`).join(', ')}
  FROM (${cl}) GROUP BY ALL`;

const rowsSelect = (v, names, cl, sign = 1) => {
  const inner = variantRowsSql(v, names, cl);
  if (sign > 0) return `SELECT '${v}' AS variant, * FROM (${inner})`;
  return `SELECT '${v}' AS variant, day, patch, region, key, sub, sub2, ${AGG_SUM_COLS.map((c) => `-${qi(c)} AS ${qi(c)}`).join(', ')} FROM (${inner})`;
};

// Pruefungen (Plan Punkt 14 + Gegenprobe gegen die Boards). Liefert die
// Liste der Verstoesse, leer = in Ordnung.
export async function aggChecks({ all, outdb: o }) {
  const n = async (sql) => Number((await all(sql))[0].n);
  const on = (x, y) => `${x}.day = ${y}.day AND ${x}.patch IS NOT DISTINCT FROM ${y}.patch AND ${x}.region IS NOT DISTINCT FROM ${y}.region`;
  const diff = (pairs) => pairs.map(([a, b]) => `${a} IS DISTINCT FROM ${b}`).join(' OR ');
  const fails = [];
  const a = await n(`SELECT count(*) AS n FROM ${o}.agg_head h
    FULL JOIN (SELECT * FROM ${o}.agg_rows WHERE variant = 'region') r ON ${on('r', 'h')} AND r.key IS NOT DISTINCT FROM h.region
    WHERE ${diff([['r.m1', 'h.matches'], ['r.n1', 'h.n'], ['r.s1', 'h.s'], ['r.ss11', 'h.ss'], ['r.sn11', 'h.sn'], ['r.nn11', 'h.nn'],
    ['r."s1S"', 'h.ss'], ['r."s1N"', 'h.sn'], ['r."n1S"', 'h.sn'], ['r."n1N"', 'h.nn'],
    ['r.t4', 'h.h1 + h.h2 + h.h3 + h.h4'], ['r.t1', 'h.h1'], ['r.n3', '0']])}`);
  if (a) fails.push(`(a) Region-Zeile ≠ Kopf in ${a} Faellen`);
  const b = await n(`SELECT count(*) AS n FROM ${o}.agg_head h
    FULL JOIN (SELECT day, patch, region, sum(n1) AS n1 FROM ${o}.agg_rows WHERE variant = 'round' GROUP BY ALL) r ON ${on('r', 'h')}
    WHERE r.n1 IS DISTINCT FROM h.n`);
  if (b) fails.push(`(b) Runden-Summe ≠ Boards in ${b} Faellen`);
  const c = await n(`SELECT count(*) AS n FROM (SELECT * FROM ${o}.agg_rows WHERE variant = 'units') u
    FULL JOIN (SELECT day, patch, region, key, sum(n1) AS n1, sum(s1) AS s1, sum(t4) AS t4, sum(t1) AS t1,
                 coalesce(sum(n1) FILTER (WHERE sub >= 3), 0) AS n3
               FROM ${o}.agg_rows WHERE variant = 'units_star' GROUP BY ALL) s
      ON ${on('u', 's')} AND u.key IS NOT DISTINCT FROM s.key
    WHERE ${diff([['u.n1', 's.n1'], ['u.s1', 's.s1'], ['u.t4', 's.t4'], ['u.t1', 's.t1'], ['u.n3', 's.n3']])}`);
  if (c) fails.push(`(c) Sterne-Summe ≠ Unit-Zeile in ${c} Faellen`);
  const d = await n(`SELECT count(*) AS n FROM (SELECT mid FROM (SELECT DISTINCT mid, day, patch, region FROM ${o}.boards)
    GROUP BY mid HAVING count(*) > 1)`);
  if (d) fails.push(`(d) ${d} Partien mit mehr als einem Tag/Patch/Region`);
  const e = await n(`SELECT count(*) AS n FROM (SELECT day FROM ${o}.agg_rows UNION SELECT day FROM ${o}.agg_head) x
    WHERE day NOT IN (SELECT day FROM ${o}.agg_days)`);
  if (e) fails.push(`(e) ${e} Tage mit Summen ausserhalb der Deckung`);
  const g = await n(`SELECT count(*) AS n FROM (SELECT day, patch, region, count(*)::DOUBLE AS n, sum(placement)::DOUBLE AS s,
      count(DISTINCT mid)::DOUBLE AS m FROM ${o}.boards WHERE day IN (SELECT day FROM ${o}.agg_days) GROUP BY ALL) x
    FULL JOIN ${o}.agg_head h ON ${on('x', 'h')}
    WHERE ${diff([['x.n', 'h.n'], ['x.s', 'h.s'], ['x.m', 'h.matches']])}`);
  if (g) fails.push(`(f) Kopf ≠ Boards in ${g} Faellen`);
  return fails;
}

// Der Schritt. Liefert { token, covered, total, newDays, s, alarms, ... };
// token = null heisst: keine gueltigen Summen in der Datei (Dienst rechnet
// live). Wirft nie — ein Fehler leert die Summen und wird Alarm.
export async function aggStep({
  exec, all, log, outdb: o, mode, win, startBid, nextBid, patchChanged = [], t0Ms, files,
  compList, compHash, newBoards = 'nb', budgetRaw = process.env.AGG_BUDGET_S, now = () => Date.now(),
}) {
  const t1 = now();
  const res = { token: null, covered: 0, total: 0, newDays: 0, s: 0, alarms: [], newest: null, newestCovered: false, partMatches: 0 };
  const n = async (sql) => Number((await all(sql))[0]?.n ?? 0);
  const col = async (sql) => (await all(sql)).map((r) => r.v);
  const tx = async (stmts) => {
    await exec('BEGIN TRANSACTION');
    try {
      for (const s of stmts) await exec(s);
      await exec('COMMIT');
    } catch (e) {
      try { await exec('ROLLBACK'); } catch { /* schon zu */ }
      throw e;
    }
  };
  const reset = () => tx([...TABLES.map((t) => `DROP TABLE IF EXISTS ${o}.${t}`), ...aggTablesDdl(o)]);
  const finish = () => { res.s = Math.round((now() - t1) / 1000); return res; };
  const budgetS = aggBudgetS(budgetRaw);

  try {
    if (fs.existsSync(files.aggtry)) {
      await reset();
      fs.rmSync(files.aggtry, { force: true });
      res.alarms.push('Teilsummen-Schritt beim letzten Lauf abgestuerzt — diesmal ohne Summen');
      log('Teilsummen: Versuchs-Stempel vom letzten Lauf gefunden — Summen geleert, der naechste Lauf rechnet neu');
      return finish();
    }
    if (budgetS === 0) {
      await reset();
      log('Teilsummen: AGG_BUDGET_S=0 — Summen geleert, keine Rechnung');
      return finish();
    }
  } catch (e) {
    log(`Teilsummen: Leeren gescheitert (${e.message}) — Summen ohne Kennung bleiben unbenutzt`);
    res.alarms.push(`Teilsummen-Schritt gescheitert: ${e.message}`);
    return finish();
  }

  fs.writeFileSync(files.aggtry, JSON.stringify({ pid: process.pid, startedAt: new Date(t1).toISOString() }));
  try {
    // 1) Generation: Summen der vorigen Datei nur, wenn Rechenweg, Kennung,
    //    Board-Nummer und Komponenten zu dieser Datei passen.
    let reason = null;
    if (mode !== 'delta') reason = 'Vollaufbau';
    else if (!(await n(`SELECT count(*) AS n FROM duckdb_tables() WHERE database_name = ${lit(o)} AND table_name = 'agg_meta'`))) {
      reason = 'keine Summen in der vorigen Datei';
    } else {
      const am = await all(`SELECT sig, token, base_next_bid::DOUBLE AS bnb, comp_hash FROM ${o}.agg_meta`);
      const metaCols = await col(`SELECT column_name AS v FROM duckdb_columns() WHERE database_name = ${lit(o)} AND table_name = 'meta'`);
      const prevToken = metaCols.includes('agg_token') ? ((await all(`SELECT agg_token AS v FROM ${o}.meta`))[0]?.v ?? null) : null;
      if (am.length !== 1) reason = `agg_meta mit ${am.length} Zeilen`;
      else if (am[0].sig !== AGG_SIG) reason = `Rechenweg geaendert (${am[0].sig} → ${AGG_SIG})`;
      else if (!am[0].token || am[0].token !== prevToken) reason = 'Kennung passt nicht zur Datei';
      else if (Number(am[0].bnb) !== startBid) reason = `Board-Nummer ${am[0].bnb} ≠ ${startBid}`;
      else if (am[0].comp_hash !== compHash) reason = 'Komponenten-Liste geaendert';
    }
    if (reason) await reset();

    // 2) Deckung: Tage vor dem Fenster und Tage mit geaendertem Patch raus.
    const covered0 = reason ? [] : await col(`SELECT day::VARCHAR AS v FROM ${o}.agg_days`);
    const { keep, drop, rankDays } = aggCoveredDays({ covered: covered0, w: win.w, f: win.f, patchChanged });
    if (drop.length) {
      await tx(['agg_rows', 'agg_head', 'agg_days'].map((t) => `DELETE FROM ${o}.${t} WHERE day IN (${inList(drop)})`));
    }

    // 3) Partie-Delta fuer gedeckte Tage: neue Boards aendern n und s ihrer
    //    Partie, also jede Zeile, an der die Partie haengt. Fuer die
    //    betroffenen Partien: + Summen ueber alle Boards, − Summen ueber die
    //    alten (bid < startBid, so beim letzten Lauf gerechnet).
    if (keep.length) {
      await exec(`CREATE OR REPLACE TABLE ag_pm AS SELECT DISTINCT mid FROM ${newBoards} WHERE day IN (${inList(keep)})`);
      res.partMatches = await n('SELECT count(*) AS n FROM ag_pm');
    }
    if (res.partMatches) {
      const fLit = dLit(win.f);
      await exec(`CREATE OR REPLACE TABLE ag_pb AS SELECT bid, mid, day, patch, region, placement, level, last_round, gold_left, family, rank
        FROM ${o}.boards WHERE mid IN (SELECT mid FROM ag_pm)`);
      await exec(`CREATE OR REPLACE TABLE ag_pbo AS SELECT * FROM ag_pb WHERE bid < ${startBid}`);
      await exec(`CREATE OR REPLACE TABLE ag_pu AS SELECT bid, unit, star, i1, i2, i3 FROM ${o}.units WHERE bid IN (SELECT bid FROM ag_pb)`);
      await exec(`CREATE OR REPLACE TABLE ag_pt AS SELECT bid, trait, lvl, overcap FROM ${o}.traits WHERE bid IN (SELECT bid FROM ag_pb)`);
      await exec(`CREATE OR REPLACE TABLE ag_cla AS ${aggClSql('ag_pb')}`);
      await exec(`CREATE OR REPLACE TABLE ag_clo AS ${aggClSql('ag_pbo')}`);
      await exec('CREATE OR REPLACE TABLE ag_ad AS SELECT DISTINCT day FROM ag_cla');
      const outside = await n(`SELECT count(*) AS n FROM ag_ad WHERE day NOT IN (${inList(keep)})`);
      if (outside) throw new Error(`Partie-Delta: ${outside} Tage ausserhalb der Deckung`);
      await exec(`CREATE OR REPLACE TABLE ag_dr AS SELECT * FROM ${o}.agg_rows LIMIT 0`);
      for (const v of VARIANTS) {
        await exec(`INSERT INTO ag_dr BY NAME ${rowsSelect(v, { b: 'ag_pb', u: 'ag_pu', t: 'ag_pt', compList }, 'SELECT * FROM ag_cla', 1)}`);
        await exec(`INSERT INTO ag_dr BY NAME ${rowsSelect(v, { b: 'ag_pbo', u: 'ag_pu', t: 'ag_pt', compList }, 'SELECT * FROM ag_clo', -1)}`);
      }
      // Rang-Zeilen ab der Frost-Grenze rechnet Schritt 4 neu (alte Boards
      // koennen dort einen anderen Rang bekommen haben).
      const notRank = `NOT (variant = 'rank' AND day >= ${fLit})`;
      await exec(`CREATE OR REPLACE TABLE ag_mr AS SELECT variant, day, patch, region, key, sub, sub2,
          ${AGG_SUM_COLS.map((c) => `sum(${qi(c)}) AS ${qi(c)}`).join(', ')}
        FROM (SELECT * FROM ${o}.agg_rows WHERE day IN (SELECT day FROM ag_ad) AND ${notRank}
              UNION ALL SELECT * FROM ag_dr WHERE ${notRank}) GROUP BY ALL`);
      const badRows = await n(`SELECT count(*) AS n FROM ag_mr WHERE
        (m1 = 0 AND (${AGG_SUM_COLS.filter((c) => c !== 'm1').map((c) => `${qi(c)} <> 0`).join(' OR ')}))
        OR ${AGG_SUM_COLS.map((c) => `${qi(c)} < 0`).join(' OR ')}`);
      if (badRows) throw new Error(`Partie-Delta: ${badRows} Zeilen negativ oder ohne Partie`);
      await exec(`CREATE OR REPLACE TABLE ag_mh AS SELECT day, patch, region, ${AGG_HEAD_COLS.map((c) => `sum(${c}) AS ${c}`).join(', ')}
        FROM (SELECT * FROM ${o}.agg_head WHERE day IN (SELECT day FROM ag_ad)
              UNION ALL SELECT * FROM (${aggHeadSql('SELECT * FROM ag_cla')})
              UNION ALL SELECT day, patch, region, ${AGG_HEAD_COLS.map((c) => `-${c} AS ${c}`).join(', ')} FROM (${aggHeadSql('SELECT * FROM ag_clo')}))
        GROUP BY ALL`);
      const badHead = await n(`SELECT count(*) AS n FROM ag_mh WHERE
        (matches = 0 AND (${AGG_HEAD_COLS.filter((c) => c !== 'matches').map((c) => `${c} <> 0`).join(' OR ')}))
        OR ${AGG_HEAD_COLS.map((c) => `${c} < 0`).join(' OR ')}`);
      if (badHead) throw new Error(`Partie-Delta: ${badHead} Kopfzeilen negativ oder ohne Partie`);
      await tx([
        `DELETE FROM ${o}.agg_rows WHERE day IN (SELECT day FROM ag_ad) AND ${notRank}`,
        `INSERT INTO ${o}.agg_rows BY NAME SELECT * FROM ag_mr WHERE m1 <> 0`,
        `DELETE FROM ${o}.agg_head WHERE day IN (SELECT day FROM ag_ad)`,
        `INSERT INTO ${o}.agg_head BY NAME SELECT * FROM ag_mh WHERE matches <> 0`,
      ]);
    }

    // 4) Rang-Zeilen gedeckter Tage ab der Frost-Grenze immer neu.
    if (rankDays.length) {
      await exec(`CREATE OR REPLACE TABLE ag_rb AS SELECT bid, mid, day, patch, region, placement, rank
        FROM ${o}.boards WHERE day IN (${inList(rankDays)})`);
      await exec(`CREATE OR REPLACE TABLE ag_rcl AS ${aggClSql('ag_rb')}`);
      await exec(`CREATE OR REPLACE TABLE ag_rr AS ${rowsSelect('rank', { b: 'ag_rb', compList }, 'SELECT * FROM ag_rcl', 1)}`);
      await tx([
        `DELETE FROM ${o}.agg_rows WHERE variant = 'rank' AND day IN (${inList(rankDays)})`,
        `INSERT INTO ${o}.agg_rows BY NAME SELECT * FROM ag_rr`,
      ]);
    }
    const tKeep = now();

    // 5) Ungedeckte Tage: Tage des neuesten Patches immer, sonst neueste
    //    zuerst bis zur Frist. Je Block eine nach Tag sortierte Kopie, je Tag
    //    eine Transaktion.
    await exec(`CREATE OR REPLACE TABLE ag_dp AS SELECT DISTINCT day, patch FROM ${o}.boards`);
    const days = await col('SELECT DISTINCT day::VARCHAR AS v FROM ag_dp ORDER BY 1');
    res.newest = (await all(`SELECT patch AS v FROM ag_dp WHERE patch IS NOT NULL GROUP BY patch ORDER BY min(day) DESC, patch DESC LIMIT 1`))[0]?.v ?? null;
    const newestDays = res.newest == null ? [] : await col(`SELECT day::VARCHAR AS v FROM ag_dp WHERE patch = ${lit(res.newest)} ORDER BY 1`);
    const plan = planAgg({ nowMs: now(), t0Ms, budgetS, days, covered: keep, newestDays });
    const queue = [...plan.todo];
    const names = { b: 'ag_b', u: 'ag_u', t: 'ag_t', compList };
    const cl = 'SELECT * FROM ag_c';
    while (queue.length) {
      const block = [];
      while (queue.length && block.length < BLOCK_DAYS) {
        const e = queue.shift();
        if (aggDue(plan, e, now())) block.push(e);
      }
      if (!block.length) break;
      const tb = now();
      await exec('DETACH DATABASE IF EXISTS aw');
      for (const f of [files.aggwork, `${files.aggwork}.wal`]) fs.rmSync(f, { force: true });
      await exec(`ATTACH ${lit(files.aggwork)} AS aw`);
      const IN = inList(block.map((e) => e.day));
      await exec(`CREATE TABLE aw.bd AS SELECT bid, mid, day, patch, region, placement, level, last_round, gold_left, family, rank
        FROM ${o}.boards WHERE day IN (${IN}) ORDER BY day, mid`);
      await exec(`CREATE TABLE aw.cl AS SELECT * FROM (${aggClSql('aw.bd')}) ORDER BY day, mid`);
      await exec(`CREATE TABLE aw.ud AS SELECT b.day, u.bid, u.unit, u.star, u.i1, u.i2, u.i3
        FROM ${o}.units u JOIN aw.bd b USING (bid) ORDER BY b.day, u.bid`);
      await exec(`CREATE TABLE aw.td AS SELECT b.day, t.bid, t.trait, t.lvl, t.overcap
        FROM ${o}.traits t JOIN aw.bd b USING (bid) ORDER BY b.day, t.bid`);
      const copyS = (now() - tb) / 1000;
      let nDone = 0;
      for (const e of block) {
        if (!aggDue(plan, e, now())) continue;
        const D = dLit(e.day);
        for (const [view, src] of [['ag_b', 'aw.bd'], ['ag_u', 'aw.ud'], ['ag_t', 'aw.td'], ['ag_c', 'aw.cl']]) {
          await exec(`CREATE OR REPLACE TEMP VIEW ${view} AS SELECT * FROM ${src} WHERE day = ${D}`);
        }
        await tx([
          `DELETE FROM ${o}.agg_rows WHERE day = ${D}`,
          `DELETE FROM ${o}.agg_head WHERE day = ${D}`,
          `DELETE FROM ${o}.agg_days WHERE day = ${D}`,
          ...VARIANTS.map((v) => `INSERT INTO ${o}.agg_rows BY NAME ${rowsSelect(v, names, cl, 1)}`),
          `INSERT INTO ${o}.agg_head BY NAME ${aggHeadSql(cl)}`,
          `INSERT INTO ${o}.agg_days VALUES (${D})`,
        ]);
        nDone++;
      }
      res.newDays += nDone;
      log(`Teilsummen: ${nDone} Tage ${block[block.length - 1].day}..${block[0].day} (Kopie ${copyS.toFixed(1)} s,`
        + ` Rechnen ${((now() - tb) / 1000 - copyS).toFixed(1)} s)`);
      for (const v of ['ag_b', 'ag_u', 'ag_t', 'ag_c']) await exec(`DROP VIEW IF EXISTS ${v}`);
      await exec('DETACH DATABASE IF EXISTS aw');
      for (const f of [files.aggwork, `${files.aggwork}.wal`]) fs.rmSync(f, { force: true });
    }

    // 6) Pruefungen. Ein Verstoss leert die Summen, die Datei bleibt gueltig.
    const fails = await aggChecks({ all, outdb: o });
    if (fails.length) {
      const e = new Error(fails.join('; '));
      e.check = true;
      throw e;
    }

    // 7) agg_rows sortiert neu schreiben (Lesen ueberspringt dann Bloecke),
    //    Tag-Patch-Liste und Kennung.
    const token = crypto.randomUUID();
    await tx([
      `CREATE TABLE ${o}.agg_rows_s AS SELECT * FROM ${o}.agg_rows ORDER BY variant, patch, day`,
      `DROP TABLE ${o}.agg_rows`,
      `ALTER TABLE ${o}.agg_rows_s RENAME TO agg_rows`,
      `DELETE FROM ${o}.day_patches`,
      `INSERT INTO ${o}.day_patches SELECT day, patch FROM ag_dp ORDER BY day, patch`,
      `DELETE FROM ${o}.agg_meta`,
      `INSERT INTO ${o}.agg_meta VALUES (${lit(AGG_SIG)}, ${lit(token)}, ${Number(nextBid)}, ${lit(compHash)})`,
    ]);
    res.token = token;
    const coveredNow = new Set(await col(`SELECT day::VARCHAR AS v FROM ${o}.agg_days`));
    res.covered = coveredNow.size;
    res.total = days.length;
    res.newestCovered = newestDays.every((d) => coveredNow.has(d));
    if (mode === 'delta' && res.newest != null && !res.newestCovered) {
      res.alarms.push(`Teilsummen: neuester Patch ${res.newest} nicht voll gedeckt`);
    }
    log(`Teilsummen: ${res.covered}/${res.total} Tage gedeckt, ${res.newDays} neu, ${drop.length} raus${reason ? ` (neu begonnen: ${reason})` : ''},`
      + ` Partie-Delta ${res.partMatches} Partien, Rang neu ${rankDays.length} Tage (${((tKeep - t1) / 1000).toFixed(1)} s),`
      + ` neuester Patch ${res.newest ?? '—'} ${res.newestCovered ? 'voll' : 'NICHT voll'} gedeckt`);
  } catch (e) {
    log(`Teilsummen: ${e.check ? 'Pruefung' : 'FEHLER'} ${e.message} — Summen werden geleert`);
    res.token = null;
    res.alarms.push(`Teilsummen-${e.check ? 'Pruefung' : 'Schritt'} gescheitert: ${e.message}`);
    try { await reset(); } catch (e2) { log(`Teilsummen: Leeren gescheitert (${e2.message}) — Summen ohne Kennung bleiben unbenutzt`); }
  } finally {
    fs.rmSync(files.aggtry, { force: true });
    try { await exec('DETACH DATABASE IF EXISTS aw'); } catch { /* egal */ }
    for (const f of [files.aggwork, `${files.aggwork}.wal`]) fs.rmSync(f, { force: true });
  }
  return finish();
}

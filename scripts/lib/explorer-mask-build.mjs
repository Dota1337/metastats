// Bau-Schritt der Platz-Masken (Paket 6). Laeuft im Explorer-Bau direkt nach
// den Teilsummen (aggStep), auf derselben Verbindung: Standard-Datenbank =
// Arbeitsdatei, `outdb` = die neue Explorer-Datei. Eigene Datei, damit
// scripts/oneoff/explorer-mask-equality.mjs den Schritt gegen eine lokale
// Kopie fahren kann, ohne den Bau zu laden.
//
// Reihenfolge Pflicht-Summen > fehlende Summen > Masken: der Schritt laeuft
// erst nach aggStep und rechnet neue Tage nur im Rest des Teilsummen-Budgets
// (gezaehlt ab deren Start), im Vollaufbau nie ueber den Laufzeit-Alarm
// (capMs). Ein Masken-Fehler leert nur die Masken, nie die Summen.
//
// DuckDB-Regeln wie in explorer-agg-build.mjs: jede Transaktion schreibt nur
// in outdb, im Fehlerfall ausdrueckliches ROLLBACK. Invariante: Masken-Zeilen
// nur fuer Tage aus mask_days; ein Tag ist entweder gedeckt (mask_days) oder
// gescheitert (mask_fail) oder offen.

import fs from 'node:fs';
import crypto from 'node:crypto';
import { aggBudgetS, aggCopyEstS } from './explorer-agg.mjs';
import { BLOCK_DAYS, lit, dLit, inList, cols, UNIT_COLS, TRAIT_COLS } from './explorer-agg-build.mjs';
import {
  MASK_DATA_TABLES, MASK_TABLES, MASK_COLS, MASK_ORDER, MASK_SIG, MASK_FP_EMPTY, maskTablesDdl, maskSql, maskFp, maskFpAdd,
  maskCheckG, maskMultiDaySql, maskCheckH, maskBindingReason, maskEnabled, maskCarryDays, maskQueue, maskDeadlineMs, maskHardMs,
} from './explorer-mask.mjs';

const TEMP_VIEWS = ['mk_b', 'mk_u', 'mk_t', 'mk_dm'];
const TEMP_TABLES = ['mk_fd', 'mk_pm', 'mk_pb', 'mk_pu', 'mk_pt', 'mk_nb', 'mk_fb'];
// Tabellen mit Tageszeilen, die beim Entdecken eines Tages mit raus muessen.
const DAY_TABLES = [...MASK_DATA_TABLES, 'mask_days'];

// Der Schritt. Liefert { token, covered, total, newDays, carried, ... };
// token = null heisst: keine gueltigen Masken in der Datei (Dienst rechnet
// wie heute). Wirft nie.
//
// newBoards: Tabelle (bid, mid, day, ...) der in diesem Lauf neuen Boards —
// Teil-Aufbau `nb`, Vollaufbau mit Uebernahme `cv_nb`. carry (nur Vollaufbau):
// { path, oldFp, newFp } — vorige Datei und die Tages-Fingerabdruecke der
// Teilsummen-Uebernahme (aggCarrySave/aggCarryMatch).
export async function maskStep({
  exec, all, log, outdb: o, mode, win, newBoards = 'nb', t0Ms, aggStartMs, files, compList, compHash, carry = null,
  budgetRaw = process.env.AGG_BUDGET_S, masksEnv = process.env.AGG_MASKS, capMs = null, now = () => Date.now(),
}) {
  const t1 = now();
  const res = {
    token: null, covered: 0, total: 0, newDays: 0, carried: 0, partMatches: 0, partDays: 0, failed: [], uiRedone: 0,
    dropped: 0, s: 0, copyS: 0, calcS: 0, alarms: [], reason: null,
  };
  const n = async (sql) => Number((await all(sql))[0]?.n ?? 0);
  const col = async (sql) => (await all(sql)).map((r) => String(r.v));
  // check: Pruefung innerhalb der Transaktion (sieht die eigenen Zeilen);
  // Verstoss → ROLLBACK und Fehler mit e.check.
  const tx = async (stmts, check = null) => {
    await exec('BEGIN TRANSACTION');
    try {
      for (const s of stmts) await exec(s);
      if (check) {
        const fails = await check();
        if (fails.length) {
          const e = new Error(fails.join('; '));
          e.check = true;
          throw e;
        }
      }
      await exec('COMMIT');
    } catch (e) {
      try { await exec('ROLLBACK'); } catch { /* schon zu */ }
      throw e;
    }
  };
  const dropAll = () => tx(MASK_TABLES.map((t) => `DROP TABLE IF EXISTS ${o}.${t}`));
  const reset = () => tx([...MASK_TABLES.map((t) => `DROP TABLE IF EXISTS ${o}.${t}`), ...maskTablesDdl(o)]);
  const sec = (x) => Math.round(x * 10) / 10;
  const finish = () => {
    res.s = Math.round((now() - t1) / 1000);
    res.copyS = sec(res.copyS);
    res.calcS = sec(res.calcS);
    return res;
  };
  const budgetS = aggBudgetS(budgetRaw);

  try {
    if (!maskEnabled(masksEnv)) {
      await dropAll();
      fs.rmSync(files.masktry, { force: true });
      res.reason = 'AGG_MASKS=0';
      log('Masken: AGG_MASKS=0 — Masken-Tabellen entfernt, keine Rechnung');
      return finish();
    }
    if (fs.existsSync(files.masktry)) {
      await reset();
      fs.rmSync(files.masktry, { force: true });
      res.reason = 'Absturz beim letzten Lauf';
      res.alarms.push('Masken-Schritt beim letzten Lauf abgestuerzt — diesmal ohne Masken');
      log('Masken: Versuchs-Stempel vom letzten Lauf gefunden — Masken geleert, der naechste Lauf rechnet neu');
      return finish();
    }
    if (budgetS === 0) {
      await reset();
      res.reason = 'AGG_BUDGET_S=0';
      log('Masken: AGG_BUDGET_S=0 — Masken geleert, keine Rechnung');
      return finish();
    }
  } catch (e) {
    log(`Masken: Leeren gescheitert (${e.message}) — Masken ohne Kennung bleiben unbenutzt`);
    res.alarms.push(`Masken-Schritt gescheitert: ${e.message}`);
    return finish();
  }

  fs.writeFileSync(files.masktry, JSON.stringify({ pid: process.pid, startedAt: new Date(t1).toISOString() }));
  // Neue Tage, Uebernahme, ui: nur Rest-Budget. Nachziehen gedeckter Tage:
  // harte Grenze, sonst verliert der Tag seine Deckung.
  const deadlineMs = maskDeadlineMs({ aggStartMs, t0Ms, budgetS, capMs });
  const hardMs = maskHardMs({ t0Ms, capMs });
  const covered = new Set();
  const uncover = async (list) => {
    if (!list.length) return;
    await tx(DAY_TABLES.map((t) => `DELETE FROM ${o}.${t} WHERE day IN (${inList(list)})`));
    for (const d of list) covered.delete(d);
  };
  const recordFail = async (d, fp, why) => {
    const D = dLit(d);
    await tx([
      ...[...DAY_TABLES, 'mask_fail'].map((t) => `DELETE FROM ${o}.${t} WHERE day = ${D}`),
      `INSERT INTO ${o}.mask_fail VALUES (${D}, ${lit(fp)}, ${lit(why)})`,
    ]);
    covered.delete(d);
    res.failed.push(`${d}: ${why}`);
    log(`Masken: Tag ${d} nicht gedeckt — ${why}`);
  };
  try {
    // 1) Generation. Teil-Aufbau: Masken der Arbeitskopie nur, wenn
    //    Rechenweg und Kennung passen. Vollaufbau mit Uebernahme: Tage mit
    //    gleichem Fingerabdruck aus der vorigen Datei kopieren (nur im Budget).
    let reason = null;
    if (mode === 'delta') {
      reason = await maskBindingReason({ all, db: o });
      if (reason) await reset();
    } else {
      await reset();
      if (!carry) reason = 'Vollaufbau';
      else {
        await exec(`ATTACH ${lit(carry.path)} AS mprev (READ_ONLY)`);
        reason = await maskBindingReason({ all, db: 'mprev' });
        if (!reason) {
          const prevDays = await col('SELECT day::VARCHAR AS v FROM mprev.mask_days');
          const take = maskCarryDays({ oldFp: carry.oldFp, newFp: carry.newFp, maskDays: prevDays, w: win.w });
          const done = [];
          for (const d of take) {
            if (now() >= deadlineMs) break;
            const D = dLit(d);
            await tx([
              ...MASK_DATA_TABLES.map((t) => `INSERT INTO ${o}.${t} BY NAME SELECT ${MASK_COLS[t].join(', ')}
                FROM mprev.${t} WHERE day = ${D} ORDER BY ${MASK_ORDER[t]}`),
              `INSERT INTO ${o}.mask_days SELECT day, fp, comp_hash FROM mprev.mask_days WHERE day = ${D}`,
            ]);
            done.push(d);
          }
          res.carried = done.length;
          // Gescheiterte Tage behalten ihre Sperre (Fingerabdruck wird in 5 geprueft).
          await tx([`INSERT INTO ${o}.mask_fail SELECT day, fp, why FROM mprev.mask_fail WHERE day >= ${dLit(win.w)}`
            + `${done.length ? ` AND day NOT IN (${inList(done)})` : ''}`]);
          if (done.length < take.length) log(`Masken-Uebernahme: Frist erreicht, ${take.length - done.length} Tage nicht kopiert`);
          log(`Masken-Uebernahme: ${done.length}/${prevDays.length} Tage kopiert`);
        } else {
          await reset();
        }
        await exec('DETACH DATABASE IF EXISTS mprev');
      }
    }
    res.reason = reason;

    // 2) Tage ohne Boards (vor dem Fenster) raus, inklusive mask_fail.
    await exec(`CREATE OR REPLACE TABLE mk_fd AS SELECT DISTINCT day FROM ${o}.boards`);
    const days = await col('SELECT day::VARCHAR AS v FROM mk_fd ORDER BY 1');
    const stale = await col(`SELECT DISTINCT day::VARCHAR AS v FROM (SELECT day FROM ${o}.mask_days UNION ALL SELECT day FROM ${o}.mask_fail)
      WHERE day NOT IN (SELECT day FROM mk_fd) ORDER BY 1`);
    if (stale.length) {
      await tx([...DAY_TABLES, 'mask_fail'].map((t) => `DELETE FROM ${o}.${t} WHERE day IN (${inList(stale)})`));
      res.dropped = stale.length;
    }
    for (const d of await col(`SELECT day::VARCHAR AS v FROM ${o}.mask_days`)) covered.add(d);

    // 3) (g) ueber die ganze Datei: Partien an mehr als einem Tag. Solche
    //    Tage sind nicht maskierbar (je Partie ein Byte je Tag).
    const bad = new Map((await col(maskMultiDaySql(o))).map((d) => [d, '(g) Partie an mehr als einem Tag']));
    await uncover([...covered].filter((d) => bad.has(d)));

    // 4) Neue Partien auf gedeckten Tagen: deren Masken-Zeilen loeschen und
    //    aus allen Boards der Partie neu bilden; Fingerabdruck += neue Boards.
    //    Tage mit altem comp_hash bekommen NULL (ui gemischt) → Schritt 7.
    const partDays = [...covered];
    if (partDays.length) {
      await exec(`CREATE OR REPLACE TABLE mk_pm AS SELECT DISTINCT mid, day FROM ${newBoards} WHERE day IN (${inList(partDays)})`);
      res.partMatches = await n('SELECT count(*) AS n FROM mk_pm');
    }
    if (res.partMatches) {
      await exec(`CREATE OR REPLACE TABLE mk_pb AS SELECT bid, mid, day, placement FROM ${o}.boards WHERE mid IN (SELECT mid FROM mk_pm)`);
      await exec(`CREATE OR REPLACE TABLE mk_pu AS SELECT bid, ${cols(UNIT_COLS)} FROM ${o}.units WHERE bid IN (SELECT bid FROM mk_pb)`);
      await exec(`CREATE OR REPLACE TABLE mk_pt AS SELECT bid, ${cols(TRAIT_COLS)} FROM ${o}.traits WHERE bid IN (SELECT bid FROM mk_pb)`);
      await exec(`CREATE OR REPLACE TABLE mk_nb AS SELECT * FROM mk_pb WHERE bid IN (SELECT bid FROM ${newBoards})`);
      const gBad = await maskCheckG(all, { b: 'mk_pb', u: 'mk_pu', t: 'mk_pt' });
      const nfp = await maskFp(all, { b: 'mk_nb', u: 'mk_pu', t: 'mk_pt' });
      const pdays = await col('SELECT DISTINCT day::VARCHAR AS v FROM mk_pm ORDER BY 1 DESC');
      const late = [];
      let stop = false;
      for (const d of pdays) {
        if (stop || now() >= hardMs) { late.push(d); continue; }
        const D = dLit(d);
        const oldFp = (await all(`SELECT fp FROM ${o}.mask_days WHERE day = ${D}`))[0]?.fp;
        const fullFp = maskFpAdd(oldFp, nfp.get(d) ?? MASK_FP_EMPTY);
        if (gBad.has(d)) { await recordFail(d, fullFp, gBad.get(d)); continue; }
        await exec(`CREATE OR REPLACE TEMP VIEW mk_b AS SELECT * FROM mk_pb WHERE day = ${D}`);
        await exec('CREATE OR REPLACE TEMP VIEW mk_dm AS SELECT DISTINCT mid FROM mk_b');
        const names = { b: 'mk_b', u: 'mk_pu', t: 'mk_pt' };
        try {
          await tx([
            ...MASK_DATA_TABLES.map((t) => `DELETE FROM ${o}.${t} WHERE day = ${D} AND mid IN (SELECT mid FROM mk_dm)`),
            ...['mask_um', 'mask_uk', 'mask_ut'].map((t) => `INSERT INTO ${o}.${t} BY NAME ${maskSql(t, names)}`),
            `INSERT INTO ${o}.mask_ui BY NAME ${maskSql('mask_ui', {
              uk: `(SELECT * FROM ${o}.mask_uk WHERE day = ${D} AND mid IN (SELECT mid FROM mk_dm))`, compList,
            })}`,
            `UPDATE ${o}.mask_days SET fp = ${lit(fullFp)},
              comp_hash = CASE WHEN comp_hash = ${lit(compHash)} THEN comp_hash ELSE NULL END WHERE day = ${D}`,
          ], () => maskCheckH(all, { o, D, b: 'mk_b', u: 'mk_pu', t: 'mk_pt', compList, mids: 'mk_dm' }));
          res.partDays++;
        } catch (e) {
          if (e.check) { await recordFail(d, fullFp, e.message); continue; }
          // Unerwartet: Tag (und alle danach) entdecken — ohne die neuen
          // Partien waeren seine Masken falsch.
          res.alarms.push(`Masken: Nachziehen ${d} gescheitert: ${e.message}`);
          log(`Masken: Nachziehen ${d} gescheitert (${e.message}) — Tag und Rest entdeckt`);
          late.push(d);
          stop = true;
        }
      }
      if (late.length) {
        await uncover(late);
        if (!stop) log(`Masken: Frist fuer das Nachziehen erreicht — ${late.length} Tage entdeckt (${late.join(', ')})`);
      }
    }

    // 5) Gescheiterte Tage: neuer Versuch nur bei anderem Fingerabdruck.
    const failRows = await all(`SELECT day::VARCHAR AS d, fp FROM ${o}.mask_fail`);
    const skip = [];
    if (failRows.length) {
      await exec(`CREATE OR REPLACE TABLE mk_fb AS SELECT bid, mid, day, placement FROM ${o}.boards
        WHERE day IN (${inList(failRows.map((r) => String(r.d)))})`);
      const realFp = await maskFp(all, { b: 'mk_fb', u: `${o}.units`, t: `${o}.traits` });
      const retry = [];
      for (const r of failRows) {
        const d = String(r.d);
        if ((realFp.get(d) ?? MASK_FP_EMPTY) === r.fp) skip.push(d);
        else retry.push(d);
      }
      if (retry.length) await tx([`DELETE FROM ${o}.mask_fail WHERE day IN (${inList(retry)})`]);
    }

    // 6) Offene Tage, neueste zuerst, bis zur Frist. Je Block eine nach Tag
    //    sortierte Kopie, je Tag eine Transaktion mit Pruefung (h).
    const queue = maskQueue({ days, covered: [...covered], skip });
    const names = { b: 'mk_b', u: 'mk_u', t: 'mk_t' };
    let maxCopyS = 0;
    let stop = false;
    while (queue.length && !stop) {
      const est = aggCopyEstS(maxCopyS);
      if (now() + est * 1000 >= deadlineMs) {
        log(`Masken: Frist reicht nicht fuer Kopie (~${Math.round(est)} s), ${queue.length} Tage offen`);
        break;
      }
      const block = queue.splice(0, BLOCK_DAYS);
      const tb = now();
      await exec('DETACH DATABASE IF EXISTS mw');
      for (const f of [files.maskwork, `${files.maskwork}.wal`]) fs.rmSync(f, { force: true });
      await exec(`ATTACH ${lit(files.maskwork)} AS mw`);
      const IN = inList(block);
      await exec(`CREATE TABLE mw.bd AS SELECT bid, mid, day, placement FROM ${o}.boards WHERE day IN (${IN}) ORDER BY day, mid`);
      await exec(`CREATE TABLE mw.ud AS SELECT b.day, u.bid, ${cols(UNIT_COLS, 'u')}
        FROM ${o}.units u JOIN mw.bd b USING (bid) ORDER BY b.day, u.bid`);
      await exec(`CREATE TABLE mw.td AS SELECT b.day, t.bid, ${cols(TRAIT_COLS, 't')}
        FROM ${o}.traits t JOIN mw.bd b USING (bid) ORDER BY b.day, t.bid`);
      const copyS = (now() - tb) / 1000;
      maxCopyS = Math.max(maxCopyS, copyS);
      const done = [];
      for (const d of block) {
        if (now() >= deadlineMs) { stop = true; break; }
        const D = dLit(d);
        for (const [view, src] of [['mk_b', 'mw.bd'], ['mk_u', 'mw.ud'], ['mk_t', 'mw.td']]) {
          await exec(`CREATE OR REPLACE TEMP VIEW ${view} AS SELECT * FROM ${src} WHERE day = ${D}`);
        }
        const fp = (await maskFp(all, names)).get(d) ?? MASK_FP_EMPTY;
        const why = bad.get(d) ?? (await maskCheckG(all, names)).get(d);
        if (why) { await recordFail(d, fp, why); continue; }
        try {
          await tx([
            ...[...DAY_TABLES, 'mask_fail'].map((t) => `DELETE FROM ${o}.${t} WHERE day = ${D}`),
            ...['mask_um', 'mask_uk', 'mask_ut'].map((t) => `INSERT INTO ${o}.${t} BY NAME ${maskSql(t, names)}`),
            `INSERT INTO ${o}.mask_ui BY NAME ${maskSql('mask_ui', { uk: `(SELECT * FROM ${o}.mask_uk WHERE day = ${D})`, compList })}`,
            `INSERT INTO ${o}.mask_days VALUES (${D}, ${lit(fp)}, ${lit(compHash)})`,
          ], () => maskCheckH(all, { o, D, b: 'mk_b', u: 'mk_u', t: 'mk_t', compList }));
          covered.add(d);
          done.push(d);
        } catch (e) {
          if (e.check) { await recordFail(d, fp, e.message); continue; }
          res.alarms.push(`Masken: Tag ${d} gescheitert: ${e.message}`);
          log(`Masken: Tag ${d} gescheitert (${e.message}) — keine weiteren Tage in diesem Lauf`);
          stop = true;
          break;
        }
      }
      const calcS = (now() - tb) / 1000 - copyS;
      res.newDays += done.length;
      res.copyS += copyS;
      res.calcS += calcS;
      log(`Masken: ${done.length} Tage ${block[block.length - 1]}..${block[0]} (Kopie ${copyS.toFixed(1)} s, Rechnen ${calcS.toFixed(1)} s)`);
      for (const v of ['mk_b', 'mk_u', 'mk_t']) await exec(`DROP VIEW IF EXISTS ${v}`);
      await exec('DETACH DATABASE IF EXISTS mw');
      for (const f of [files.maskwork, `${files.maskwork}.wal`]) fs.rmSync(f, { force: true });
    }

    // 7) Komponenten-Wechsel (niedrigste Stufe): ui der Tage mit anderem
    //    comp_hash aus uk neu. Bis dahin zaehlen ihre ui-Zeilen im Dienst nicht.
    const uiDays = await col(`SELECT day::VARCHAR AS v FROM ${o}.mask_days
      WHERE comp_hash IS DISTINCT FROM ${lit(compHash)} ORDER BY 1 DESC`);
    let uiLate = 0;
    let uiBad = 0;
    for (const d of uiDays) {
      if (now() >= deadlineMs) { uiLate = uiDays.length - res.uiRedone - uiBad; break; }
      const D = dLit(d);
      // Verstoss: Tag behaelt den alten Stand (ui zaehlt im Dienst nicht), Rest laeuft weiter.
      const redo = () => tx([
        `DELETE FROM ${o}.mask_ui WHERE day = ${D}`,
        `INSERT INTO ${o}.mask_ui BY NAME ${maskSql('mask_ui', { uk: `(SELECT * FROM ${o}.mask_uk WHERE day = ${D})`, compList })}`,
        `UPDATE ${o}.mask_days SET comp_hash = ${lit(compHash)} WHERE day = ${D}`,
      ], async () => {
        const r = (await all(`SELECT
          (SELECT coalesce(sum(bit_count(m)), 0)::DOUBLE FROM ${o}.mask_ui WHERE day = ${D}) AS a,
          (SELECT coalesce(sum(bit_count(m)), 0)::DOUBLE FROM ${o}.mask_uk WHERE day = ${D} AND NOT list_contains(${compList}, item)) AS b`))[0];
        return Number(r.a) === Number(r.b) ? [] : [`(h) mask_ui ${Number(r.a)} Bits ≠ ${Number(r.b)} aus uk`];
      });
      try {
        await redo();
        res.uiRedone++;
      } catch (e) {
        if (!e.check) throw e;
        uiBad++;
        res.alarms.push(`Masken: ui ${d} nicht nachgerechnet: ${e.message}`);
        log(`Masken: ui ${d} nicht nachgerechnet (${e.message})`);
      }
    }
    if (uiLate) log(`Masken: ui fuer ${uiLate} Tage mit altem Komponenten-Stand offen`);

    // 8) Invariante, Kennung.
    const tInv = now();
    const orphan = await n(`SELECT count(*) AS n FROM (${MASK_DATA_TABLES.map((t) => `SELECT DISTINCT day FROM ${o}.${t}`).join(' UNION ')}) x
      WHERE day NOT IN (SELECT day FROM ${o}.mask_days)`);
    if (orphan) throw new Error(`${orphan} Tage mit Masken-Zeilen ausserhalb der Deckung`);
    const invS = (now() - tInv) / 1000;
    const token = crypto.randomUUID();
    await tx([`DELETE FROM ${o}.mask_meta`, `INSERT INTO ${o}.mask_meta VALUES (${lit(MASK_SIG)}, ${lit(token)})`]);
    res.token = token;
    res.covered = await n(`SELECT count(*) AS n FROM ${o}.mask_days`);
    res.total = days.length;
    if (res.failed.length) {
      res.alarms.push(`Masken: ${res.failed.length} Tage gescheitert (${res.failed.join('; ')})`);
    }
    log(`Masken: ${res.covered}/${res.total} Tage gedeckt, ${res.carried ? `${res.carried} uebernommen, ` : ''}${res.newDays} neu,`
      + ` ${res.dropped} raus, Nachzug ${res.partMatches} Partien an ${res.partDays} Tagen, ${res.failed.length} gescheitert`
      + ` (${skip.length} gesperrt), ui neu ${res.uiRedone} Tage${reason ? ` (neu begonnen: ${reason})` : ''}`
      + ` — Kopie ${sec(res.copyS)} s, Rechnen ${sec(res.calcS)} s, Pruefung ${invS.toFixed(1)} s`);
  } catch (e) {
    log(`Masken: FEHLER ${e.message} — Masken werden geleert`);
    res.token = null;
    res.alarms.push(`Masken-Schritt gescheitert: ${e.message}`);
    try { await reset(); } catch (e2) { log(`Masken: Leeren gescheitert (${e2.message}) — Masken ohne Kennung bleiben unbenutzt`); }
  } finally {
    try { fs.rmSync(files.masktry, { force: true }); } catch { /* egal */ }
    for (const db of ['mw', 'mprev']) {
      try { await exec(`DETACH DATABASE IF EXISTS ${db}`); } catch { /* egal */ }
    }
    for (const f of [files.maskwork, `${files.maskwork}.wal`]) {
      try { fs.rmSync(f, { force: true }); } catch { /* egal */ }
    }
    for (const v of TEMP_VIEWS) {
      try { await exec(`DROP VIEW IF EXISTS ${v}`); } catch { /* egal */ }
    }
    for (const t of TEMP_TABLES) {
      try { await exec(`DROP TABLE IF EXISTS ${t}`); } catch { /* egal */ }
    }
  }
  return finish();
}

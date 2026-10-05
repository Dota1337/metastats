/**
 * Tests fuer die Korrektur der Patch-Namen in tft_daily_* (tft-patch-relabel.mjs).
 *
 * Warum: Das Werkzeug schreibt in die Tagesstatistik, aus der jede TFT-Seite
 * liest. Ein falscher Name faellt dort niemandem auf — die Seite zeigt still
 * die Zahlen eines anderen Patches. Getestet wird gegen eine nachgebaute
 * Datenbank, die genau das SQL des Werkzeugs auswertet und sich bei
 * Transaktionen, eindeutigen Schluesseln und abgebrochenen Transaktionen wie
 * Postgres verhaelt. Unbekanntes SQL laesst jeden Test scheitern.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { addDays, baseOf } from './tft-patch-day.mjs';
import {
  AUTO_CAP, CATALOG_SQL, CHANGED_MARKER_FILE, MAX_ERRORS, OFF_FILE, STATUS_FILE, STATUS_SCHEMA, classifyTables,
  defaultStateDir, deleteSql, parseArgs, planSql, quoteIdent, readChangedMarker, recordChangedPatches,
  remainingSql, runRelabel, scanSql, updateSql, writeStatus,
} from './tft-patch-relabel.mjs';

// ── Terminplan wie in tft-patch-day.test.mjs ────────────────────────────────
function deepFreeze(o) {
  if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); }
  return o;
}
const start = (patch, from_day, extra = {}) => ({ set: Number(patch.split('.')[0]), patch, from_day, seen_at: '2026-10-04T00:00:00Z', ...extra });
const cut = (patch, from_day, extra = {}) => ({ set: Number(patch.split('.')[0]), patch, base: baseOf(patch), from_day, ...extra });
const STARTS = [
  start('18.1', '2026-08-26'), start('18.2', '2026-09-10'), start('18.3', '2026-09-23'), start('18.4', '2026-10-07'),
  start('18.5', '2026-10-21'), start('18.6', '2026-11-04'), start('19.1', '2026-12-01'), start('19.2', '2026-12-15'),
];
const CUTS = [cut('18.1b', '2026-09-01'), cut('18.2b', '2026-09-14'), cut('18.3b', '2026-09-24')];
const meta = (over = {}) => deepFreeze({ setNumber: 18, latestPatch: '18.3', lolPatch: '16.19.1', patchStarts: STARTS, patchCuts: CUTS, ...over });
const META = meta();
const S = META.setNumber;
const PREV = S - 1;
// Sammeltag 2026-10-05 laeuft (ein Sammeltag beginnt um 05:00 UTC).
const NOW = new Date('2026-10-05T10:00:00Z');

// ── Nachgebaute Datenbank ───────────────────────────────────────────────────
// Wertet genau das SQL des Werkzeugs aus (strenge Muster, alles andere ist ein
// Fehler) und verhaelt sich wie Postgres: Schreiben nur in einer Transaktion,
// eindeutige Schluessel werfen 23505, nach einem Fehler ist die Transaktion
// abgebrochen (25P02) und COMMIT rollt dann zurueck.
const DEFS = {
  tft_daily_crawl_meta: { uniques: [{ name: 'tft_daily_crawl_meta_pkey', cols: ['region', 'bucket', 'day', 'set_number'] }] },
  tft_daily_unit_stats: { uniques: [
    { name: 'tft_daily_unit_stats_pkey', cols: ['id'] },
    { name: 'tft_daily_unit_stats_key', cols: ['region', 'bucket', 'patch', 'set_number', 'day', 'character_id'] },
  ] },
  tft_daily_comp_outcome: { uniques: [
    { name: 'tft_daily_comp_outcome_pkey', cols: ['region', 'bucket', 'patch', 'set_number', 'day', 'cluster_key'] },
  ] },
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const WRONG_W = esc('w.set_number = $1 and w.day = $2::date and w.patch is distinct from $3');
const WRONG_PLAIN = esc('set_number = $1 and day = $2::date and patch is distinct from $3');
const SQL = {
  set: /^set (local )?(\w+) = '([^']*)'$/,
  lock: /^select pg_try_advisory_xact_lock\(hashtext\(\$1\)\) as ok$/,
  scan: /^select day::text as day, patch, count\(\*\)::int as n from "(\w+)" where set_number = \$1( and day >= \$2::date and day <= \$3::date)? group by 1, 2$/,
  plan: new RegExp(`^select w\\.patch, count\\(\\*\\)::int as n, (.+) as collide from "(\\w+)" w where ${WRONG_W} group by w\\.patch order by w\\.patch$`),
  collide: /^count\(\*\) filter \(where exists \(select 1 from "(\w+)" t where (.+)\)\)::int$/,
  ambiguous: new RegExp(`^select count\\(\\*\\)::int as n from \\(select 1 from "(\\w+)" w where ${WRONG_W} and not exists \\(select 1 from "\\1" t where (.+)\\) group by (.+) having count\\(\\*\\) > 1\\) x$`),
  delete: new RegExp(`^delete from "(\\w+)" w using "\\1" t where ${WRONG_W} and (.+)$`),
  update: new RegExp(`^update "(\\w+)" set patch = \\$3 where ${WRONG_PLAIN}$`),
  remaining: new RegExp(`^select count\\(\\*\\)::int as n from "(\\w+)" where ${WRONG_PLAIN}$`),
};

// 't.patch = $3 and t."a" = w."a" and ...' → ['a', ...]; null, wenn anders gebaut.
function joinCols(expr) {
  const parts = expr.split(' and ');
  if (parts[0] !== 't.patch = $3') return null;
  const cols = [];
  for (const p of parts.slice(1)) {
    const m = p.match(/^t\."(\w+)" = w\."(\w+)"$/);
    if (!m || m[1] !== m[2]) return null;
    cols.push(m[1]);
  }
  return cols.length ? cols : null;
}

class FakeDb {
  constructor(defs = DEFS, { catalogOverride = null, catalogExtra = [] } = {}) {
    this.defs = defs;
    this.rows = Object.fromEntries(Object.keys(defs).map((name) => [name, []]));
    this.catalogOverride = catalogOverride;
    this.catalogExtra = catalogExtra;
    this.log = [];
    this.sqlErrors = [];
    this.settings = {};
    this.connects = 0;
    this.ended = 0;
    this.inTx = false;
    this.aborted = false;
    this.snapshot = null;
    this.lockBusy = false;
    this.fail = () => null;          // (kind, table, params) → Error | null
    this.skew = () => undefined;     // (kind, table, params) → falscher rowCount
    this.answer = () => undefined;   // (kind, table, params) → { rows } statt der echten
    this.nextId = 1;
  }

  insert(table, ...rows) {
    const withId = this.defs[table].uniques.some((u) => u.cols.includes('id'));
    for (const r of rows) this.rows[table].push(withId ? { id: this.nextId++, ...r } : { ...r });
    return this;
  }

  catalog() {
    if (this.catalogOverride) return this.catalogOverride;
    const own = Object.keys(this.defs).sort().map((tbl) => ({
      tbl,
      uniques: this.defs[tbl].uniques.map((u) => ({ partial: false, expr: false, nnd: false, ...u })),
    }));
    return [...own, ...this.catalogExtra];
  }

  count(kind, table) {
    return this.log.filter((e) => e.kind === kind && (table === undefined || e.table === table)).length;
  }

  client() {
    this.connects++;
    return { query: async (sql, params) => this.query(sql, params ?? []), end: async () => { this.ended++; } };
  }

  tableRows(table) {
    if (!this.rows[table]) throw Object.assign(new Error(`relation "${table}" does not exist`), { code: '42P01' });
    return this.rows[table];
  }

  isWrong(r, p) {
    return r.set_number === Number(p[0]) && r.day === p[1] && r.patch !== p[2];
  }

  hasTwin(table, w, cols, p) {
    return this.tableRows(table).some((t) => t.patch === p[2] && cols.every((c) => t[c] != null && t[c] === w[c]));
  }

  protocolError(msg) {
    this.sqlErrors.push(msg);
    throw new Error(msg);
  }

  needTx(what) {
    if (!this.inTx) this.protocolError(`${what} ausserhalb einer Transaktion`);
  }

  exec(kind, table, params, fn) {
    this.log.push({ kind, table, params: [...params] });
    try {
      const injected = this.fail(kind, table, params);
      if (injected) throw injected;
      const res = { rows: [], rowCount: null, ...fn() };
      const skewed = this.skew(kind, table, params);
      if (skewed !== undefined) res.rowCount = skewed;
      return { ...res, ...this.answer(kind, table, params) };
    } catch (err) {
      if (this.inTx) this.aborted = true;
      throw err;
    }
  }

  async query(text, params) {
    const sql = String(text).replace(/\s+/g, ' ').trim();
    if (sql === 'begin') {
      this.log.push({ kind: 'begin', table: null, params: [] });
      if (this.inTx) this.protocolError('begin in offener Transaktion');
      this.inTx = true;
      this.aborted = false;
      this.snapshot = structuredClone(this.rows);
      return { rows: [], rowCount: null };
    }
    if (sql === 'commit' || sql === 'rollback') {
      this.log.push({ kind: sql, table: null, params: [] });
      // COMMIT einer abgebrochenen Transaktion ist in Postgres ein ROLLBACK.
      if (this.inTx && (sql === 'rollback' || this.aborted)) this.rows = this.snapshot;
      this.inTx = false;
      this.aborted = false;
      this.snapshot = null;
      return { rows: [], rowCount: null };
    }
    if (this.aborted) {
      throw Object.assign(new Error('current transaction is aborted, commands ignored until end of transaction block'), { code: '25P02' });
    }

    let m;
    if (sql.includes('from pg_class c join pg_namespace n')) {
      if (sql !== CATALOG_SQL.replace(/\s+/g, ' ').trim()) this.protocolError(`Fake kennt SQL nicht: ${sql}`);
      return this.exec('catalog', null, params, () => ({ rows: structuredClone(this.catalog()) }));
    }
    if ((m = sql.match(SQL.set))) {
      const [, local, key, value] = m;
      return this.exec('set', null, params, () => {
        if (local) this.needTx('set local');
        this.settings[key] = value;
        return {};
      });
    }
    if (SQL.lock.test(sql)) {
      return this.exec('lock', null, params, () => {
        this.needTx('Transaktions-Lock');
        return { rows: [{ ok: !this.lockBusy }] };
      });
    }
    if ((m = sql.match(SQL.scan))) {
      const [, table, ranged] = m;
      return this.exec('scan', table, params, () => {
        const counts = new Map();
        for (const r of this.tableRows(table)) {
          if (r.set_number !== Number(params[0])) continue;
          if (ranged && (r.day < params[1] || r.day > params[2])) continue;
          const k = JSON.stringify([r.day, r.patch]);
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
        return { rows: [...counts].map(([k, n]) => { const [day, patch] = JSON.parse(k); return { day, patch, n }; }) };
      });
    }
    if ((m = sql.match(SQL.plan))) {
      const [, collideExpr, table] = m;
      let cols = null;
      if (collideExpr !== '0') {
        const c = collideExpr.match(SQL.collide);
        cols = c && c[1] === table ? joinCols(c[2]) : null;
        if (!cols) this.protocolError(`Fake kennt SQL nicht: ${sql}`);
      }
      return this.exec('plan', table, params, () => {
        const groups = new Map();
        for (const w of this.tableRows(table)) {
          if (!this.isWrong(w, params)) continue;
          const g = groups.get(w.patch) ?? { patch: w.patch, n: 0, collide: 0 };
          g.n++;
          if (cols && this.hasTwin(table, w, cols, params)) g.collide++;
          groups.set(w.patch, g);
        }
        return { rows: [...groups.values()].sort((a, b) => (a.patch < b.patch ? -1 : 1)) };
      });
    }
    if ((m = sql.match(SQL.ambiguous))) {
      const [, table, joinExpr, groupExpr] = m;
      const cols = joinCols(joinExpr);
      if (!cols || groupExpr !== cols.map((c) => `w."${c}"`).join(', ')) this.protocolError(`Fake kennt SQL nicht: ${sql}`);
      return this.exec('ambiguous', table, params, () => {
        const perKey = new Map();
        for (const w of this.tableRows(table)) {
          if (!this.isWrong(w, params) || this.hasTwin(table, w, cols, params)) continue;
          const k = JSON.stringify(cols.map((c) => w[c]));
          perKey.set(k, (perKey.get(k) ?? 0) + 1);
        }
        return { rows: [{ n: [...perKey.values()].filter((v) => v > 1).length }] };
      });
    }
    if ((m = sql.match(SQL.delete))) {
      const [, table, joinExpr] = m;
      const cols = joinCols(joinExpr);
      if (!cols) this.protocolError(`Fake kennt SQL nicht: ${sql}`);
      return this.exec('delete', table, params, () => {
        this.needTx('delete');
        const all = this.tableRows(table);
        const doomed = new Set(all.filter((w) => this.isWrong(w, params) && this.hasTwin(table, w, cols, params)));
        this.rows[table] = all.filter((r) => !doomed.has(r));
        return { rowCount: doomed.size };
      });
    }
    if ((m = sql.match(SQL.update))) {
      const [, table] = m;
      return this.exec('update', table, params, () => {
        this.needTx('update');
        let n = 0;
        const next = this.tableRows(table).map((r) => {
          if (!this.isWrong(r, params)) return r;
          n++;
          return { ...r, patch: params[2] };
        });
        for (const u of this.defs[table].uniques) {
          const seen = new Set();
          for (const r of next) {
            const k = JSON.stringify(u.cols.map((c) => r[c]));
            if (seen.has(k)) throw Object.assign(new Error(`duplicate key value violates unique constraint "${u.name}"`), { code: '23505' });
            seen.add(k);
          }
        }
        this.rows[table] = next;
        return { rowCount: n };
      });
    }
    if ((m = sql.match(SQL.remaining))) {
      const [, table] = m;
      return this.exec('remaining', table, params, () => ({ rows: [{ n: this.tableRows(table).filter((r) => this.isWrong(r, params)).length }] }));
    }
    return this.protocolError(`Fake kennt SQL nicht: ${sql}`);
  }
}

// ── Testdaten ───────────────────────────────────────────────────────────────
const U = 'tft_daily_unit_stats';
const M = 'tft_daily_crawl_meta';
const O = 'tft_daily_comp_outcome';
const row = (day, patch, extra = {}) => ({ region: 'euw1', bucket: 'challenger', set_number: S, day, patch, ...extra });
const unit = (day, patch, character_id = 'Ahri', extra = {}) => row(day, patch, { character_id, games: 1, ...extra });
const outcome = (day, patch, cluster_key, games = 1) => row(day, patch, { cluster_key, games });
const crawl = (day, patch, extra = {}) => row(day, patch, { matches: 1, ...extra });

//  09-22  richtig (18.2b)                       → bleibt
//  09-23  18.2b statt 18.3 (Go-Live-Tag)        → 18.3
//  09-24  18.2b statt 18.3b                     → 18.3b
//  09-28  comp_outcome 18.3 statt 18.3b         → 18.3b
//  09-29  c1 falsch UND richtig da, c2 falsch   → die richtige c1 gewinnt, c2 → 18.3b
//  10-05  laufender Sammeltag                   → bleibt
//  08-25  vor dem ersten Termin (Rueckfall)     → bleibt, nur Warnung
//  vorige Set am 09-23                          → bleibt
function seeded(db = new FakeDb()) {
  return db
    .insert(U,
      unit('2026-09-22', '18.2b'),
      unit('2026-09-23', '18.2b', 'Ahri'), unit('2026-09-23', '18.2b', 'Lulu'),
      unit('2026-09-24', '18.2b'),
      unit('2026-10-05', '18.3'),
      unit('2026-08-25', '18.1'),
      unit('2026-09-23', '17.9', 'Ahri', { set_number: PREV }))
    .insert(M,
      crawl('2026-09-23', '18.2b'), crawl('2026-09-24', '18.2b'), crawl('2026-09-28', '18.3b'),
      crawl('2026-09-23', '17.9', { set_number: PREV }))
    .insert(O,
      outcome('2026-09-28', '18.3', 'c1'), outcome('2026-09-28', '18.3', 'c2'),
      outcome('2026-09-29', '18.3', 'c1', 10), outcome('2026-09-29', '18.3b', 'c1', 99), outcome('2026-09-29', '18.3', 'c2', 5));
}

const pick = (db, table, day, setNum = S) => db.rows[table].filter((r) => r.day === day && r.set_number === setNum);
const patches = (db, table, day, setNum = S) => pick(db, table, day, setNum).map((r) => r.patch).sort();
const pgError = (code, message = 'duplicate key value violates unique constraint') => Object.assign(new Error(message), { code });

function capture() {
  const lines = { log: [], warn: [], error: [] };
  return {
    lines,
    log: (m) => lines.log.push(String(m)),
    warn: (m) => lines.warn.push(String(m)),
    error: (m) => lines.error.push(String(m)),
  };
}

function stateDirFor(t) {
  const dir = mkdtempSync(join(tmpdir(), 'tft-relabel-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

async function run(t, db, argv, { meta: m = META, metaError = null, now = NOW, stateDir, connect } = {}) {
  const args = parseArgs(argv);
  assert.equal(args.error, null);
  const out = capture();
  const dir = stateDir ?? stateDirFor(t);
  const res = await runRelabel({ args, meta: m, metaError, connect: connect ?? (async () => db.client()), now, stateDir: dir, log: out });
  assert.deepEqual(db.sqlErrors, [], 'unbekanntes SQL oder Schreiben ohne Transaktion');
  assert.equal(db.inTx, false, 'Transaktion offen geblieben');
  assert.equal(db.ended, db.connects, 'Verbindung nicht geschlossen');
  return { ...res, out: out.lines, dir };
}

// ── Argumente ───────────────────────────────────────────────────────────────
test('parseArgs: Standard ist ein Probelauf ueber die ganze Set', () => {
  assert.deepEqual(parseArgs([]), { selection: 'deep', write: 'dry-run', days: [], set: null, runId: null, expect: null, help: false, error: null });
});

test('parseArgs: --expect nimmt Tag=Patch, auch in der Schreibweise mit =', () => {
  assert.deepEqual(parseArgs(['--auto', '--expect', '2026-10-04=18.3b']).expect, { day: '2026-10-04', patch: '18.3b' });
  assert.deepEqual(parseArgs(['--expect=2026-10-04=18.3']).expect, { day: '2026-10-04', patch: '18.3' });
});

test('parseArgs: Auswahl, Schreibweise und Optionen', () => {
  const a = parseArgs(['--auto', '--apply', '--run-id', 'crawl-2026-10-05.start']);
  assert.equal(a.error, null);
  assert.equal(a.selection, 'auto');
  assert.equal(a.write, 'apply');
  assert.equal(a.runId, 'crawl-2026-10-05.start');
  const d = parseArgs(['--days', '2026-09-24, 2026-09-23', '--days=2026-09-23', '--trial']);
  assert.equal(d.error, null);
  assert.equal(d.selection, 'days');
  assert.equal(d.write, 'trial');
  assert.deepEqual(d.days, ['2026-09-24', '2026-09-23']);
  assert.equal(parseArgs(['--set', String(PREV)]).set, PREV);
  assert.equal(parseArgs(['--set=' + PREV, '--deep', '--dry-run']).set, PREV);
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('parseArgs: jede falsche Eingabe wird laut abgelehnt', () => {
  const cases = [
    [['--days'], /--days braucht Tage/],
    [['--days', '2026-02-30'], /kein gueltiger Tag: 2026-02-30/],
    [['--days', '2026-9-23'], /kein gueltiger Tag/],
    [['--days', '--apply'], /kein gueltiger Tag: --apply/],
    [['--set', 'abc'], /braucht eine Set-Nummer/],
    [['--set', '0'], /braucht eine Set-Nummer/],
    [['--set'], /braucht eine Set-Nummer/],
    [['--run-id', 'a b'], /--run-id/],
    [['--run-id', 'x'.repeat(81)], /--run-id/],
    [['--apply', '--trial'], /nur eine Schreibweise/],
    [['--auto', '--deep'], /nur eine Auswahl/],
    [['--auto', '--days', '2026-09-23'], /nur eine Auswahl/],
    [['--auto', '--set', String(PREV)], /geht nicht mit --auto/],
    [['--rollback'], /--rollback gibt es nicht mehr/],
    [['--apply=1'], /--apply nimmt keinen Wert/],
    [['--frobnicate'], /unbekannte Option/],
    [['apply'], /unbekannte Option/],
    [['--expect'], /--expect braucht Tag=Patch/],
    [['--expect', '2026-10-04'], /--expect braucht Tag=Patch/],
    [['--expect', '2026-13-01=18.3'], /--expect braucht Tag=Patch/],
    [['--expect', '2026-10-04=18.3x1'], /--expect braucht Tag=Patch/],
    [['--expect', '=18.3'], /--expect braucht Tag=Patch/],
  ];
  for (const [argv, re] of cases) assert.match(parseArgs(argv).error ?? '', re, argv.join(' '));
});

test('defaultStateDir: Umgebungsvariable vor Box-Ordner vor Temp-Ordner', () => {
  assert.equal(defaultStateDir({ TFT_RELABEL_STATE_DIR: '/x/y' }), '/x/y');
  assert.equal(defaultStateDir({}), existsSync('/etc/metastats-crawler') ? '/etc/metastats-crawler' : join(tmpdir(), 'metastats-tft-relabel'));
});

// ── Katalog und SQL ─────────────────────────────────────────────────────────
test('classifyTables: Schluessel ohne patch = plain, genau ein Schluessel mit patch = merge', () => {
  const { tables, refused } = classifyTables([
    { tbl: 'tft_daily_crawl_meta', uniques: [{ name: 'cm_pkey', cols: ['region', 'bucket', 'day', 'set_number'] }] },
    { tbl: 'tft_daily_unit_stats', uniques: [
      { name: 'us_pkey', cols: ['id'] },
      { name: 'us_key', cols: ['region', 'bucket', 'patch', 'set_number', 'day', 'character_id'] },
    ] },
    { tbl: 'tft_daily_no_index', uniques: [] },
    { tbl: 'tft_daily_null_uniques', uniques: null },
  ]);
  assert.deepEqual(refused, []);
  assert.deepEqual(tables, [
    { name: 'tft_daily_crawl_meta', mode: 'plain', keyCols: [], index: null },
    { name: 'tft_daily_unit_stats', mode: 'merge', keyCols: ['region', 'bucket', 'set_number', 'day', 'character_id'], index: 'us_key' },
    { name: 'tft_daily_no_index', mode: 'plain', keyCols: [], index: null },
    { name: 'tft_daily_null_uniques', mode: 'plain', keyCols: [], index: null },
  ]);
  assert.deepEqual(classifyTables(undefined), { tables: [], refused: [] });
});

test('classifyTables: alles, was sich nicht sicher zusammenfuehren laesst, wird abgelehnt', () => {
  const key = ['region', 'patch', 'set_number', 'day'];
  const { tables, refused } = classifyTables([
    { tbl: 'partial', uniques: [{ name: 'p_idx', partial: true, cols: key }] },
    { tbl: 'expr', uniques: [{ name: 'e_idx', expr: true, cols: ['region'] }] },
    { tbl: 'two', uniques: [{ name: 'a', cols: key }, { name: 'b', cols: ['patch', 'day', 'set_number', 'x'] }] },
    { tbl: 'nnd', uniques: [{ name: 'n_idx', nnd: true, cols: key }] },
    { tbl: 'noday', uniques: [{ name: 'd_idx', cols: ['region', 'patch', 'set_number'] }] },
    { tbl: 'nonumber', uniques: [{ name: 's_idx', cols: ['region', 'patch', 'day'] }] },
  ]);
  assert.deepEqual(tables, []);
  assert.deepEqual(refused.map((r) => r.name), ['partial', 'expr', 'two', 'nnd', 'noday', 'nonumber']);
  assert.match(refused[0].reason, /partiell/);
  assert.match(refused[1].reason, /Ausdrucks-Index/);
  assert.match(refused[2].reason, /2 eindeutige Indizes mit patch/);
  assert.match(refused[3].reason, /NULLS NOT DISTINCT/);
  assert.match(refused[4].reason, /day oder set_number/);
  assert.match(refused[5].reason, /day oder set_number/);
});

test('SQL: Namen gequotet, plain zaehlt keine Zwillinge, merge verknuepft ueber den ganzen Schluessel', () => {
  assert.equal(quoteIdent('a"b'), '"a""b"');
  const plain = { name: M, mode: 'plain', keyCols: [] };
  const merge = { name: O, mode: 'merge', keyCols: ['region', 'day'] };
  assert.match(planSql(plain), /, 0 as collide from "tft_daily_crawl_meta" w where /);
  assert.match(planSql(merge), /t\.patch = \$3 and t\."region" = w\."region" and t\."day" = w\."day"/);
  assert.match(deleteSql(merge), /^delete from "tft_daily_comp_outcome" w using "tft_daily_comp_outcome" t where /);
  assert.equal(updateSql(plain), 'update "tft_daily_crawl_meta" set patch = $3 where set_number = $1 and day = $2::date and patch is distinct from $3');
  assert.match(remainingSql(plain), /patch is distinct from \$3$/);
  assert.doesNotMatch(scanSql(plain, false), /\$2/);
  assert.match(scanSql(plain, true), /day >= \$2::date and day <= \$3::date/);
  assert.match(CATALOG_SQL, /like 'tft\\_daily\\_%'/);
});

// ── Laeufe ──────────────────────────────────────────────────────────────────
test('Probelauf ueber die ganze Set: zaehlt alles, schreibt nichts', async (t) => {
  const db = seeded();
  const before = structuredClone(db.rows);
  const { exitCode, status, out } = await run(t, db, ['--deep']);
  assert.equal(exitCode, 0);
  assert.deepEqual(db.rows, before);
  assert.equal(db.count('begin'), 0);
  assert.equal(db.count('update') + db.count('delete'), 0);
  assert.deepEqual(status.days.map((d) => [d.day, d.expected, d.status]), [
    ['2026-09-29', '18.3b', 'planned'],
    ['2026-09-28', '18.3b', 'planned'],
    ['2026-09-24', '18.3b', 'planned'],
    ['2026-09-23', '18.3', 'planned'],
  ]);
  assert.deepEqual(status.days[0].tables, { [O]: { wrong: { '18.3': 2 }, collide: 1, deleted: 0, updated: 0 } });
  assert.deepEqual(status.days[3].tables, {
    [M]: { wrong: { '18.2b': 1 }, collide: 0, deleted: 0, updated: 0 },
    [U]: { wrong: { '18.2b': 2 }, collide: 0, deleted: 0, updated: 0 },
  });
  assert.deepEqual(status.changedDays, []);
  assert.ok(out.log.some((l) => l.includes('Probelauf — nichts geschrieben')));
  assert.ok(out.log.some((l) => l.includes('2026-10-05: laufender Sammeltag')));
  assert.match(out.warn.join('\n'), /2026-08-25 \(18\.1: 1\): Tag 2026-08-25 liegt vor dem ersten Termin/);
});

test('--apply: jeder Tag bekommt seinen Namen, die richtige Zeile gewinnt, sonst wird nichts angefasst', async (t) => {
  const db = seeded();
  const { exitCode, status, out } = await run(t, db, ['--apply']);
  assert.equal(exitCode, 0);
  assert.equal(status.state, 'done');
  assert.deepEqual(status.changedDays, ['2026-09-29', '2026-09-28', '2026-09-24', '2026-09-23']);
  assert.deepEqual(patches(db, U, '2026-09-23'), ['18.3', '18.3']);
  assert.deepEqual(patches(db, M, '2026-09-23'), ['18.3']);
  assert.deepEqual(patches(db, U, '2026-09-24'), ['18.3b']);
  assert.deepEqual(patches(db, M, '2026-09-24'), ['18.3b']);
  assert.deepEqual(patches(db, O, '2026-09-28'), ['18.3b', '18.3b']);
  assert.deepEqual(patches(db, M, '2026-09-28'), ['18.3b']);
  // Zwilling: die schon richtig beschriftete Zeile (99 Spiele) bleibt, die
  // falsche (10) ist weg — nicht aufsummiert.
  assert.deepEqual(pick(db, O, '2026-09-29').map((r) => [r.cluster_key, r.patch, r.games]).sort(),
    [['c1', '18.3b', 99], ['c2', '18.3b', 5]]);
  // unberuehrt: richtig beschriftet, laufender Sammeltag, unsicherer Tag, vorige Set
  assert.deepEqual(patches(db, U, '2026-09-22'), ['18.2b']);
  assert.deepEqual(patches(db, U, '2026-10-05'), ['18.3']);
  assert.deepEqual(patches(db, U, '2026-08-25'), ['18.1']);
  assert.deepEqual(patches(db, U, '2026-09-23', PREV), ['17.9']);
  assert.deepEqual(patches(db, M, '2026-09-23', PREV), ['17.9']);
  // eine Transaktion je Tag, Zeitlimits gesetzt
  assert.equal(db.count('begin'), 4);
  assert.equal(db.count('commit'), 4);
  assert.equal(db.count('rollback'), 0);
  assert.deepEqual(db.settings, { statement_timeout: '150s', lock_timeout: '10s', idle_in_transaction_session_timeout: '120s' });
  assert.equal(status.days[0].tables[O].deleted, 1);
  assert.equal(status.days[0].tables[O].updated, 1);
  assert.ok(out.log.some((l) => l.includes('VACUUM (ANALYZE) tft_daily_comp_outcome, tft_daily_crawl_meta, tft_daily_unit_stats;')));
  // zweiter Lauf: nichts mehr zu tun
  const again = await run(t, db, ['--apply']);
  assert.equal(again.exitCode, 0);
  assert.deepEqual(again.status.changedDays, []);
  assert.ok(again.out.log.some((l) => l.includes('nichts zu korrigieren')));
  assert.equal(db.count('begin'), 4);
});

test('--trial: alles laeuft durch, jeder Tag wird zurueckgerollt', async (t) => {
  const db = seeded();
  const before = structuredClone(db.rows);
  const { exitCode, status } = await run(t, db, ['--trial']);
  assert.equal(exitCode, 0);
  assert.deepEqual(db.rows, before);
  assert.deepEqual(status.days.map((d) => d.status), ['trial', 'trial', 'trial', 'trial']);
  assert.deepEqual(status.changedDays, []);
  assert.equal(status.days[0].tables[O].deleted, 1);
  assert.equal(db.count('begin'), 4);
  assert.equal(db.count('rollback'), 4);
  assert.equal(db.count('commit'), 0);
  assert.ok(db.count('update') > 0);
});

test('Unsicherer Tag: nur Warnung; ausdruecklich verlangt → liegen gelassen, Exit 1', async (t) => {
  const db = seeded();
  const r = await run(t, db, ['--days', '2026-08-25', '--apply']);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.status.days.map((d) => [d.day, d.status]), [['2026-08-25', 'skipped']]);
  assert.match(r.status.days[0].message, /vor dem ersten Termin/);
  assert.equal(db.count('begin'), 0);
  assert.deepEqual(patches(db, U, '2026-08-25'), ['18.1']);
  // Vorige Set ohne eigenen Terminplan: alles unsicher, nichts geschrieben
  const prev = await run(t, db, ['--set', String(PREV), '--apply']);
  assert.equal(prev.exitCode, 0);
  assert.equal(db.count('begin'), 0);
  assert.deepEqual(patches(db, U, '2026-09-23', PREV), ['17.9']);
  assert.match(prev.out.warn.join('\n'), /weder Terminplan noch latestPatch/);
});

test('Laufender Sammeltag und spaeter: nie geschrieben; ausdruecklich verlangt → Exit 1', async (t) => {
  const db = seeded();
  const r = await run(t, db, ['--days', '2026-10-05,2026-10-06', '--apply']);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.status.days.map((d) => [d.day, d.status]), [['2026-10-06', 'skipped'], ['2026-10-05', 'skipped']]);
  assert.match(r.status.days[1].message, /laufender Sammeltag/);
  assert.equal(db.count('begin'), 0);
  assert.deepEqual(patches(db, U, '2026-10-05'), ['18.3']);
});

test('Tagesgrenze 05:00 UTC: um 04:59 laeuft der Vortag noch, um 05:00 ist er fertig', async (t) => {
  const mk = () => new FakeDb().insert(M, crawl('2026-10-04', '18.3'));
  const early = mk();
  const r1 = await run(t, early, ['--days', '2026-10-04', '--apply'], { now: new Date('2026-10-05T04:59:59Z') });
  assert.equal(r1.exitCode, 1);
  assert.deepEqual(patches(early, M, '2026-10-04'), ['18.3']);
  const late = mk();
  const r2 = await run(t, late, ['--days', '2026-10-04', '--apply'], { now: new Date('2026-10-05T05:00:00Z') });
  assert.equal(r2.exitCode, 0);
  assert.deepEqual(patches(late, M, '2026-10-04'), ['18.3b']);
});

test('--auto: hoechstens AUTO_CAP Tage je Lauf, die neuesten zuerst, der Rest im naechsten Lauf', async (t) => {
  const days = [];
  for (let d = '2026-09-10'; d <= '2026-10-04'; d = addDays(d, 1)) days.push(d);
  assert.equal(days.length, AUTO_CAP + 4);
  const db = new FakeDb().insert(M, ...days.map((d) => crawl(d, '18.1')));
  const r = await run(t, db, ['--auto', '--apply', '--run-id', 'cap-test']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.status.changedDays.length, AUTO_CAP);
  assert.equal(r.status.changedDays[0], '2026-10-04');
  assert.equal(r.status.changedDays.at(-1), '2026-09-14');
  assert.deepEqual(patches(db, M, '2026-09-14'), ['18.2b']);
  for (const d of days.slice(0, 4)) assert.deepEqual(patches(db, M, d), ['18.1'], d);
  assert.match(r.out.warn.join('\n'), /4 weitere Tage warten auf den naechsten Lauf/);
  assert.ok(!r.out.log.some((l) => l.includes('Danach:')), '--auto druckt keine Handarbeit');
  const r2 = await run(t, db, ['--auto', '--apply']);
  assert.deepEqual(r2.status.changedDays, ['2026-09-13', '2026-09-12', '2026-09-11', '2026-09-10']);
  assert.deepEqual(patches(db, M, '2026-09-10'), ['18.2']);
});

test('--auto sieht nur crawl_meta und die letzten Tage: alte Fehler ausserhalb bleiben', async (t) => {
  const db = new FakeDb().insert(O, outcome('2026-09-12', '18.1', 'c1'), outcome('2026-09-25', '18.1', 'c1'));
  const r = await run(t, db, ['--auto', '--apply']);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.status.changedDays, ['2026-09-25']);
  assert.deepEqual(patches(db, O, '2026-09-12'), ['18.1']);
});

test('--auto ohne sichere Eingaben: verbindet nicht, schreibt nichts, endet mit 0', async (t) => {
  const broken = meta({ patchCuts: [...CUTS, cut('18.9b', '2026-09-30')] });
  const inputs = [
    { meta: broken },
    { meta: null },
    { meta: META, metaError: 'Unexpected end of JSON input' },
    { meta: meta({ setNumber: 0 }) },
  ];
  for (const opts of inputs) {
    const db = seeded();
    const r = await run(t, db, ['--auto', '--apply'], opts);
    assert.equal(r.exitCode, 0);
    assert.equal(r.status.state, 'skipped');
    assert.equal(db.connects, 0);
  }
  // von Hand: unbrauchbare tft-set.json ist ein Fehler
  const db = seeded();
  const r = await run(t, db, ['--apply'], { meta: null });
  assert.equal(r.exitCode, 1);
  assert.equal(r.status.state, 'failed');
  assert.equal(db.connects, 0);
  // von Hand mit kaputtem Terminplan: jeder Tag unsicher, nichts geschrieben
  const db2 = seeded();
  const before = structuredClone(db2.rows);
  const r2 = await run(t, db2, ['--apply'], { meta: broken });
  assert.equal(r2.exitCode, 0);
  assert.deepEqual(db2.rows, before);
  assert.match(r2.out.warn.join('\n'), /Basis 18\.9 fehlt im Terminplan/);
});

test('Not-Aus-Datei: kein Schreiblauf, der Probelauf geht weiter', async (t) => {
  const dir = stateDirFor(t);
  writeFileSync(join(dir, OFF_FILE), '');
  const db = seeded();
  const r = await run(t, db, ['--auto', '--apply'], { stateDir: dir });
  assert.equal(r.exitCode, 0);
  assert.equal(r.status.state, 'off');
  assert.equal(db.connects, 0);
  assert.equal(JSON.parse(readFileSync(join(dir, STATUS_FILE), 'utf8')).state, 'off');
  const dry = await run(t, db, ['--deep'], { stateDir: dir });
  assert.equal(dry.status.state, 'done');
  assert.equal(db.connects, 1);
});

// ── Fehler ──────────────────────────────────────────────────────────────────
test('Fehler mitten im Tag: der ganze Tag rollt zurueck, die anderen Tage laufen weiter', async (t) => {
  const db = seeded();
  db.fail = (kind, table, params) => (kind === 'update' && table === U && params[1] === '2026-09-24' ? pgError('23505') : null);
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.status.state, 'failed');
  const d24 = r.status.days.find((d) => d.day === '2026-09-24');
  assert.equal(d24.status, 'error');
  assert.match(d24.message, /23505/);
  // crawl_meta war am selben Tag schon umbenannt — und rollt mit zurueck
  assert.ok(db.log.some((e) => e.kind === 'update' && e.table === M && e.params[1] === '2026-09-24'));
  assert.deepEqual(patches(db, M, '2026-09-24'), ['18.2b']);
  assert.deepEqual(patches(db, U, '2026-09-24'), ['18.2b']);
  assert.deepEqual(r.status.changedDays, ['2026-09-29', '2026-09-28', '2026-09-23']);
});

test('Ab dem dritten Fehler bricht der Lauf ab, der Rest bleibt liegen', async (t) => {
  const db = seeded();
  const before = structuredClone(db.rows);
  db.fail = (kind) => (kind === 'update' ? pgError('57014', 'canceling statement due to statement timeout') : null);
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.status.days.map((d) => d.status), ['error', 'error', 'error', 'skipped']);
  assert.match(r.status.days[3].message, new RegExp(`abgebrochen nach ${MAX_ERRORS} Fehlern`));
  assert.equal(r.status.errors, MAX_ERRORS);
  assert.deepEqual(db.rows, before);
});

test('Katalog verschweigt den Schluessel mit patch: die Datenbank wehrt sich (23505), der Tag rollt zurueck', async (t) => {
  const lying = new FakeDb().catalog().map((c) => (c.tbl === U ? { ...c, uniques: c.uniques.filter((u) => !u.cols.includes('patch')) } : c));
  const db = new FakeDb(DEFS, { catalogOverride: lying })
    .insert(U, unit('2026-09-23', '18.2b', 'Ahri'), unit('2026-09-23', '18.3', 'Ahri'))
    .insert(M, crawl('2026-09-23', '18.2b'));
  const before = structuredClone(db.rows);
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.match(r.status.days[0].message, /23505/);
  assert.deepEqual(db.rows, before);
});

test('Zeilenzahl weicht vom Plan ab oder es bleibt etwas uebrig: Tag rollt zurueck', async (t) => {
  const db = seeded();
  db.skew = (kind, table, params) => (kind === 'update' && table === O && params[1] === '2026-09-28' ? 5 : undefined);
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.match(r.status.days.find((d) => d.day === '2026-09-28').message, /5 statt 2 Zeilen umbenannt/);
  assert.deepEqual(patches(db, O, '2026-09-28'), ['18.3', '18.3']);

  const db2 = seeded();
  db2.skew = (kind, table, params) => (kind === 'delete' && params[1] === '2026-09-29' ? 0 : undefined);
  const r2 = await run(t, db2, ['--apply']);
  assert.equal(r2.exitCode, 1);
  assert.match(r2.status.days[0].message, /0 statt 1 Zwillinge geloescht/);
  assert.equal(pick(db2, O, '2026-09-29').length, 3);

  const db3 = seeded();
  db3.answer = (kind, table, params) => (kind === 'remaining' && table === M && params[1] === '2026-09-23' ? { rows: [{ n: 1 }] } : undefined);
  const r3 = await run(t, db3, ['--apply']);
  assert.equal(r3.exitCode, 1);
  assert.match(r3.status.days.find((d) => d.day === '2026-09-23').message, /noch 1 falsche Zeilen/);
  assert.deepEqual(patches(db3, M, '2026-09-23'), ['18.2b']);
});

test('Nicht eindeutig (zwei falsche Zeilen, kein richtiger Zwilling): Fehler, nichts geschrieben', async (t) => {
  const db = new FakeDb().insert(O,
    outcome('2026-09-30', '18.3', 'c3'), outcome('2026-09-30', '18.2b', 'c3'), outcome('2026-09-30', '18.3', 'c4'));
  const before = structuredClone(db.rows);
  for (const write of ['--apply', '--dry-run']) {
    const r = await run(t, db, ['--days', '2026-09-30', write]);
    assert.equal(r.exitCode, 1, write);
    assert.match(r.status.days[0].message, /nicht eindeutig: 1 Schluessel/, write);
    assert.deepEqual(db.rows, before, write);
  }
});

test('Lock belegt: Lauf bricht sofort ab, nichts geschrieben', async (t) => {
  const db = seeded();
  db.lockBusy = true;
  const before = structuredClone(db.rows);
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.status.days.map((d) => d.status), ['error', 'skipped', 'skipped', 'skipped']);
  assert.match(r.status.days[0].message, /LOCK_BUSY/);
  assert.match(r.status.days[1].message, /ein anderer Lauf korrigiert gerade/);
  assert.equal(db.count('begin'), 1);
  assert.deepEqual(db.rows, before);
});

test('Unsicherer Schluessel im Katalog: Abbruch vor dem ersten Lesen der Tage', async (t) => {
  const odd = { tbl: 'tft_daily_odd_stats', uniques: [{ name: 'odd_idx', partial: true, expr: false, nnd: false, cols: ['region', 'patch', 'set_number', 'day'] }] };
  const db = seeded(new FakeDb(DEFS, { catalogExtra: [odd] }));
  const r = await run(t, db, ['--apply']);
  assert.equal(r.exitCode, 1);
  assert.equal(r.status.state, 'failed');
  assert.match(r.status.problems[0], /tft_daily_odd_stats: eindeutiger Index odd_idx ist partiell/);
  assert.equal(db.count('scan'), 0);
  assert.equal(db.count('begin'), 0);
});

test('B-Patch-Name ginge verloren (Schnitt fehlt in tft-set.json): --auto laesst liegen, von Hand mit --days geht es', async (t) => {
  const noCut = meta({ patchCuts: CUTS.slice(0, 2) });
  const mk = () => new FakeDb().insert(O, outcome('2026-09-28', '18.3b', 'c1'));
  const db = mk();
  const r = await run(t, db, ['--auto', '--apply'], { meta: noCut });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.status.days.map((d) => [d.day, d.expected, d.status]), [['2026-09-28', '18.3', 'skipped']]);
  assert.match(r.out.warn.join('\n'), /B-Patch-Name ginge verloren/);
  assert.deepEqual(patches(db, O, '2026-09-28'), ['18.3b']);
  assert.equal(db.count('rollback'), 1);
  const dry = await run(t, mk(), ['--auto'], { meta: noCut });
  assert.match(dry.status.days[0].message, /--auto liesse den Tag liegen/);
  const db2 = mk();
  const r2 = await run(t, db2, ['--days', '2026-09-28', '--apply'], { meta: noCut });
  assert.equal(r2.exitCode, 0);
  assert.equal(r2.status.days[0].status, 'changed');
  assert.equal(r2.status.days[0].message, 'B-Patch-Name entfaellt');
  assert.deepEqual(patches(db2, O, '2026-09-28'), ['18.3']);
});

// ── Statusdatei und Verbindung ──────────────────────────────────────────────
test('Statusdatei: gueltiges JSON mit Kennung, keine Reste; unbeschreibbarer Ordner ist nur eine Warnung', async (t) => {
  const r = await run(t, seeded(), ['--auto', '--apply', '--run-id', 'crawl-2026-10-05.end']);
  const file = JSON.parse(readFileSync(join(r.dir, STATUS_FILE), 'utf8'));
  assert.equal(file.schema, STATUS_SCHEMA);
  assert.equal(file.runId, 'crawl-2026-10-05.end');
  assert.equal(file.state, 'done');
  assert.ok(file.finishedAt);
  assert.deepEqual(file.changedDays, ['2026-09-29', '2026-09-28', '2026-09-24', '2026-09-23']);
  assert.deepEqual(readdirSync(r.dir).filter((f) => f.endsWith('.tmp')), []);

  const asFile = join(stateDirFor(t), 'kein-ordner');
  writeFileSync(asFile, 'x');
  const r2 = await run(t, seeded(), ['--deep'], { stateDir: asFile });
  assert.equal(r2.exitCode, 0);
  assert.match(r2.out.warn.join('\n'), /Statusdatei .* nicht geschrieben/);
  assert.match(writeStatus(asFile, {}), /nicht geschrieben/);
});

// ── --expect und Markerdatei ────────────────────────────────────────────────
test('--expect passt nicht: --auto tut nichts (Exit 0), von Hand Fehler (Exit 1), keine Verbindung', async (t) => {
  const db = seeded();
  const before = structuredClone(db.rows);
  const r = await run(t, db, ['--auto', '--apply', '--expect', '2026-10-04=18.4']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.status.state, 'skipped');
  assert.match(r.out.warn.join('\n'), /erwartet 2026-10-04 = 18\.4, der Terminplan sagt 18\.3b/);
  const r2 = await run(t, db, ['--apply', '--expect', '2026-10-04=18.4']);
  assert.equal(r2.exitCode, 1);
  assert.equal(r2.status.state, 'failed');
  assert.equal(db.connects, 0);
  assert.deepEqual(db.rows, before);
  assert.equal(existsSync(join(r.dir, CHANGED_MARKER_FILE)), false);
});

test('--expect passt: Lauf wie ohne, Markerdatei traegt alte und neue Namen', async (t) => {
  const db = seeded();
  const r = await run(t, db, ['--auto', '--apply', '--expect', '2026-10-04=18.3b']);
  assert.equal(r.exitCode, 0);
  assert.equal(r.status.state, 'done');
  assert.deepEqual(r.status.changedDays, ['2026-09-29', '2026-09-28', '2026-09-24', '2026-09-23']);
  const marker = readChangedMarker(r.dir);
  assert.equal(marker.schema, STATUS_SCHEMA);
  assert.deepEqual(Object.keys(marker.patches).sort(), ['18.2b', '18.3', '18.3b']);
  for (const iso of Object.values(marker.patches)) assert.ok(Number.isFinite(Date.parse(iso)));
  assert.deepEqual(readdirSync(r.dir).filter((f) => f.endsWith('.tmp')), []);
});

test('Markerdatei: Probelauf und Probe (--trial) schreiben keine', async (t) => {
  const dry = await run(t, seeded(), ['--auto']);
  assert.equal(existsSync(join(dry.dir, CHANGED_MARKER_FILE)), false);
  const trial = await run(t, seeded(), ['--deep', '--trial']);
  assert.ok(trial.status.days.some((d) => d.status === 'trial'));
  assert.equal(existsSync(join(trial.dir, CHANGED_MARKER_FILE)), false);
});

test('recordChangedPatches: fuehrt zusammen, wirft Alte raus, ersetzt kaputte Datei laut', (t) => {
  const dir = stateDirFor(t);
  assert.equal(readChangedMarker(dir), null);
  assert.equal(recordChangedPatches(dir, ['18.2'], new Date('2026-09-01T00:00:00Z')), null);
  assert.equal(recordChangedPatches(dir, ['18.3', '18.2b', null], new Date('2026-09-20T00:00:00Z')), null);
  assert.equal(recordChangedPatches(dir, ['18.3b'], new Date('2026-09-25T00:00:00Z')), null);
  // 18.2 ist am 25.09. aelter als 14 Tage und faellt weg.
  assert.deepEqual(readChangedMarker(dir).patches, {
    '18.3': '2026-09-20T00:00:00.000Z', '18.2b': '2026-09-20T00:00:00.000Z', '18.3b': '2026-09-25T00:00:00.000Z',
  });

  writeFileSync(join(dir, CHANGED_MARKER_FILE), '{kaputt');
  assert.throws(() => readChangedMarker(dir));
  assert.match(recordChangedPatches(dir, ['18.4'], new Date('2026-10-08T00:00:00Z')), /Markerdatei ersetzt/);
  assert.deepEqual(readChangedMarker(dir).patches, { '18.4': '2026-10-08T00:00:00.000Z' });

  writeFileSync(join(dir, CHANGED_MARKER_FILE), JSON.stringify({ schema: 99, patches: {} }));
  assert.throws(() => readChangedMarker(dir), /unbekanntes Format/);
});

test('Keine Verbindung: Fehler, Exit 1', async (t) => {
  const db = seeded();
  const r = await run(t, db, ['--apply'], { connect: async () => { throw new Error('getaddrinfo ENOTFOUND'); } });
  assert.equal(r.exitCode, 1);
  assert.equal(r.status.state, 'failed');
  assert.match(r.status.problems[0], /keine Verbindung zur Datenbank: getaddrinfo ENOTFOUND/);
});

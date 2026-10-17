import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  JOIN_GRACE_MS, LIVE_MIN_LEFT_MS, LIVE_TOTAL_MS, LONG_MIN_LEFT_MS, LONG_QUERY_TIMEOUT_MS, MAX_TOTAL_MS,
  REFRESH_API_TIMEOUT_MS, gSql, itemMaskCol, joinWaitMs, liveBudget, maskPlan, slotTimeout, unitMaskSql, unitViaMask, itemViaMask,
} from './explorer-mask-query.mjs';
import { QUERY_TIMEOUT_MS } from './explorer-query.mjs';

const unit = (o = {}) => ({ id: 'DA_Amumu18', x: false, s: null, sx: null, n: null, nx: null, c: null, it: [], nit: [], k: [], ...o });
const query = (o = {}) => ({
  region: 'all', ranks: [], patches: [], levels: [], place: null, units: [unit()], items: [], traits: [], groups: [],
  tab: 'units', focus: null, split: null, combo: 1, ...o,
});
const mask = {
  dayPatches: [{ day: '2026-10-01', patch: '18.1' }, { day: '2026-10-08', patch: '18.2' }],
  covered: new Set(['2026-10-01', '2026-10-08']),
  compHashByDay: new Map([['2026-10-01', 'h'], ['2026-10-08', 'h']]),
};
const holder = { mask, compHash: 'h' };
const SHORT = { timeoutMs: 32_000, computeMaxMs: QUERY_TIMEOUT_MS, minLeftMs: LIVE_MIN_LEFT_MS, long: false };

test('liveBudget: lange Frist nur fuer alle Patches + Filter auf dem Masken-Weg', () => {
  assert.deepEqual(liveBudget(holder, query(), 30_000, 32_000), { timeoutMs: 30_000, computeMaxMs: 30_000, minLeftMs: LONG_MIN_LEFT_MS, long: true });
  assert.deepEqual(liveBudget(holder, query({ units: [], ranks: ['DIAMOND'] }), 30_000).long, true, 'Rang allein reicht');
  assert.deepEqual(liveBudget(holder, query({ patches: ['18.2'] }), 30_000), SHORT, 'ein Patch');
  assert.deepEqual(liveBudget(holder, query({ units: [] }), 30_000), SHORT, 'ohne Filter und Rang');
  assert.deepEqual(liveBudget({ ...holder, mask: null }, query(), 30_000), SHORT, 'ohne Masken');
  const gap = { ...mask, covered: new Set(['2026-10-08']) };
  assert.deepEqual(liveBudget({ ...holder, mask: gap }, query(), 30_000), SHORT, 'Tag ohne Masken');
});

test('liveBudget: lange Frist aus bei 0 und bei Werten bis 15 s', () => {
  assert.deepEqual(liveBudget(holder, query(), 0, 32_000), SHORT);
  assert.deepEqual(liveBudget(holder, query(), QUERY_TIMEOUT_MS, 32_000), SHORT);
  assert.equal(liveBudget(holder, query(), QUERY_TIMEOUT_MS + 1, 32_000).long, true);
});

test('liveBudget: kurze Gesamtfrist, Schalter <= 15 s = altes Verhalten', () => {
  const old = { timeoutMs: QUERY_TIMEOUT_MS, computeMaxMs: QUERY_TIMEOUT_MS, minLeftMs: LIVE_MIN_LEFT_MS, long: false };
  assert.deepEqual(liveBudget(holder, query({ patches: ['18.2'] }), 30_000, 0), old);
  assert.deepEqual(liveBudget(holder, query({ patches: ['18.2'] }), 30_000, 10_000), old);
  assert.deepEqual(liveBudget(holder, query({ patches: ['18.2'] }), 30_000, 32_000), SHORT);
});

test('slotTimeout: Rechnung hoechstens 15 s, Rest bis zur Frist, zu wenig Rest = null', () => {
  const t0 = 1_000_000;
  const short = liveBudget(holder, query({ patches: ['18.2'] }), 30_000, 32_000);
  const dl = t0 + short.timeoutMs;
  assert.equal(slotTimeout(short, dl, t0), 15_000, 'sofort dran');
  assert.equal(slotTimeout(short, dl, t0 + 17_000), 15_000, 'nach 17 s Warten noch volle 15 s');
  assert.equal(slotTimeout(short, dl, t0 + 20_000), 12_000, 'nach 20 s Warten Rest 12 s');
  assert.equal(slotTimeout(short, dl, t0 + 30_000), 2_000, 'Mindest-Rest genau erreicht');
  assert.equal(slotTimeout(short, dl, t0 + 30_500), null, 'unter Mindest-Rest');
  const long = liveBudget(holder, query(), 30_000, 32_000);
  const dlL = t0 + long.timeoutMs;
  assert.equal(slotTimeout(long, dlL, t0), 30_000, 'lang unveraendert');
  assert.equal(slotTimeout(long, dlL, t0 + 15_000), 15_000);
  assert.equal(slotTimeout(long, dlL, t0 + 15_001), null);
});

test('joinWaitMs: Frist + 1 s, ohne Frist Rueckfall, nie negativ', () => {
  assert.equal(joinWaitMs(50_000, 20_000), 31_000);
  assert.equal(joinWaitMs(50_000, 60_000), 0);
  assert.equal(joinWaitMs(null, 20_000, 18_000), 18_000);
});

test('Fristen-Kette: Frist + Mitwarten bleibt unter refresh-api, Env wird gekappt', () => {
  assert.ok(LIVE_TOTAL_MS + JOIN_GRACE_MS < REFRESH_API_TIMEOUT_MS);
  assert.ok(LONG_QUERY_TIMEOUT_MS + JOIN_GRACE_MS < REFRESH_API_TIMEOUT_MS);
  assert.ok(MAX_TOTAL_MS + JOIN_GRACE_MS < REFRESH_API_TIMEOUT_MS);
  // refresh-api traegt die Zahl selbst (eigener Dienst) — Gleichlauf pruefen
  const api = fs.readFileSync(new URL('../refresh-api-server.mjs', import.meta.url), 'utf8');
  const m = /const EXPLORER_TIMEOUT_MS = ([0-9_]+);/.exec(api);
  assert.ok(m, 'EXPLORER_TIMEOUT_MS in refresh-api-server.mjs');
  assert.equal(Number(m[1].replace(/_/g, '')), REFRESH_API_TIMEOUT_MS);
});

test('unitViaMask: nur „Stern ab", ohne Obergrenze, Itemzahl, Items, Sorte, Kopien; Schalter wirkt', () => {
  assert.equal(unitViaMask(unit(), true), true);
  assert.equal(unitViaMask(unit({ s: 2, x: true }), true), true);
  assert.equal(unitViaMask(unit({ s: 2, sx: 2 }), true), false);
  assert.equal(unitViaMask(unit({ sx: 2 }), true), false);
  assert.equal(unitViaMask(unit({ n: 0 }), true), false);
  assert.equal(unitViaMask(unit({ nx: 1 }), true), false);
  assert.equal(unitViaMask(unit({ c: 2 }), true), false);
  assert.equal(unitViaMask(unit({ it: ['DA_X'] }), true), false);
  assert.equal(unitViaMask(unit({ nit: ['DA_X'] }), true), false);
  assert.equal(unitViaMask(unit({ k: [{ b: 'emblem', n: 1 }] }), true), false);
  assert.equal(unitViaMask(unit(), false), false);
  assert.equal(itemViaMask({ id: 'DA_X', x: false, n: null }), true);
});

test('itemViaMask: Anzahl 2/3 ueber m2/m3, nicht bei vorigem Rechenweg oder Schalter aus', () => {
  const it = (n) => ({ id: 'DA_X', x: false, n });
  assert.equal(itemViaMask(it(null), false, false), true);
  assert.equal(itemViaMask(it(2), true, true), true);
  assert.equal(itemViaMask(it(3), true, true), true);
  assert.equal(itemViaMask(it(4), true, true), false);
  assert.equal(itemViaMask(it(2), false, true), false);
  assert.equal(itemViaMask(it(2), true, false), false);
  assert.equal(itemMaskCol(it(null)), 'm');
  assert.equal(itemMaskCol(it(3)), 'm3');
});

const DAYS = ['2026-10-01', '2026-10-08'];
const marks = (sql) => (sql.match(/\?/g) ?? []).length;
const item = (o = {}) => ({ id: 'DA_X', x: false, n: null, ...o });
const trait = (o = {}) => ({ id: 'DA_T', x: false, l: null, le: false, ...o });
const group = (o = {}) => ({ m: 'any', units: [], items: [], traits: [], ...o });

test('gSql: Parameter passen in Zahl und Reihenfolge zum SQL-Text', () => {
  const q = query({
    ranks: ['DIAMOND'], levels: [8, 9], place: [1, 4],
    units: [unit(), unit({ id: 'DA_B', c: 2 })], items: [item({ n: 2 }), item({ id: 'DA_Y', x: true })], traits: [trait()],
    groups: [
      group({ units: [unit({ id: 'DA_C', s: 2 }), unit({ id: 'DA_D', it: ['DA_Z'] })], items: [item({ n: 3 })], traits: [trait({ l: 2 })] }),
      group({ m: 'none', items: [item({ id: 'DA_W' })], traits: [trait({ id: 'DA_U' })] }),
    ],
  });
  for (const opts of [{}, { counts: false }, { itemnOn: false }, { unitsOn: false }]) {
    const { sql, params } = gSql(q, DAYS, opts);
    assert.equal(marks(sql), params.length, JSON.stringify(opts));
  }
  const { sql, params } = gSql(q, DAYS);
  // Masken-Joins in Text-Reihenfolge: Items oben, Units oben, dann Kasten 1 (Unit C, Item X n3), Kasten 2 (Item W).
  assert.deepEqual(params.slice(-6), ['DA_X', 'DA_Y', 'DA_Amumu18', 'DA_C', 'DA_X', 'DA_W']);
  assert.match(sql, /SELECT mid, m2 AS m FROM mask_uk/);
  assert.match(sql, /SELECT mid, m3 AS m FROM mask_uk/);
  assert.match(sql, /~coalesce\(j1\.m, 0::UTINYINT\)/);
  // Kasten 1: Unit C ueber Maske, Unit D (mit Item) und Trait je Board; Kasten 2 = keins davon.
  assert.match(sql, /& \(coalesce\(j3\.m, 0::UTINYINT\) \| g0\.c0 \| coalesce\(j4\.m, 0::UTINYINT\) \| g0\.c1\)/);
  assert.match(sql, /& ~\(coalesce\(j5\.m, 0::UTINYINT\) \| g0\.c2\)/);
  assert.doesNotMatch(sql.split('g0 AS')[0], /OR b\.bid IN/);
});

test('gSql: vorige Masken / Schalter aus → Item-Anzahl und Kaesten wie bisher in hit', () => {
  const q = query({ units: [], items: [item({ n: 2 })], groups: [group({ items: [item({ id: 'DA_Y' })] })] });
  const old = gSql(q, DAYS, { counts: false });
  assert.doesNotMatch(old.sql, /m2 AS m/);
  assert.match(old.sql, /b\.bid IN \(SELECT bid FROM units WHERE \(i1 = \? OR i2 = \? OR i3 = \?\) GROUP BY bid/);
  assert.match(old.sql, /SELECT mid, m AS m FROM mask_uk/);
  const off = gSql(q, DAYS, { itemnOn: false });
  assert.doesNotMatch(off.sql, /mask_uk/);
  assert.match(off.sql, /\(b\.bid IN \(SELECT bid FROM units WHERE \(i1 = \? OR i2 = \? OR i3 = \?\)\)\)/);
  assert.equal(marks(off.sql), off.params.length);
});

test('maskPlan: traegt den Rechenweg (counts) der Masken weiter', () => {
  const q = query({ items: [item({ n: 2 })] });
  assert.equal(maskPlan(mask, q, 'h').counts, true);
  assert.equal(maskPlan({ ...mask, counts: false }, q, 'h').counts, false);
});

test('maskPlan: Level, Platz und Kaesten allein nehmen den Masken-Weg, ohne alles nicht', () => {
  const plain = query({ units: [] });
  assert.equal(maskPlan(mask, plain, 'h'), null);
  assert.ok(maskPlan(mask, query({ units: [], levels: [8] }), 'h'));
  assert.ok(maskPlan(mask, query({ units: [], place: [1, 4] }), 'h'));
  assert.ok(maskPlan(mask, query({ units: [], groups: [{ m: 'any', units: [unit()], items: [], traits: [] }] }), 'h'));
});

test('unitMaskSql: Stern ab s = OR der Spalten s..4', () => {
  assert.equal(unitMaskSql(unit()), '(m1 | m2 | m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 1 })), '(m1 | m2 | m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 3 })), '(m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 4 })), '(m4)');
});

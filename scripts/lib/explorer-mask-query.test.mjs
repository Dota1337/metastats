import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  JOIN_GRACE_MS, LIVE_MIN_LEFT_MS, LIVE_TOTAL_MS, LONG_MIN_LEFT_MS, LONG_QUERY_TIMEOUT_MS, MAX_TOTAL_MS,
  REFRESH_API_TIMEOUT_MS, joinWaitMs, liveBudget, slotTimeout, unitMaskSql, unitViaMask,
} from './explorer-mask-query.mjs';
import { QUERY_TIMEOUT_MS } from './explorer-query.mjs';

const unit = (o = {}) => ({ id: 'DA_Amumu18', x: false, s: null, se: false, n: null, it: [], nit: [], ...o });
const query = (o = {}) => ({
  region: 'all', ranks: [], patches: [], units: [unit()], items: [], traits: [],
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

test('unitViaMask: nur ohne Item-Zusatz und ohne exakten Stern, Schalter wirkt', () => {
  assert.equal(unitViaMask(unit(), true), true);
  assert.equal(unitViaMask(unit({ s: 2, x: true }), true), true);
  assert.equal(unitViaMask(unit({ s: 2, se: true }), true), false);
  assert.equal(unitViaMask(unit({ n: 0 }), true), false);
  assert.equal(unitViaMask(unit({ it: ['DA_X'] }), true), false);
  assert.equal(unitViaMask(unit({ nit: ['DA_X'] }), true), false);
  assert.equal(unitViaMask(unit(), false), false);
});

test('unitMaskSql: Stern ab s = OR der Spalten s..4', () => {
  assert.equal(unitMaskSql(unit()), '(m1 | m2 | m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 1 })), '(m1 | m2 | m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 3 })), '(m3 | m4)');
  assert.equal(unitMaskSql(unit({ s: 4 })), '(m4)');
});

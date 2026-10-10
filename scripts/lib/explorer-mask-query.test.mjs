import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIVE_MIN_LEFT_MS, LONG_MIN_LEFT_MS, liveBudget, unitMaskSql, unitViaMask,
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
const SHORT = { timeoutMs: QUERY_TIMEOUT_MS, minLeftMs: LIVE_MIN_LEFT_MS, long: false };

test('liveBudget: lange Frist nur fuer alle Patches + Filter auf dem Masken-Weg', () => {
  assert.deepEqual(liveBudget(holder, query(), 30_000), { timeoutMs: 30_000, minLeftMs: LONG_MIN_LEFT_MS, long: true });
  assert.deepEqual(liveBudget(holder, query({ units: [], ranks: ['DIAMOND'] }), 30_000).long, true, 'Rang allein reicht');
  assert.deepEqual(liveBudget(holder, query({ patches: ['18.2'] }), 30_000), SHORT, 'ein Patch');
  assert.deepEqual(liveBudget(holder, query({ units: [] }), 30_000), SHORT, 'ohne Filter und Rang');
  assert.deepEqual(liveBudget({ ...holder, mask: null }, query(), 30_000), SHORT, 'ohne Masken');
  const gap = { ...mask, covered: new Set(['2026-10-08']) };
  assert.deepEqual(liveBudget({ ...holder, mask: gap }, query(), 30_000), SHORT, 'Tag ohne Masken');
});

test('liveBudget: aus bei 0 und bei Werten bis 15 s', () => {
  assert.deepEqual(liveBudget(holder, query(), 0), SHORT);
  assert.deepEqual(liveBudget(holder, query(), QUERY_TIMEOUT_MS), SHORT);
  assert.equal(liveBudget(holder, query(), QUERY_TIMEOUT_MS + 1).long, true);
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

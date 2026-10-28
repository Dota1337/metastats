// Tests fuer minSum/minDistinct der Vertraege (scripts/lib/contracts.mjs,
// 2026-10-29). Nur Auswertung und Ablehnung — DB und Netz werden nicht
// angefasst: ein abgelehntes Feld muss VOR jedem Abruf zurueckkommen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkContract, dayAggregateParts, dayAggregatesSupported, evaluateDayAggregates,
} from './contracts.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = { id: 'x', backend: 'supabase', table: 't', dateColumn: 'day', maxLagDays: 1, minRows: 1 };

test('dayAggregateParts: ohne Felder null', () => {
  assert.equal(dayAggregateParts({}), null);
});

test('dayAggregateParts: Summe und Distinct', () => {
  assert.deepEqual(
    dayAggregateParts({ minSum: { column: 'games', min: 1500000 }, minDistinct: { column: 'region', min: 15 } }),
    { sum: { column: 'games', min: 1500000 }, distinct: { column: 'region', min: 15 } },
  );
  assert.deepEqual(dayAggregateParts({ minSum: { column: 'games', min: 5 } }), { sum: { column: 'games', min: 5 }, distinct: null });
});

test('dayAggregateParts: Spaltenname nur Kleinbuchstaben und Unterstrich, min >= 1', () => {
  for (const column of ['games); drop table x', 'Games', 'sum(games)', '', 42, undefined]) {
    assert.throws(() => dayAggregateParts({ minSum: { column, min: 1 } }), /minSum\.column/);
  }
  for (const min of [0, -1, '5', null, NaN, Infinity]) {
    assert.throws(() => dayAggregateParts({ minDistinct: { column: 'region', min } }), /minDistinct\.min/);
  }
});

test('dayAggregatesSupported: nur Standard-Frischecheck mit Datum auf Supabase', () => {
  assert.equal(dayAggregatesSupported(BASE), true);
  assert.equal(dayAggregatesSupported({ ...BASE, backend: 'hetzner' }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, type: 'coverage' }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, dateType: 'timestamp' }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, windowDays: 7 }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, noGapsInDays: 14 }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, totalRowsMin: 10 }), false);
  assert.equal(dayAggregatesSupported({ ...BASE, dateColumn: undefined }), false);
});

test('evaluateDayAggregates: ueber, auf und unter der Grenze', () => {
  const parts = { sum: { column: 'games', min: 1500000 }, distinct: { column: 'region', min: 15 } };
  assert.equal(evaluateDayAggregates(parts, { sum: '2567562', distinct: 15 }).ok, true);
  assert.equal(evaluateDayAggregates(parts, { sum: '1500000', distinct: 15 }).ok, true);
  const lowSum = evaluateDayAggregates(parts, { sum: '1499999', distinct: 15 });
  assert.equal(lowSum.ok, false);
  assert.match(lowSum.detail, /sum\(games\) 1499999/);
  const lowRegion = evaluateDayAggregates(parts, { sum: '2567562', distinct: 14 });
  assert.equal(lowRegion.ok, false);
  assert.match(lowRegion.detail, /14 verschiedene region/);
  assert.equal(evaluateDayAggregates(parts, { sum: null, distinct: null }).ok, false);
});

test('checkContract: Feld in nicht unterstuetztem Modus → error, ohne Abruf', async () => {
  for (const extra of [{ type: 'mirror' }, { backend: 'hetzner' }, { dateType: 'timestamp' }, { windowDays: 7 }]) {
    const res = await checkContract({ ...BASE, ...extra, minSum: { column: 'games', min: 1 } });
    assert.equal(res.status, 'error', JSON.stringify(extra));
    assert.match(res.detail, /minSum\/minDistinct/);
  }
});

test('checkContract: ungueltiges Feld → error, ohne Abruf', async () => {
  const res = await checkContract({ ...BASE, minSum: { column: 'games or 1=1', min: 1 } });
  assert.equal(res.status, 'error');
  assert.match(res.detail, /minSum\.column/);
});

test('contracts.json: Comp-Duelle pruefen Vergleiche und Regionen, und jedes Feld steht in einem auswertenden Modus', () => {
  const { contracts } = JSON.parse(readFileSync(resolve(ROOT, 'infra', 'contracts.json'), 'utf8'));
  const byId = new Map(contracts.map(c => [c.id, c]));
  const m = byId.get('daily-crawl/comp-matchups');
  assert.deepEqual(m.minSum, { column: 'games', min: 1500000 });
  assert.deepEqual(m.minDistinct, { column: 'region', min: 15 });
  assert.deepEqual(byId.get('daily-crawl/comp-matchups-all').minSum, { column: 'games', min: 1500000 });
  for (const c of contracts) {
    for (const k of Object.keys(c)) assert.ok(!/^min(sum|distinct)$/i.test(k) || k === 'minSum' || k === 'minDistinct', `${c.id}: Tippfehler ${k}`);
    if (dayAggregateParts(c)) assert.equal(dayAggregatesSupported(c), true, c.id);
  }
});

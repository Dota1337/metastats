import test from 'node:test';
import assert from 'node:assert/strict';
import { weeklyReferenceByPlayer } from './marketvalue-history.ts';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-10-01T12:00:00Z');
const row = (pid, value, daysAgo, split = 's3', est = false) => ({
  player_id: pid, market_value: value, recorded_at: new Date(now - daysAgo * DAY).toISOString(),
  split_id: split, split_estimated: est,
});

test('Vergleichswert vor der Woche schlaegt aeltesten Wert in der Woche', () => {
  const m = weeklyReferenceByPlayer([row('a', 100, 12), row('a', 120, 8), row('a', 130, 5), row('a', 150, 1)], now);
  assert.equal(m.get('a'), 120);
});

test('nur Zeilen in der Woche: aeltester Wert der Woche', () => {
  const m = weeklyReferenceByPlayer([row('a', 130, 5), row('a', 150, 1)], now);
  assert.equal(m.get('a'), 130);
});

test('eine einzige Zeile ergibt keinen Vergleich', () => {
  assert.equal(weeklyReferenceByPlayer([row('a', 150, 1)], now).has('a'), false);
});

test('neueste Zeile vor der Woche: keine Wochenveraenderung', () => {
  assert.equal(weeklyReferenceByPlayer([row('a', 100, 15), row('a', 150, 9)], now).has('a'), false);
});

test('Split-Wechsel und geschaetzte Gruppen zaehlen nicht', () => {
  const m = weeklyReferenceByPlayer([
    row('a', 100, 10, 's2'), row('a', 150, 1, 's3'),
    row('b', 100, 10, 's3', true), row('b', 150, 1, 's3', true),
    row('c', 100, 10, 's3', true), row('c', 150, 1, 's3'),
  ], now);
  assert.deepEqual([...m.keys()], []);
});

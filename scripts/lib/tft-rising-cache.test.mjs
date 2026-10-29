// Tests fuer den Vorrat „alle Regionen" der Aufsteiger-Seite (tft_rising_cache, 0106):
// wann die gespeicherte Liste ausgeliefert wird und wann der Endpunkt live rechnet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { risingCacheUsable, RISING_CACHE_MAX_AGE_MS } from './tft-rising.mjs';

const NOW = Date.parse('2026-10-29T06:00:00Z');
const row = (o = {}) => ({
  set_number: 18,
  payload: { hasData: true, players: [{ puuid: 'p' }] },
  built_at: new Date(NOW - 3600_000).toISOString(),
  ...o,
});

test('frische Zeile im laufenden Set wird ausgeliefert', () => {
  assert.equal(risingCacheUsable(row(), { setNumber: 18, now: NOW }), true);
});

test('keine Zeile → live', () => {
  assert.equal(risingCacheUsable(undefined, { setNumber: 18, now: NOW }), false);
});

test('anderes Set → live', () => {
  assert.equal(risingCacheUsable(row({ set_number: 17 }), { setNumber: 18, now: NOW }), false);
});

test('Grenze 36 h: genau drauf noch gueltig, eine Minute drueber live', () => {
  assert.equal(RISING_CACHE_MAX_AGE_MS, 36 * 3600_000);
  assert.equal(risingCacheUsable(row({ built_at: new Date(NOW - RISING_CACHE_MAX_AGE_MS) }), { setNumber: 18, now: NOW }), true);
  assert.equal(risingCacheUsable(row({ built_at: new Date(NOW - RISING_CACHE_MAX_AGE_MS - 60_000) }), { setNumber: 18, now: NOW }), false);
});

test('leere oder kaputte Zeile → live', () => {
  assert.equal(risingCacheUsable(row({ payload: { hasData: false, players: [] } }), { setNumber: 18, now: NOW }), false);
  assert.equal(risingCacheUsable(row({ payload: null }), { setNumber: 18, now: NOW }), false);
  assert.equal(risingCacheUsable(row({ built_at: 'kaputt' }), { setNumber: 18, now: NOW }), false);
});

test('Zeitstempel weit in der Zukunft (falsche Uhr) → live', () => {
  assert.equal(risingCacheUsable(row({ built_at: new Date(NOW + 3600_000) }), { setNumber: 18, now: NOW }), false);
});

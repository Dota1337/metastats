/**
 * Filter in der Adresse (tft-filters.ts): ein automatisch gewaehlter Rang muss
 * den Weg ueber die Adresse ueberstehen. Die Listen schreiben ihn per
 * replaceState als `bucket=X&bucketAuto=1`; Neuladen und Zurueck-Knopf lesen
 * ihn von dort. Wird er dabei zum festen Rang, bleibt der Besucher dauerhaft
 * darauf — auch zum Set-Start, wenn der Server laengst einen anderen nimmt.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { filtersFromSearchParams, filtersToQueryString, filtersDataKey, resolveMountFilters, FILTERS_STORAGE_KEY } from './tft-filters.ts';

const AUTO = { patch: 'current', bucket: 'diamond_plus', bucketAuto: true, days: 3, region: 'all', velocity: 0 };

test('Rundlauf: automatischer Rang bleibt automatisch, der frische Server-Rang gewinnt', () => {
  const sp = new URLSearchParams(filtersToQueryString(AUTO));
  assert.equal(sp.get('bucketAuto'), '1');
  const back = filtersFromSearchParams(sp, 'all');
  assert.equal(back.bucketAuto, true);
  assert.equal(back.bucket, 'all');
  // Ohne Server-Rang: der zuletzt bestimmte aus der Adresse.
  assert.equal(filtersFromSearchParams(sp).bucket, 'diamond_plus');
});

test('Rundlauf: ausdruecklich gewaehlter Rang bleibt gewaehlt', () => {
  const chosen = { ...AUTO, bucket: 'master_plus', bucketAuto: false };
  const back = filtersFromSearchParams(new URLSearchParams(filtersToQueryString(chosen)), 'all');
  assert.equal(back.bucketAuto, false);
  assert.equal(back.bucket, 'master_plus');
  assert.equal(filtersDataKey(back), filtersDataKey(chosen));
});

test('ohne Rang in der Adresse: automatisch, Server-Rang', () => {
  const f = filtersFromSearchParams(new URLSearchParams('region=euw1'), 'all');
  assert.equal(f.bucketAuto, true);
  assert.equal(f.bucket, 'all');
  assert.equal(f.region, 'euw1');
});

test('Standardwerte ohne Adresse', () => {
  const f = filtersFromSearchParams(new URLSearchParams(''), 'diamond_plus');
  assert.deepEqual(f, AUTO);
});

// Mount einer Liste mit Startdaten (useTftStatsList, useTftCompsData): welche
// Filter gelten wirklich, und muss neu geladen werden?
function withStorage(stored, fn) {
  const items = new Map(stored ? [[FILTERS_STORAGE_KEY, JSON.stringify(stored)]] : []);
  globalThis.window = { localStorage: { getItem: k => items.get(k) ?? null, setItem: (k, v) => items.set(k, v) } };
  try { return fn(); } finally { delete globalThis.window; }
}

test('Mount: Adresse = Server-Ansicht → nichts aendern, kein Abruf', () => {
  const sp = new URLSearchParams(filtersToQueryString(AUTO));
  assert.deepEqual(withStorage(null, () => resolveMountFilters(AUTO, sp)), { filters: AUTO, change: null });
});

test('Mount: gespeicherte Filter mit anderen Zahlen → laden', () => {
  const stored = { ...AUTO, bucket: 'master_plus', bucketAuto: false, region: 'euw1' };
  const r = withStorage(stored, () => resolveMountFilters(AUTO, new URLSearchParams('')));
  assert.equal(r.change, 'data');
  assert.equal(r.filters.region, 'euw1');
  assert.equal(r.filters.bucket, 'master_plus');
});

test('Mount: Adresse geht vor Speicher (Zurueck-Knopf nach replaceState)', () => {
  const stored = { ...AUTO, region: 'kr' };
  const r = withStorage(stored, () => resolveMountFilters(AUTO, new URLSearchParams('region=euw1&days=3')));
  assert.equal(r.change, 'data');
  assert.equal(r.filters.region, 'euw1');
});

test('Mount: gleicher Rang, aber ausdruecklich gewaehlt → merken, nicht laden', () => {
  const r = withStorage(null, () => resolveMountFilters(AUTO, new URLSearchParams('bucket=diamond_plus')));
  assert.equal(r.change, 'auto');
  assert.equal(r.filters.bucketAuto, false);
  assert.equal(filtersDataKey(r.filters), filtersDataKey(AUTO));
});

test('Mount: gespeicherter Auto-Rang von gestern weicht dem frischen Server-Rang', () => {
  const stored = { ...AUTO, bucket: 'emerald_plus', bucketAuto: true };
  const r = withStorage(stored, () => resolveMountFilters(AUTO, new URLSearchParams('')));
  assert.equal(r.change, null);
  assert.equal(r.filters.bucket, 'diamond_plus');
});

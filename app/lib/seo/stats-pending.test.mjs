/**
 * Vorab-Skript fuer gespeicherte Filter (stats-pending.ts, SEO-Plan E3).
 *
 * Der teure Fehler: das Skript setzt KEIN Merkmal, React stellt nach der
 * Hydration aber andere Filter ein — dann stand die fremde Standardansicht
 * sichtbar da. Deshalb laeuft jeder Fall gegen loadInitialFilters, die
 * Funktion, die der Browser danach wirklich benutzt. Ein Merkmal zu viel ist
 * erlaubt (kurz Ladeanzeige), eines zu wenig nicht.
 *
 * Lauf: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { STATS_PENDING_SCRIPT, PENDING_ATTR, USER_BUCKET_ATTR, statsPendingCss } from './stats-pending.ts';
import {
  loadInitialFilters, filtersFromSearchParams, filtersDataKey, FILTERS_STORAGE_KEY, VELOCITY_SHIFTS, DAYS_MIN, DAYS_MAX,
} from '../tft-filters.ts';

// Fuehrt das Skript mit nachgebautem Browser aus; liefert die gesetzten Merkmale.
function runScript({ path = '/tft/units', search = '', stored }) {
  const attrs = new Map();
  const timers = [];
  const env = {
    document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k) } },
    location: { pathname: path, search },
    localStorage: { getItem: k => (k === FILTERS_STORAGE_KEY && stored !== undefined ? stored : null) },
    setTimeout: fn => timers.push(fn),
    URLSearchParams,
  };
  new Function(...Object.keys(env), STATS_PENDING_SCRIPT)(...Object.values(env));
  return { attrs, timers };
}

// Wie der Browser danach entscheidet (UnitsClient: loadInitialFilters mit dem Server-Rang).
function clientDiffers(stored, renderedBucket, search = '') {
  const sp = new URLSearchParams(search);
  const server = filtersFromSearchParams(sp, renderedBucket);
  const g = globalThis;
  const prev = g.window;
  g.window = { localStorage: { getItem: k => (k === FILTERS_STORAGE_KEY && stored !== undefined ? stored : null), setItem() {} } };
  try {
    return filtersDataKey(loadInitialFilters(sp, renderedBucket)) !== filtersDataKey(server);
  } finally {
    if (prev === undefined) delete g.window; else g.window = prev;
  }
}

// Blendet das <style> die Zeilen aus? Nachbau der beiden Selektoren.
function hidesRows(attrs, renderedBucket) {
  if (attrs.has(PENDING_ATTR)) return true;
  const ub = attrs.get(USER_BUCKET_ATTR);
  return ub !== undefined && ub !== renderedBucket;
}

const STORED = [
  undefined,
  'kaputt{',
  'null',
  '42',
  JSON.stringify({}),
  JSON.stringify({ patch: 'current', bucket: 'diamond_plus', bucketAuto: true, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'current', bucket: 'all', bucketAuto: true, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'current', bucket: 'diamond_plus', bucketAuto: false, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'current', bucket: 'master_plus', bucketAuto: false, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'current', bucket: 'master', bucketAuto: false, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'current', bucket: 'diamond', bucketAuto: false }),
  JSON.stringify({ patch: 'current', bucket: 7, bucketAuto: false }),
  JSON.stringify({ patch: '18.3', bucket: 'diamond_plus', bucketAuto: true, days: 3, region: 'all', velocity: 0 }),
  JSON.stringify({ patch: 'previous' }),
  JSON.stringify({ patch: 5 }),
  JSON.stringify({ days: 7 }),
  JSON.stringify({ days: '3' }),
  JSON.stringify({ days: null }),
  JSON.stringify({ days: 99 }),
  JSON.stringify({ days: 'x' }),
  JSON.stringify({ days: 0 }),
  JSON.stringify({ region: 'euw1' }),
  JSON.stringify({ region: 'all' }),
  JSON.stringify({ region: 3 }),
  JSON.stringify({ velocity: 3 }),
  JSON.stringify({ velocity: '7' }),
  JSON.stringify({ velocity: 5 }),
  JSON.stringify({ velocity: 0 }),
  JSON.stringify({ bucketAuto: false }),
  JSON.stringify({ bucketAuto: 'false', bucket: 'master_plus' }),
  // Aus den Konstanten erzeugt: kommt ein Wert dazu, laeuft er hier mit.
  ...VELOCITY_SHIFTS.flatMap(v => [JSON.stringify({ velocity: v }), JSON.stringify({ velocity: String(v) })]),
  JSON.stringify({ velocity: Math.max(...VELOCITY_SHIFTS) + 7 }),
  ...Array.from({ length: DAYS_MAX - DAYS_MIN + 3 }, (_, i) => JSON.stringify({ days: DAYS_MIN - 1 + i })),
];

test('kein ausgelassenes Merkmal: wo der Browser andere Filter einstellt, sind die Zeilen ausgeblendet', () => {
  for (const rendered of ['diamond_plus', 'all']) {
    for (const stored of STORED) {
      const { attrs } = runScript({ stored });
      if (clientDiffers(stored, rendered)) {
        assert.ok(hidesRows(attrs, rendered), `fremde Zahlen sichtbar: Speicher ${stored}, Server-Rang ${rendered}`);
      }
    }
  }
});

test('gleiche Filter wie der Server → kein Merkmal (keine unnoetige Ladeanzeige)', () => {
  for (const stored of [
    undefined,
    JSON.stringify({ patch: 'current', bucket: 'diamond_plus', bucketAuto: true, days: 3, region: 'all', velocity: 0 }),
    JSON.stringify({ patch: 'current', bucket: 'all', bucketAuto: true, days: 3, region: 'all', velocity: 0 }),
  ]) {
    const { attrs, timers } = runScript({ stored });
    assert.equal(attrs.size, 0, `Merkmal gesetzt bei ${stored}`);
    assert.equal(timers.length, 0);
  }
  // Ausdruecklich gewaehlter Rang = gerenderter Rang: Merkmal da, aber das <style> blendet nichts aus.
  const { attrs } = runScript({ stored: JSON.stringify({ bucket: 'diamond_plus', bucketAuto: false }) });
  assert.equal(attrs.get(USER_BUCKET_ATTR), 'diamond_plus');
  assert.equal(hidesRows(attrs, 'diamond_plus'), false);
});

test('Filter in der Adresse oder fremde Seite → kein Merkmal', () => {
  const stored = JSON.stringify({ region: 'euw1' });
  assert.equal(runScript({ stored, search: '?region=all' }).attrs.size, 0);
  assert.equal(runScript({ stored, search: '?days=3' }).attrs.size, 0);
  assert.equal(runScript({ stored, path: '/tft/units/TFT18_Lux' }).attrs.size, 0);
  assert.equal(runScript({ stored, path: '/tft' }).attrs.size, 0);
  for (const path of ['/tft/units', '/tft/items/', '/tft/traits', '/tft/comps', '/en/tft/comps', '/ko/tft/units', '/zh/tft/items/']) {
    assert.equal(runScript({ stored, path }).attrs.get(PENDING_ATTR), '1', path);
  }
  // Kein Sprach-Vorsatz: /de gibt es nicht, /enx ist keine Sprache.
  for (const path of ['/de/tft/comps', '/enx/tft/comps', '/en/tft/units/TFT18_Lux', '/en/tft']) {
    assert.equal(runScript({ stored, path }).attrs.size, 0, path);
  }
});

test('Notausgang: das Merkmal faellt nach dem Zeitgeber wieder weg', () => {
  const { attrs, timers } = runScript({ stored: JSON.stringify({ region: 'kr' }) });
  assert.equal(timers.length, 1);
  timers[0]();
  assert.equal(attrs.size, 0);
});

test('CSS: Rang nur eingesetzt, wenn er sauber ist', () => {
  assert.match(statsPendingCss('diamond_plus'), /:not\(\[data-tft-ub="diamond_plus"\]\)/);
  assert.doesNotMatch(statsPendingCss('x"]{}</style>'), /data-tft-ub/);
  assert.doesNotMatch(statsPendingCss(null), /data-tft-ub/);
  assert.match(statsPendingCss(null), /html\[data-tft-pending\] \[data-e3-rows\]\{display:none!important\}/);
});

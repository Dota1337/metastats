/**
 * Cache-Control-Auswahl in `cachedJson()`.
 *
 * Warum ueberhaupt ein Test: der degraded-Zweig ist genau der Pfad, den man
 * lokal per HTTP NICHT ausloest — die Entwicklungsdaten sind vollstaendig, also
 * antwortet jede Route mit ihrem Normal-TTL, und der Fehlerfall bleibt
 * ungetestet, bis er in Produktion einmal echte 6 Stunden lang eine leere
 * Liste festschreibt. Das ist der teuerste Fall der ganzen Header-Welle,
 * deshalb haengt er hier an einer Assertion statt an einer Code-Lesung.
 *
 * Lauf: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cachedJson,
  STATS_CACHE_CONTROL,
  SLOW_CACHE_CONTROL,
  ASSET_CACHE_CONTROL,
  DEGRADED_CACHE_CONTROL,
} from './api-cache.ts';

const cc = (res) => res.headers.get('Cache-Control');

test('ohne Optionen greift das Stats-Default-TTL', () => {
  assert.equal(cc(cachedJson({ ok: true })), STATS_CACHE_CONTROL);
});

test('explizites cache-Argument gewinnt gegen das Default', () => {
  assert.equal(cc(cachedJson({ ok: true }, { cache: SLOW_CACHE_CONTROL })), SLOW_CACHE_CONTROL);
  assert.equal(cc(cachedJson({ ok: true }, { cache: ASSET_CACHE_CONTROL })), ASSET_CACHE_CONTROL);
});

test('degraded schlaegt jedes explizite TTL', () => {
  // Der Aufrufer uebergibt sein normales TTL immer mit — die Degradierung darf
  // nicht davon abhaengen, dass er es in dem Moment weglaesst.
  for (const cache of [STATS_CACHE_CONTROL, SLOW_CACHE_CONTROL, ASSET_CACHE_CONTROL, undefined]) {
    assert.equal(cc(cachedJson({ items: [] }, { cache, degraded: true })), DEGRADED_CACHE_CONTROL);
  }
});

test('degraded:false verhaelt sich wie ein fehlendes Flag', () => {
  assert.equal(
    cc(cachedJson({ items: [1] }, { cache: SLOW_CACHE_CONTROL, degraded: false })),
    SLOW_CACHE_CONTROL,
  );
});

test('das degradierte TTL ist kurz genug, um einen Ausfall nicht festzuschreiben', () => {
  // Zahl statt Literal-Vergleich: die Aussage ist "hoechstens eine Minute",
  // nicht "exakt dieser String". Ein spaeterer Tune-Up auf 30s soll hier nicht
  // rot werden, ein versehentliches s-maxage=21600 schon.
  const sMaxAge = Number(/s-maxage=(\d+)/.exec(DEGRADED_CACHE_CONTROL)?.[1]);
  assert.ok(Number.isFinite(sMaxAge), 's-maxage fehlt im degradierten Header');
  assert.ok(sMaxAge <= 60, `degradiertes s-maxage zu lang: ${sMaxAge}s`);
});

test('Payload bleibt unveraendert, egal welcher Header gewaehlt wird', async () => {
  const res = cachedJson({ patches: [], source: 'x' }, { degraded: true });
  assert.deepEqual(await res.json(), { patches: [], source: 'x' });
  assert.equal(res.status, 200);
});

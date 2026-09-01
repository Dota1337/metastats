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
  cacheHeaders,
  BROWSER_CACHE_CONTROL,
  STATS_CACHE_CONTROL,
  SLOW_CACHE_CONTROL,
  ASSET_CACHE_CONTROL,
  DEGRADED_CACHE_CONTROL,
} from './api-cache.ts';

const cc = (res) => res.headers.get('Cache-Control');
const cdn = (res) => res.headers.get('Vercel-CDN-Cache-Control');

test('ohne Optionen greift das Stats-Default-TTL — auf der CDN-Zeile', () => {
  const res = cachedJson({ ok: true });
  assert.equal(cdn(res), STATS_CACHE_CONTROL);
  assert.equal(cc(res), BROWSER_CACHE_CONTROL);
});

test('explizites cache-Argument gewinnt gegen das Default', () => {
  assert.equal(cdn(cachedJson({ ok: true }, { cache: SLOW_CACHE_CONTROL })), SLOW_CACHE_CONTROL);
  assert.equal(cdn(cachedJson({ ok: true }, { cache: ASSET_CACHE_CONTROL })), ASSET_CACHE_CONTROL);
});

test('das lange TTL steht NIE im Cache-Control', () => {
  // Der Kern der Aenderung vom 2026-09-01: Vercel streicht s-maxage aus dem
  // Cache-Control, bevor die Antwort den Browser erreicht. Steht das lange TTL
  // dort, bekommt der Browser am Ende gar nichts und holt alles neu.
  for (const cache of [STATS_CACHE_CONTROL, SLOW_CACHE_CONTROL, ASSET_CACHE_CONTROL, undefined]) {
    assert.ok(!/s-maxage/.test(cc(cachedJson({ ok: true }, { cache }))));
  }
});

test('die Browser-Haltedauer bleibt kurz genug, um ruecknehmbar zu sein', () => {
  // Ein ausgelieferter max-age laesst sich nicht zurueckrufen — weder per
  // revalidatePath noch per Deploy. Deshalb eine Obergrenze statt eines
  // Literal-Vergleichs: 30s duerfen es spaeter auch sein, 300s nicht.
  const maxAge = Number(/max-age=(\d+)/.exec(BROWSER_CACHE_CONTROL)?.[1]);
  assert.ok(Number.isFinite(maxAge), 'max-age fehlt in der Browser-Zeile');
  assert.ok(maxAge > 0 && maxAge <= 60, `Browser-max-age ausserhalb 1..60s: ${maxAge}`);
});

test('cacheHeaders liefert dieselben drei Zeilen wie cachedJson', () => {
  const h = cacheHeaders(SLOW_CACHE_CONTROL);
  assert.equal(h['Cache-Control'], BROWSER_CACHE_CONTROL);
  assert.equal(h['Vercel-CDN-Cache-Control'], SLOW_CACHE_CONTROL);
  assert.ok(h['Vercel-Cache-Tag']);
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
    cdn(cachedJson({ items: [1] }, { cache: SLOW_CACHE_CONTROL, degraded: false })),
    SLOW_CACHE_CONTROL,
  );
});

test('die degradierte Antwort bekommt KEINE Browser-Haltedauer', () => {
  // Sonst sieht der Besucher die leere Liste weiter, obwohl die Edge laengst
  // wieder echte Daten hat — und man kommt an seinen Browser nicht heran.
  const res = cachedJson({ items: [] }, { degraded: true });
  assert.equal(cdn(res), null);
  // Wortgrenze vorne, sonst trifft das Muster auch das `s-maxage` der Edge.
  assert.ok(!/(^|[\s,])max-age=[1-9]/.test(cc(res)), `degradiert darf nicht browser-cachen: ${cc(res)}`);
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

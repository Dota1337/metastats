/**
 * Uebergangszeit nach einem Patchwechsel (User 23./24.10.2026): die Seite nennt
 * den neuen Patch, die Zahlen kommen aus dem letzten fertigen Stand. Getestet:
 * Beschriftung der Vorrats-Antworten, Edge-Cache, Alias-Waechter, Netz.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDisplayPatch, transitionCacheControl } from './stats-patch-display.ts';
import { patchFilterMatches } from './snapshot-lookup.ts';
import { lookupFallbackSnapshot } from './snapshot-fallback.ts';
import { STATS_CACHE_CONTROL, STATS_CACHE_CONTROL_FRESH } from './api-cache.ts';

const LIVE = [
  { patch: '18.5b', set_number: 18, first_day: '2026-10-22', last_day: '2026-10-24', total_matches: 421_032 },
  { patch: '18.5', set_number: 18, first_day: '2026-10-21', last_day: '2026-10-21', total_matches: 300_000 },
];
const STORED = { hasData: true, filters: { patch: '18.5', patchStartDay: '2026-10-21', endDay: '2026-10-21' }, patches: [LIVE[1]], items: [1] };
const TRANS = { patch: '18.5', displayPatch: '18.5b', patchStartDay: '2026-10-22' };
const NORMAL = { patch: '18.5b', displayPatch: '18.5b', patchStartDay: '2026-10-22' };

test('Vorrats-Antwort nennt in der Uebergangszeit den neuen Patch, Zahlen bleiben', () => {
  const out = withDisplayPatch(STORED, TRANS, LIVE);
  assert.equal(out.patches[0].patch, '18.5b', 'Beschriftung = patches[0]');
  assert.equal(out.filters.patch, '18.5b');
  assert.equal(out.filters.patchStartDay, '2026-10-22');
  assert.equal(out.filters.endDay, '2026-10-21', 'Fenster bleibt das des Stands');
  assert.equal(out.items, STORED.items);
  assert.equal(STORED.filters.patch, '18.5', 'gespeicherter Stand unveraendert');
});

test('ohne Uebergang: nur die Patchliste der DB, filters unveraendert', () => {
  const out = withDisplayPatch({ ...STORED, filters: { patch: '18.5b' } }, NORMAL, LIVE);
  assert.deepEqual(out.filters, { patch: '18.5b' });
  assert.equal(out.patches, LIVE);
  // DB weg (leere Liste) → gespeicherte Liste bleibt; Antwort ohne patches bekommt keine.
  assert.deepEqual(withDisplayPatch(STORED, NORMAL, []).patches, STORED.patches);
  assert.equal('patches' in withDisplayPatch({ filters: {}, comp: 1 }, NORMAL, LIVE), false);
  assert.equal(withDisplayPatch(null, TRANS, LIVE), null);
});

test('Edge-Cache in der Uebergangszeit kurz', () => {
  assert.equal(transitionCacheControl(STATS_CACHE_CONTROL, TRANS), STATS_CACHE_CONTROL_FRESH);
  assert.equal(transitionCacheControl(STATS_CACHE_CONTROL, NORMAL), STATS_CACHE_CONTROL);
  assert.equal(transitionCacheControl(STATS_CACHE_CONTROL, { patch: null, displayPatch: null }), STATS_CACHE_CONTROL);
});

test('Alias-Waechter: Stand der Standardansicht nicht fuer einen gewaehlten Patch', () => {
  // Live gemessen 24.10.: ?patch=18.5b bekam den Stand ohne Filter (20.–22.10.).
  assert.equal(patchFilterMatches(null, { patchFilter: '18.5b', patchFilterNoop: false }), false);
  // Fenster liegt ganz im Patch → Stand ohne Filter zaehlt dieselben Zeilen.
  assert.equal(patchFilterMatches(null, { patchFilter: '18.5b', patchFilterNoop: true }), true);
  assert.equal(patchFilterMatches('18.4', { patchFilter: '18.4' }), true);
  assert.equal(patchFilterMatches('18.4', { patchFilter: null }), false, 'previous-Stand nie fuer current');
  assert.equal(patchFilterMatches(null, { patchFilter: null }), true);
  // Alter Stand ohne Feld oder Aufrufer ohne Angabe → wie bisher.
  assert.equal(patchFilterMatches(undefined, { patchFilter: '18.5b' }), true);
  assert.equal(patchFilterMatches('18.4', {}), true);
});

function fakeLookup(byPatch) {
  const calls = [];
  const fn = async (endpoint, opts) => {
    calls.push(opts);
    const payload = byPatch[opts.patch ?? 'manifest'];
    return payload ? { payload, tag: `${endpoint}-v2`, blobUrl: '', blobBytes: 0, builtAt: '' } : null;
  };
  return { fn, calls };
}
const F = { patch: '18.5b', regionLabel: 'all', requestedDays: 3, bucketLabel: 'diamond_plus', setNumber: 18, patchFilter: null, patchFilterNoop: false };
const GOOD = { hasData: true, units: [1] };

test('Netz: ohne Stand unter dem Patch der Anfrage → Stand unter dem Patch des Manifests', async () => {
  const { fn, calls } = fakeLookup({ manifest: GOOD });
  const fb = await lookupFallbackSnapshot('units', 'units', F, fn);
  assert.equal(fb?.tag, 'snapshot-manifest:units-v2');
  assert.deepEqual(calls.map(c => c.patch), ['18.5b', null]);
  assert.equal(calls[1].patchFilter, null, 'Alias-Waechter auch im Netz');
  assert.equal(calls[1].endDay, undefined, 'ohne Endtag-Gleichheit');
});

test('Netz: eigener Stand zuerst; leerer Stand zaehlt nicht; gewaehlter Patch ohne Netz', async () => {
  const first = fakeLookup({ '18.5b': GOOD, manifest: GOOD });
  assert.equal((await lookupFallbackSnapshot('units', 'units', F, first.fn))?.tag, 'snapshot:units-v2');
  assert.equal(first.calls.length, 1);

  const empty = fakeLookup({ '18.5b': { hasData: true, units: [] }, manifest: GOOD });
  assert.equal((await lookupFallbackSnapshot('units', 'units', F, empty.fn))?.tag, 'snapshot-manifest:units-v2');

  const chosen = fakeLookup({ manifest: GOOD });
  assert.equal(await lookupFallbackSnapshot('units', 'units', { ...F, patchFilter: '18.5b' }, chosen.fn), null);
  assert.equal(chosen.calls.length, 1);

  const none = fakeLookup({});
  assert.equal(await lookupFallbackSnapshot('units', 'units', F, none.fn), null);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unitWarmBodies, unitsToWarm } from './explorer-unit-warm.mjs';
import { normalizeQuery } from './explorer-normalize.mjs';
import { parseExplorerParams, serializeExplorerQuery, toServiceBody } from '../../app/lib/tft-explorer-query.ts';
import { UNIT_DEFAULT_FILTERS, unitExplorerQueries } from '../../app/components/tft/unit/useUnitExplorer.ts';

test('Vorwaermen trifft dieselben Schluessel wie die Unit-Seite (Adresse → Route → Dienst)', () => {
  const id = 'TFTX_Foo';
  // Seite ohne ?region/?bucket: alle Regionen, master_plus, neuester Patch.
  const page = unitExplorerQueries(id, 'all', 'master_plus', UNIT_DEFAULT_FILTERS.patch, UNIT_DEFAULT_FILTERS);
  const viaRoute = (q) => {
    const sp = new URLSearchParams(serializeExplorerQuery(q, { forApi: true }));
    return normalizeQuery(toServiceBody(parseExplorerParams(sp)));
  };
  const warm = unitWarmBodies(id).map(b => normalizeQuery(b));
  assert.deepEqual(warm, [viaRoute(page.stars), viaRoute(page.items), viaRoute(page.builds)]);
});

test('unitsToWarm: nur Units gesamt ab Schwelle, meistgespielte zuerst, gedeckelt', () => {
  const rows = [
    { key: 'A', sub: null, games: 1500 },
    { key: 'B', sub: null, games: 999 },
    { key: 'C', sub: null, games: 4000 },
    { key: 'C', sub: 2, games: 3000 },
    { key: 'D', sub: null, games: 1500 },
  ];
  assert.deepEqual(unitsToWarm(rows), ['C', 'A', 'D']);
  assert.deepEqual(unitsToWarm(rows, { max: 2 }), ['C', 'A']);
  assert.deepEqual(unitsToWarm(null), []);
});

// Plan 19.10.2026 S1/S6: Explorer-Auswahl und Vorschlags-Paare muessen genau die
// Schluessel treffen, die die Seite nach einem Klick schickt.
const { pickWarmBody, coplayPairBodies } = await import('./explorer-unit-warm.mjs');
const { LIMITS } = await import('./explorer-normalize.mjs');
const { applyPick } = await import('../../app/components/tft/explorer/explorer-search.ts');
const { COPLAY_MAX, coplayChosen, coplayPick } = await import('../../app/lib/tft-explorer-coplay.mjs');

const routeBody = (q) => {
  const sp = new URLSearchParams(serializeExplorerQuery(q, { forApi: true }));
  return normalizeQuery(toServiceBody(parseExplorerParams(sp)));
};
const clickUnit = (q, id) => applyPick(q, { kind: 'units', f: { id } }, 'and', null).query;
const limits = { maxUnits: LIMITS.units, maxTotal: LIMITS.total };
// Zeilen des Units-Reiters; NOPE ist keine spielbare Unit (Seite blendet sie aus).
const ROWS = [
  { key: 'A', sub: null, games: 900 }, { key: 'NOPE', sub: null, games: 800 }, { key: 'A', sub: 2, games: 700 },
  ...'BCDEFGHIJ'.split('').map((k, i) => ({ key: k, sub: null, games: 600 - i * 10 })),
];
const playable = (id) => id !== 'NOPE';

test('Explorer-Auswahl: Vorwaermen trifft den Klick auf einen Suchtreffer', () => {
  const page = clickUnit(parseExplorerParams(new URLSearchParams('')), 'TFTX_Foo');
  assert.deepEqual(normalizeQuery(pickWarmBody('TFTX_Foo')), routeBody(page));
});

test('Vorschlags-Paare: jede Seiten-Auswahl liegt in den Paaren des Dienstes', () => {
  const anchors = [
    clickUnit(parseExplorerParams(new URLSearchParams('')), 'Z'),
    // Grundmenge und weitere Filter muessen im Paar erhalten bleiben.
    clickUnit(parseExplorerParams(new URLSearchParams('r=euw1&k=challenger,grandmaster,master&lv=8,9&t=TFTX_Trait:l2&u=Y:s2')), 'Z'),
  ];
  for (const page of anchors) {
    const service = coplayPairBodies(routeBody(page), ROWS, limits).map(b => JSON.stringify(normalizeQuery(b)));
    const picks = coplayPick(ROWS, { chosen: coplayChosen(page), allow: playable, max: COPLAY_MAX });
    assert.equal(picks.length, COPLAY_MAX);
    for (const r of picks) assert.ok(service.includes(JSON.stringify(routeBody(clickUnit(page, r.key)))), r.key);
  }
});

test('Vorschlags-Paare: keine, wo die Seite keine Vorschlaege zeigt', () => {
  const base = routeBody(clickUnit(parseExplorerParams(new URLSearchParams('')), 'Z'));
  assert.ok(coplayPairBodies(base, ROWS, limits).length > 0);
  assert.deepEqual(coplayPairBodies({ ...base, tab: 'items' }, ROWS, limits), []);
  assert.deepEqual(coplayPairBodies({ ...base, split: 'star' }, ROWS, limits), []);
  assert.deepEqual(coplayPairBodies({ ...base, units: base.units.map(u => ({ ...u, x: true })) }, ROWS, limits), []);
  const full = { ...base, units: Array.from({ length: LIMITS.units }, (_, i) => ({ ...base.units[0], id: `U${i}` })) };
  assert.deepEqual(coplayPairBodies(full, ROWS, limits), []);
  // Schon gewaehlte Units (auch im Kasten) werden nicht vorgeschlagen.
  const withGroup = { ...base, groups: [{ m: 'any', units: [{ ...base.units[0], id: 'A' }], items: [], traits: [] }] };
  assert.ok(coplayPairBodies(withGroup, ROWS, limits).every(b => !b.units.some(u => u.id === 'A')));
});

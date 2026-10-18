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

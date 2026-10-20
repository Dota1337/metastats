/**
 * Tagesentscheid und Versionen des Comp-Katalogs (comp-catalog-day.mjs) gegen
 * einen Store im Speicher.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideDay, buildAfterLoop, catalogFileBody, checkCatalogFile, catalogCollectOn, WARMUP_DAYS } from './comp-catalog-day.mjs';
import { catalogHash, CATALOG_RULES } from '../../app/lib/tft-comp-catalog.mjs';
import { familiesFromInputRows, patchFamily } from './comp-catalog-store.mjs';

const isUnit = () => true;
const fam = (key, games, ids) => ({ fam: key, games, sumPlacement: games * 4, units: Object.fromEntries(ids.map(id => [id, { g: games, s3: 0 }])), top4ByLevel: { 8: Math.round(games / 2) } });
const FAMS = [fam('T__a', 5000, ['a', 'b', 'c', 'd']), fam('U__e', 4000, ['e', 'f', 'g', 'h'])];

function memStore({ days = [], versions = [], families = FAMS, later = false, fail = false } = {}) {
  const st = { inserted: [], versions: [...versions] };
  const guard = () => { if (fail) throw new Error('db down'); };
  st.patchDays = async (set, family) => { guard(); return days.filter(d => patchFamily(d.patch) === family); };
  st.hasLaterDay = async () => { guard(); return later; };
  st.dayPatch = async () => null;
  st.loadFamilies = async () => { guard(); return { families, totalGames: families.reduce((s, f) => s + f.games, 0) }; };
  st.version = async (set, family, day) => st.versions.find(v => v.family === family && v.day === day && v.scope === 'day') ?? null;
  st.latestVersion = async (set, { family = null, beforeDay, inclusive = false }) => st.versions
    .filter(v => (!family || v.family === family) && (inclusive ? v.day <= beforeDay : v.day < beforeDay))
    .sort((x, y) => (x.day < y.day ? 1 : -1))[0] ?? null;
  st.insertVersion = async ({ family, day, catalog }) => {
    const v = { catalogId: 100 + st.versions.length, hash: catalogHash(catalog), day, family, scope: 'day', catalog };
    st.versions.push(v);
    st.inserted.push(v);
    return v;
  };
  return st;
}
const days185 = n => Array.from({ length: n }, (_, i) => ({ day: `2026-10-${21 + i}`, patch: '18.5' }));

test('Schalter aus und Anlauftage: klassisch', async () => {
  assert.equal((await decideDay({ day: '2026-10-25', set: 18, patch: '18.5', switchOn: false, store: memStore({ days: days185(4) }), isUnit })).reason, 'switch-off');
  const d = await decideDay({ day: '2026-10-23', set: 18, patch: '18.5', switchOn: true, store: memStore({ days: days185(2) }), isUnit });
  assert.deepEqual([d.mode, d.reason], ['classic', 'warmup']);
  assert.equal(WARMUP_DAYS, 3);
});

test('Schalter je Patch: COLLECT=1 immer, FROM_PATCH ab der Familie, ungueltig/leer aus', () => {
  const on = (env, patch) => catalogCollectOn({ ...env, patch });
  assert.deepEqual(on({ collect: '1' }, null), { on: true, reason: 'collect' });
  assert.deepEqual(on({ collect: '1', fromPatch: '19.1' }, '18.4'), { on: true, reason: 'collect' });
  assert.deepEqual(on({}, '18.5'), { on: false, reason: 'switch-off' });
  assert.deepEqual(on({ collect: '0', fromPatch: '  ' }, '18.5'), { on: false, reason: 'switch-off' });
  const from = { fromPatch: '18.5' };
  assert.deepEqual(on(from, '18.4'), { on: false, reason: 'before-from-patch' });
  assert.deepEqual(on(from, '18.3b'), { on: false, reason: 'before-from-patch' });
  assert.deepEqual(on(from, '18.5'), { on: true, reason: 'from-patch' });
  assert.deepEqual(on(from, '18.5b'), { on: true, reason: 'from-patch' });
  assert.deepEqual(on(from, '18.10'), { on: true, reason: 'from-patch' });
  assert.deepEqual(on(from, '19.1'), { on: true, reason: 'from-patch' });
  assert.deepEqual(on({ fromPatch: '18.10' }, '18.9'), { on: false, reason: 'before-from-patch' });
  assert.deepEqual(on(from, null), { on: false, reason: 'no-patch' });
  for (const bad of ['24.10.2026', '2026-10-24', '18', '18.5b', 'v18.5']) {
    assert.deepEqual(on({ fromPatch: bad }, '18.5'), { on: false, reason: 'from-patch-invalid' }, bad);
  }
});

test('Katalog-Tag: eingefroren aus der neuesten Version, unveraendert → alte Kennung', async () => {
  const store = memStore({ days: days185(3) });
  const first = await buildAfterLoop({ day: '2026-10-23', set: 18, patch: '18.5', decision: { mode: 'classic' }, store, isUnit });
  assert.equal(first.built, true);
  const d = await decideDay({ day: '2026-10-24', set: 18, patch: '18.5', switchOn: true, store, isUnit });
  assert.equal(d.mode, 'catalog');
  assert.equal(d.catalogId, first.catalogId, 'gleiche Daten → keine neue Version');
  assert.equal(store.inserted.length, 1);
  // Neue Familie am naechsten Tag → neue Version, alte Comps bleiben.
  const store2 = memStore({ days: days185(4), versions: store.versions, families: [...FAMS, fam('V__i', 3000, ['i', 'j', 'k', 'l'])] });
  const d2 = await decideDay({ day: '2026-10-25', set: 18, patch: '18.5', switchOn: true, store: store2, isUnit });
  assert.equal(d2.mode, 'catalog');
  assert.notEqual(d2.catalogId, first.catalogId);
  assert.deepEqual(d2.catalog.comps.map(c => c.key).sort(), ['T__a', 'U__e', 'V__i']);
});

test('B-Patch zaehlt zur Familie: 18.5 + 18.5b erreichen gemeinsam die Anlauftage', async () => {
  const days = [{ day: '2026-10-21', patch: '18.5' }, { day: '2026-10-22', patch: '18.5' }, { day: '2026-10-23', patch: '18.5b' }];
  const store = memStore({ days });
  await buildAfterLoop({ day: '2026-10-23', set: 18, patch: '18.5b', decision: { mode: 'classic' }, store, isUnit });
  const d = await decideDay({ day: '2026-10-24', set: 18, patch: '18.5b', switchOn: true, store, isUnit });
  assert.equal(d.mode, 'catalog');
});

test('Nachholtag: nie neue Version, nur vorhandene mit Tag ≤ D', async () => {
  const none = await decideDay({ day: '2026-10-25', set: 18, patch: '18.5', switchOn: true, store: memStore({ days: days185(6), later: true }), isUnit });
  assert.deepEqual([none.mode, none.reason], ['classic', 'gap-no-catalog']);
  const store = memStore({ days: days185(6), later: true });
  store.versions.push({ catalogId: 7, hash: 'h', day: '2026-10-24', family: '18.5', scope: 'day', catalog: { version: CATALOG_RULES.version, comps: [{ key: 'T__a' }] } });
  const d = await decideDay({ day: '2026-10-25', set: 18, patch: '18.5', switchOn: true, store, isUnit });
  assert.deepEqual([d.mode, d.catalogId], ['catalog', 7]);
  assert.equal(store.inserted.length, 0);
  assert.equal((await buildAfterLoop({ day: '2026-10-25', set: 18, patch: '18.5', decision: { mode: 'classic' }, store, isUnit })).reason, 'not-newest');
});

test('Fehler im Store → klassisch, nie Abbruch', async () => {
  const d = await decideDay({ day: '2026-10-25', set: 18, patch: '18.5', switchOn: true, store: memStore({ fail: true }), isUnit });
  assert.deepEqual([d.mode, d.reason], ['classic', 'error']);
});

test('Nach dem Lauf: nur an klassischen Tagen, unveraendert keine neue Version', async () => {
  const store = memStore({ days: days185(2) });
  assert.equal((await buildAfterLoop({ day: '2026-10-22', set: 18, patch: '18.5', decision: { mode: 'catalog' }, store, isUnit })).reason, 'catalog-day');
  assert.equal((await buildAfterLoop({ day: '2026-10-22', set: 18, patch: '18.5', decision: null, store, isUnit })).built, true);
  assert.equal((await buildAfterLoop({ day: '2026-10-22', set: 18, patch: '18.5', decision: null, store, isUnit })).reason, 'exists');
  const s2 = memStore({ days: days185(3), versions: store.versions });
  assert.equal((await buildAfterLoop({ day: '2026-10-23', set: 18, patch: '18.5', decision: null, store: s2, isUnit })).reason, 'unchanged');
});

test('Katalog-Datei: passende Datei ok, jede Abweichung abgelehnt', () => {
  const catalog = { version: CATALOG_RULES.version, comps: [{ key: 'T__a', core: ['a', 'b', 'c', 'd'], reroll: [], carries: ['a'], targetLevel: 8, members: ['T__a'], adopted: [], games: 5 }] };
  const decision = { mode: 'catalog', set: 18, patch: '18.5', catalogId: 12, hash: catalogHash(catalog), catalog };
  const body = JSON.parse(JSON.stringify(catalogFileBody({ day: '2026-10-24', decision })));
  const want = { set: 18, patch: '18.5', day: '2026-10-24' };
  assert.equal(checkCatalogFile(body, want).ok, true);
  assert.equal(checkCatalogFile(body, { ...want, day: '2026-10-25' }).ok, false);
  assert.equal(checkCatalogFile(body, { ...want, patch: '18.5b' }).ok, false);
  assert.equal(checkCatalogFile({ ...body, hash: 'x' }, want).ok, false);
  assert.equal(checkCatalogFile({ ...body, protocol: 2 }, want).ok, false);
  assert.equal(checkCatalogFile({ ...body, rulesVersion: 99 }, want).ok, false);
  assert.equal(checkCatalogFile(null, want).ok, false);
});

test('Eingabe-Zeilen: Schatten und klassische Cluster zur selben Familie zusammengelegt', () => {
  const fams = familiesFromInputRows([
    { key: 'T__a', games: '10', sum_placement: '40', units: { a: [10, 2] }, top4_by_level: { 8: 4 } },
    { key: 'T@3_a~aug', games: 5, sum_placement: 20, units: { a: [5, 1], b: [3, 0] }, top4_by_level: {} },
  ]);
  assert.deepEqual(fams, [{ fam: 'T__a', games: 15, sumPlacement: 60, units: { a: { g: 15, s3: 3 }, b: { g: 3, s3: 0 } }, top4ByLevel: { 8: 4 } }]);
});

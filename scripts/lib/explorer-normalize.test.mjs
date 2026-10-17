import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeQuery, hasBoardFilters, needsLive, LIMITS } from './explorer-normalize.mjs';
import { aggEligible } from './explorer-agg.mjs';
import { filterWhere, scopeWhere, itemKindOf, unitCond } from './explorer-query.mjs';
import { extraKindOf } from './tft-build-aggregator.mjs';

const rej = (q, msg) => assert.throws(() => normalizeQuery(q), (e) => e.status === 400 && (!msg || e.message === msg), JSON.stringify(q));
const nu = (u) => normalizeQuery({ units: [u] }).units[0];

test('alte Anfrage-Form bleibt gueltig, se wird zur Spanne', () => {
  const q = normalizeQuery({
    region: 'euw1', ranks: ['MASTER'], patches: ['18.4'], tab: 'units',
    units: [{ id: 'DA_18_Diana', s: 2, se: true, n: 2, it: ['DA_B', 'DA_A'], nit: ['DA_C'] }],
    items: [{ id: 'DA_X', x: true }], traits: [{ id: 'DA_T', l: 2, le: true }], focus: null, split: null, combo: 1,
  });
  assert.deepEqual(q.units[0], { id: 'DA_18_Diana', x: false, s: 2, sx: 2, n: 2, nx: null, c: null, it: ['DA_A', 'DA_B'], nit: ['DA_C'], k: [] });
  assert.deepEqual(q.items[0], { id: 'DA_X', x: true, n: null });
  assert.deepEqual(q.levels, []);
  assert.equal(q.place, null);
  assert.deepEqual(q.groups, []);
  assert.deepEqual(Object.keys(normalizeQuery({})), ['region', 'ranks', 'patches', 'levels', 'place', 'units', 'items', 'traits', 'groups', 'tab', 'focus', 'split', 'combo']);
});

test('Spannen: Grenzen ohne Wirkung fallen weg, verkehrte Spanne = 400', () => {
  assert.deepEqual([nu({ id: 'U', s: 1 }).s, nu({ id: 'U', s: 1 }).sx], [null, null]);
  assert.deepEqual([nu({ id: 'U', sx: 2 }).s, nu({ id: 'U', sx: 2 }).sx], [null, 2]);
  assert.deepEqual([nu({ id: 'U', s: 1, sx: 1 }).s, nu({ id: 'U', s: 1, sx: 1 }).sx], [1, 1]);
  assert.deepEqual([nu({ id: 'U', s: 4, sx: 4 }).s, nu({ id: 'U', s: 4, sx: 4 }).sx], [4, null]);
  assert.deepEqual([nu({ id: 'U', n: 0 }).n, nu({ id: 'U', n: 0 }).nx], [null, null]);
  assert.deepEqual([nu({ id: 'U', n: 0, nx: 0 }).n, nu({ id: 'U', n: 0, nx: 0 }).nx], [0, 0]);
  assert.deepEqual([nu({ id: 'U', nx: 3 }).n, nu({ id: 'U', nx: 3 }).nx], [null, null]);
  assert.equal(nu({ id: 'U', c: 1 }).c, null);
  assert.equal(nu({ id: 'U', c: 3 }).c, 3);
  rej({ units: [{ id: 'U', s: 3, sx: 2 }] }, 'invalid_star');
  rej({ units: [{ id: 'U', n: 2, nx: 1 }] }, 'invalid_item_count');
  rej({ units: [{ id: 'U', c: 4 }] }, 'invalid_copies');
});

test('gleiches Item zweimal bleibt stehen, Itemsorte kanonisch', () => {
  assert.deepEqual(nu({ id: 'U', it: ['DA_X', 'DA_X'] }).it, ['DA_X', 'DA_X']);
  assert.deepEqual(nu({ id: 'U', k: [{ b: 'radiant', n: 1 }, { b: 'emblem', n: 2 }] }).k, [{ b: 'emblem', n: 2 }, { b: 'radiant', n: 1 }]);
  assert.deepEqual(nu({ id: 'U', k: [{ b: 'artifact' }] }).k, [{ b: 'artifact', n: 1 }]);
  rej({ units: [{ id: 'U', k: [{ b: 'emblem', n: 1 }, { b: 'emblem', n: 2 }] }] }, 'invalid_item_kind');
  rej({ units: [{ id: 'U', k: [{ b: 'gold', n: 1 }] }] }, 'invalid_item_kind');
  assert.equal(normalizeQuery({ items: [{ id: 'DA_X', n: 1 }] }).items[0].n, null);
  assert.equal(normalizeQuery({ items: [{ id: 'DA_X', n: 2 }] }).items[0].n, 2);
});

test('Level und Platz: sortiert, alles = keine Einschraenkung, Fehler = 400', () => {
  assert.deepEqual(normalizeQuery({ levels: [9, 8, 9] }).levels, [8, 9]);
  assert.deepEqual(normalizeQuery({ levels: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }).levels, []);
  assert.deepEqual(normalizeQuery({ place: [1, 4] }).place, [1, 4]);
  assert.equal(normalizeQuery({ place: [1, 8] }).place, null);
  rej({ levels: [11] }, 'invalid_levels');
  rej({ place: [5, 4] }, 'invalid_place');
  rej({ place: [1] }, 'invalid_place');
});

test('Kaesten: kanonisch, leere fallen weg, „ohne" im Kasten = 400, Grenzen', () => {
  const g = normalizeQuery({ groups: [
    { m: 'none', items: [{ id: 'DA_Y' }] },
    { m: 'any', units: [{ id: 'DA_B' }, { id: 'DA_A', s: 2 }], traits: [{ id: 'DA_T', l: 2 }] },
    { m: 'any' },
  ] }).groups;
  assert.equal(g.length, 2);
  assert.deepEqual(g.map(x => x.m).sort(), ['any', 'none']);
  const any = g.find(x => x.m === 'any');
  assert.deepEqual(any.units.map(u => u.id), ['DA_A', 'DA_B']);
  rej({ groups: [{ m: 'any', units: [{ id: 'DA_A', x: true }] }] }, 'invalid_group_unit');
  rej({ groups: [{ m: 'oder', units: [{ id: 'DA_A' }] }] }, 'invalid_group');
  rej({ groups: [{ m: 'any', units: Array.from({ length: 7 }, (_, i) => ({ id: `DA_${i}` })) }] });
  rej({ groups: Array.from({ length: 4 }, () => ({ m: 'any', units: [{ id: 'DA_A' }] })) }, 'too_many_groups');
  // Gesamtgrenze ueber alle Bedingungen
  const many = (n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}` }));
  rej({ units: many(9, 'U'), items: many(6, 'I'), groups: [{ m: 'any', units: many(1, 'G') }] }, 'too_many_filters');
  assert.equal(LIMITS.total, 15);
});

test('unbekannte Felder = 400, ohne den Feldnamen zurueckzugeben', () => {
  rej({ foo: 1 }, 'unknown_field');
  rej({ units: [{ id: 'U', star: 2 }] }, 'unknown_field_unit');
  rej({ items: [{ id: 'I', count: 2 }] }, 'unknown_field_item');
  rej({ groups: [{ m: 'any', what: 1 }] }, 'unknown_field_group');
  rej([], 'invalid_body');
});

test('jede neue Filterart nimmt die Teilsummen aus dem Spiel (aggEligible null)', () => {
  const base = { tab: 'units', patches: ['18.4'] };
  assert.ok(aggEligible(normalizeQuery(base)));
  for (const extra of [
    { levels: [9] }, { place: [1, 4] }, { units: [{ id: 'U', c: 2 }] }, { items: [{ id: 'I', n: 2 }] },
    { groups: [{ m: 'any', units: [{ id: 'U' }] }] }, { groups: [{ m: 'none', traits: [{ id: 'T' }] }] },
  ]) {
    const q = normalizeQuery({ ...base, ...extra });
    assert.equal(aggEligible(q), null, JSON.stringify(extra));
    assert.equal(needsLive(q), true, JSON.stringify(extra));
  }
  assert.equal(hasBoardFilters(normalizeQuery({ levels: [9], place: [1, 4] })), false, 'Level/Platz = Grundmenge');
  assert.equal(hasBoardFilters(normalizeQuery({ groups: [{ m: 'any', items: [{ id: 'I' }] }] })), true);
});

test('SQL: Platzhalter und Parameter passen zusammen, Level/Platz in der Grundmenge', () => {
  const q = normalizeQuery({
    levels: [8, 9], place: [1, 4], ranks: ['MASTER', 'unknown'], patches: ['18.4'], region: 'euw1',
    units: [
      { id: 'DA_A', s: 1, sx: 2, nx: 1, c: 2, it: ['DA_X', 'DA_X', 'DA_Y'], nit: ['DA_Z'], k: [{ b: 'emblem', n: 1 }] },
      { id: 'DA_B', x: true, sx: 2 },
    ],
    items: [{ id: 'DA_I', n: 2 }, { id: 'DA_J', x: true }],
    traits: [{ id: 'DA_T', l: 2 }],
    groups: [{ m: 'any', units: [{ id: 'DA_C', s: 2 }], items: [{ id: 'DA_K', n: 3 }] }, { m: 'none', traits: [{ id: 'DA_U' }] }],
  });
  const p = [];
  const sql = [...scopeWhere(q, p), ...filterWhere(q, p)].join(' AND ');
  assert.equal((sql.match(/\?/g) || []).length, p.length);
  assert.match(sql, /b\.level IN \(\?,\?\)/);
  assert.match(sql, /b\.placement BETWEEN \? AND \?/);
  assert.match(sql, /NOT coalesce\(/);
  assert.match(sql, /HAVING count\(\*\) >= \? AND bool_or\(/);
  assert.ok(!/list_filter|->/.test(sql), 'keine Lambdas mit Parametern');
  // alte Unit-Form: unveraenderte SQL
  const p2 = [];
  assert.equal(unitCond(nu({ id: 'DA_A', s: 2, n: 2, it: ['DA_X'], nit: ['DA_Y'] }), p2),
    'SELECT bid FROM units WHERE unit = ? AND star >= ? AND n_items >= ? AND list_contains([i1, i2, i3], ?) AND NOT list_contains([i1, i2, i3], ?)');
  assert.deepEqual(p2, ['DA_A', 2, 2, 'DA_X', 'DA_Y']);
});

test('Itemsorte: gleiche Muster wie extraKindOf (Bundle Set 18), Radiant ueber die Endung', () => {
  const bundle = JSON.parse(fs.readFileSync(new URL('../../public/tft-assets-18.json', import.meta.url), 'utf8'));
  const ids = Object.keys(bundle.items);
  let rad = 0;
  for (const id of ids) {
    const k = itemKindOf(id);
    const e = extraKindOf(id);
    if (e) assert.equal(k, e, id);
    else if (k) { assert.equal(k, 'radiant', id); rad++; }
  }
  assert.ok(rad > 50, `Radiants ${rad}`);
  assert.equal(itemKindOf('DA_Artifact_WitsEnd'), 'artifact');
  assert.equal(itemKindOf('DA_18_EmblemBrawler'), 'emblem');
  assert.equal(itemKindOf('TFT5_Item_DragonsClawRadiant'), 'radiant');
  assert.equal(itemKindOf('DA_Augment_EmblemThing'), null);
});

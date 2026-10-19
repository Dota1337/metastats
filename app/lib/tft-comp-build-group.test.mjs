// Tests fuer die Build-Gruppen der Varianten (tft-comp-build-group.ts).
//
// Warum: Knopf-Zahlen (variants-API) und genaue Ansicht (Detail-API) muessen
// dieselbe Gruppe bilden, sonst springt die Spielzahl nach dem Klick.
//
// Lauf: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addUnitCounts, buildGroupMembers, buildGroups, compBuildHash } from './tft-comp-build-group.ts';

test('Hash: nur Units ab 15 % (mind. 3), sortiert; leer → ~empty~', () => {
  const counts = new Map([['B', 20], ['A', 15], ['Tech', 14]]);
  assert.equal(compBuildHash(counts, 100), 'A|B');
  assert.equal(compBuildHash(new Map([['A', 2]]), 10), '~empty~', 'unter der Mindestzahl 3');
  assert.equal(compBuildHash(new Map([['A', 5]]), 0), '~empty~');
});

test('Zaehlen ueber Tage, kaputte Eintraege ignoriert', () => {
  const m = new Map();
  addUnitCounts(m, [{ characterId: 'A', count: 2 }, { characterId: 'B', count: 1 }]);
  addUnitCounts(m, [{ characterId: 'A', count: 3 }, { count: 9 }, null]);
  addUnitCounts(m, 'kein Array');
  assert.deepEqual([...m], [['A', 5], ['B', 1]]);
});

const row = (key, games, units) => ({ key, games, days: [units.map(([characterId, count]) => ({ characterId, count }))] });
const members = (rows, key) => buildGroupMembers(rows, key, r => r.key, r => r.games, r => r.days);

test('gleiche Units → eine Gruppe, eigene Kennung vorn; andere Units bleiben draussen', () => {
  const rows = [
    row('T@3_C', 100, [['A', 90], ['B', 80]]),
    row('T@3_C*3', 40, [['A', 40], ['B', 30], ['Tech', 2]]),
    row('T@4_C', 50, [['A', 50], ['D', 50]]),
  ];
  assert.deepEqual(members(rows, 'T@3_C*3'), ['T@3_C*3', 'T@3_C']);
  assert.deepEqual(members(rows, 'T@4_C'), ['T@4_C']);
});

test('Kennung ohne Zeile → nur sie selbst', () => {
  assert.deepEqual(members([row('T@3_C', 100, [['A', 90]])], 'T@9_C'), ['T@9_C']);
});

test('buildGroups: gleiche Gruppen wie buildGroupMembers, Anker = meiste Spiele', () => {
  const u = ids => [ids.map(id => ({ characterId: id, count: 50 }))];
  const rows = [
    { key: 'x@5_A', games: 100, units: u(['A', 'B', 'C']) },
    { key: 'y@4_D', games: 300, units: u(['A', 'B', 'C']) },
    { key: 'x@7_A', games: 200, units: u(['A', 'B', 'E']) },
  ];
  const groups = buildGroups(rows, r => r.games, r => r.units).map(g => g.map(r => r.key));
  assert.deepEqual(groups.sort((a, b) => a[0].localeCompare(b[0])), [['x@7_A'], ['y@4_D', 'x@5_A']]);
  const viaMembers = buildGroupMembers(rows, 'x@5_A', r => r.key, r => r.games, r => r.units);
  assert.deepEqual(new Set(viaMembers), new Set(['x@5_A', 'y@4_D']));
});

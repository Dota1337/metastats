// Node-Test fuer die Reihen der Items-Seite. Lauf: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  filterItems, groupItemsByTier, isListedItem, itemExtraQuery, itemKindOf, itemTierLetter,
  parseItemSort, parseItemTypes, placementBlocks, toggleItemKind,
} from './tft-item-tier-rows.ts';

const row = (apiName, avgPlacement, games = 1000, extra = {}) => ({
  apiName, avgPlacement, games, top4Rate: 0.5, top1Rate: 0.1, pickRate: 0.01, topUsers: [], ...extra,
});
const assets = { items: {
  DA_Item_A: { name: 'Alpha', tags: [] },
  DA_Component_Sword: { name: 'Sword', tags: ['component'] },
  DA_HealthPotion18: { name: 'Health Potion', tags: [] },
} };

test('Reihen laufen S+ bis C, die Reihe ohne Buchstaben steht zuletzt und nur, wenn belegt', () => {
  const rows = groupItemsByTier([row('c', 4.6), row('sp', 3.9), row('b', 4.4)], { assets, sort: 'avg' });
  assert.deepEqual(rows.map(r => r.tier), ['S+', 'B', 'C']);
  const withNone = groupItemsByTier([row('sp', 3.9), row('wenig', 3.0, 149)], { assets, sort: 'avg' });
  assert.deepEqual(withNone.map(r => r.tier), ['S+', null]);
});

test('Buchstabe = freigegebene Item-Grenzen am angezeigten Wert', () => {
  assert.equal(itemTierLetter(row('x', 3.994), assets), 'S+');
  assert.equal(itemTierLetter(row('x', 4.10), assets), 'S');
  assert.equal(itemTierLetter(row('x', 4.24), assets), 'A');
  assert.equal(itemTierLetter(row('x', 4.49), assets), 'B');
  assert.equal(itemTierLetter(row('x', 4.50), assets), 'C');
  assert.equal(itemTierLetter(row('DA_Component_Sword', 3.0), assets), null);
  assert.equal(itemTierLetter(row('DA_HealthPotion18', 2.9), assets), null);
});

test('ohne Buchstaben: Traenke, zu wenig Spiele, je nach Spielen — nicht nach Ø', () => {
  const [none] = groupItemsByTier([
    row('wenig', 2.0, 100),
    row('DA_ManaPotion18', 4.4, 400),
    row('DA_HealthPotion18', 2.9, 900),
  ], { assets, sort: 'avg' });
  assert.deepEqual(none.items.map(i => i.apiName), ['DA_HealthPotion18', 'DA_ManaPotion18', 'wenig']);
});

test('Knoepfe: Traenke fuer sich, auch die Radiant-Traenke; nichts faellt heraus', () => {
  const a = { items: {
    DA_Bloodthirster: { name: 'Bloodthirster', composition: ['x', 'y'], tags: [] },
    DA_BloodthirsterRadiant: { name: 'Radiant Bloodthirster', tags: [] },
    DA_18_EmblemDefender: { name: 'Defender Emblem', tags: [] },
    DA_Artifact_Dawncore: { name: 'Dawncore', tags: [] },
    DA_HealthPotion18: { name: 'Health Potion', tags: [] },
    DA_HealthPotion18_Radiant: { name: 'Radiant Health Potion', tags: [] },
    DA_Unbekannt: { name: 'Unbekannt', tags: [] },
  } };
  const kinds = Object.fromEntries(Object.keys(a.items).map(id => [id, itemKindOf(id, a)]));
  assert.deepEqual(kinds, {
    DA_Bloodthirster: 'standard',
    DA_BloodthirsterRadiant: 'radiant',
    DA_18_EmblemDefender: 'emblem',
    DA_Artifact_Dawncore: 'artifact',
    DA_HealthPotion18: 'potion',
    DA_HealthPotion18_Radiant: 'potion',
    DA_Unbekannt: 'standard',
  });
  const rows = Object.keys(a.items).map(id => row(id, 4));
  const left = filterItems(rows, { type: ['potion'], search: '', assets: a, lang: 'de' }).map(i => i.apiName);
  assert.deepEqual(left, ['DA_HealthPotion18', 'DA_HealthPotion18_Radiant']);
  const two = filterItems(rows, { type: ['emblem', 'artifact'], search: '', assets: a, lang: 'de' }).map(i => i.apiName);
  assert.deepEqual(two, ['DA_18_EmblemDefender', 'DA_Artifact_Dawncore']);
  assert.equal(filterItems(rows, { type: [], search: '', assets: a, lang: 'de' }).length, rows.length);
});

test('Mehrere Arten: Adresse hat eine feste Schreibweise, alle fuenf heissen Alle', () => {
  assert.deepEqual(parseItemTypes('potion'), ['potion']);
  assert.deepEqual(parseItemTypes('emblem,radiant,emblem'), ['radiant', 'emblem']);
  assert.deepEqual(parseItemTypes('Quatsch,artifact,other'), ['artifact']);
  assert.deepEqual(parseItemTypes('Quatsch'), []);
  assert.deepEqual(parseItemTypes(''), []);
  assert.deepEqual(parseItemTypes(null), []);
  assert.deepEqual(parseItemTypes('standard,radiant,emblem,artifact,potion'), []);
  // Beim Umschalten dieselbe Regel: die Klickfolge aendert die Adresse nicht.
  const emblemFirst = toggleItemKind(toggleItemKind([], 'emblem'), 'radiant');
  const radiantFirst = toggleItemKind(toggleItemKind([], 'radiant'), 'emblem');
  assert.deepEqual(emblemFirst, ['radiant', 'emblem']);
  assert.deepEqual(radiantFirst, emblemFirst);
  assert.deepEqual(toggleItemKind(['radiant', 'emblem'], 'radiant'), ['emblem']);
  // Letzte aus = Alle, fuenfte an = Alle.
  assert.deepEqual(toggleItemKind(['emblem'], 'emblem'), []);
  assert.deepEqual(toggleItemKind(['standard', 'radiant', 'emblem', 'artifact'], 'potion'), []);
});

test("Tactician's Crown, Shield und Cape stehen nicht auf der Seite", () => {
  for (const id of [
    'DA_TacticiansCrown', 'DA_TacticiansShield', 'DA_TacticiansCape',
    'TFT_Item_ForceOfNature', 'TFT_Item_TacticiansScepter', 'TFT_Item_TacticiansRing',
  ]) {
    assert.equal(isListedItem(id), false, id);
  }
  assert.equal(isListedItem('DA_Crownguard'), true);
});

test('Komponenten stehen nicht auf der Seite, auch wenn nur das Merkmal sie verraet', () => {
  const withOldName = { items: { ...assets.items, TFT_Item_BFSword: { name: 'B.F. Sword', tags: ['component'] } } };
  const items = [row('DA_Item_A', 4), row('DA_Component_Sword', 5), row('TFT_Item_BFSword', 5), row('DA_HealthPotion18', 2.9)];
  const left = filterItems(items, { type: [], search: '', assets: withOldName, lang: 'de' }).map(i => i.apiName);
  assert.deepEqual(left, ['DA_Item_A', 'DA_HealthPotion18']);
  // Noch ohne Bild- und Namensdaten greift wenigstens die Kennung.
  assert.equal(isListedItem('DA_Component_Sword'), false);
  assert.equal(isListedItem('DA_Component_Sword', null), false);
  // Spatel und Bratpfanne sind Komponenten mit eigenem Weg, keine Sonderfaelle.
  assert.equal(isListedItem('DA_Component_Spatula'), false);
  assert.equal(isListedItem('DA_Component_FryingPan'), false);
});

test('Sortierung innerhalb der Reihe, Gleichstand fest, ohne Wert zuletzt', () => {
  const items = [row('a', 4.0, 10_000, { top4Rate: 0.5 }), row('b', 3.8, 200, { top4Rate: 0.6 }), row('c', 3.9, 500, { top4Rate: null })];
  const ids = sort => groupItemsByTier(items, { assets, sort })[0].items.map(i => i.apiName);
  assert.deepEqual(groupItemsByTier([row('b', 3.8), row('a', 3.8)], { assets, sort: 'avg' })[0].items.map(i => i.apiName), ['a', 'b']);
  assert.deepEqual(groupItemsByTier([row('a', 3.8), row('b', 3.5)], { assets, sort: 'avg' })[0].items.map(i => i.apiName), ['b', 'a']);
  assert.equal(ids('top4')[0], 'b');
  assert.equal(ids('top4').at(-1), 'c');
});

test('Trending: staerkste Verbesserung zuerst, ohne Vergleich zuletzt', () => {
  const delta = { a: 0.1, b: -0.2 };
  const rows = groupItemsByTier([row('a', 3.5), row('b', 3.6), row('c', 3.7)], { assets, sort: 'velocity', deltaOf: id => delta[id] ?? null });
  assert.deepEqual(rows[0].items.map(i => i.apiName), ['b', 'a', 'c']);
});

test('Augment-Embleme fliegen raus, das echte Emblem bleibt', () => {
  assert.equal(isListedItem('DA_18_EmblemFloraFatalisAugment'), false);
  assert.equal(isListedItem('DA_18_EmblemFloraFatalis'), true);
  assert.equal(isListedItem('DA_Item_InfinityEdge'), true);
});

test('Suche findet Namen und Kennung, Art filtert', () => {
  const items = [row('DA_Item_A', 4), row('DA_Artifact_B', 4)];
  const f = (type, search) => filterItems(items, { type, search, assets, lang: 'en' }).map(i => i.apiName);
  assert.deepEqual(f([], ''), ['DA_Item_A', 'DA_Artifact_B']);
  assert.deepEqual(f(['artifact'], ''), ['DA_Artifact_B']);
  assert.deepEqual(f([], 'alph'), ['DA_Item_A']);
  assert.deepEqual(f([], 'artifact_b'), ['DA_Artifact_B']);
});

test('Platzverteilung ergibt 100 % und zeigt ohne Wert nichts', () => {
  const b = placementBlocks({ top1Rate: 0.1628, top4Rate: 0.6021 });
  assert.ok(Math.abs(b.first + b.second + b.third - 1) < 1e-9);
  assert.equal(b.first, 0.1628);
  assert.ok(Math.abs(b.second - 0.4393) < 1e-9);
  assert.ok(Math.abs(b.third - 0.3979) < 1e-9);
  assert.equal(placementBlocks({ top1Rate: null, top4Rate: 0.6 }), null);
  assert.equal(placementBlocks({ top1Rate: 0.1, top4Rate: null }), null);
});

test('Adress-Werte werden geprueft und nur bei Abweichung geschrieben', () => {
  assert.equal(parseItemSort('win'), 'win');
  assert.equal(parseItemSort('quatsch'), 'avg');
  assert.equal(parseItemSort(null), 'avg');
  assert.deepEqual(parseItemTypes('radiant'), ['radiant']);
  assert.deepEqual(parseItemTypes('other'), []);
  assert.equal(itemExtraQuery({ item: null, sort: 'avg', type: [] }), '');
  assert.equal(itemExtraQuery({ item: 'A B&c', sort: 'win', type: ['emblem'] }), '&item=A%20B%26c&sort=win&type=emblem');
  assert.equal(itemExtraQuery({ item: null, sort: 'avg', type: ['radiant', 'emblem'] }), '&type=radiant,emblem');
});

test('Die Adress-Parameter bleiben ausserhalb der Filter-Schluessel', () => {
  // Sonst schaltet ?item= gespeicherte Filter ab (tft-filters.ts, stats-pending.ts).
  const src = readFileSync(new URL('./tft-filters.ts', import.meta.url), 'utf8');
  const keys = src.match(/URL_FILTER_KEYS = \[(.*?)\]/)[1];
  for (const k of ['item', 'sort', 'type']) assert.ok(!keys.includes(`'${k}'`), k);
});

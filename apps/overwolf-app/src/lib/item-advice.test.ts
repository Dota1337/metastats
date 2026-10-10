import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { adviseOffer, itemCategory, radiantBase, emblemTrait } from './item-advice.ts';

// Kennungen wie im Spiel (Set 18, Lookups vom 10.10.).
const lk: CompanionLookups = {
  v: 1, set: 18,
  champions: {},
  items: {
    DA_Component_BFSword: { name: 'B.F. Sword', icon: null, component: true },
    DA_Component_RecurveBow: { name: 'Recurve Bow', icon: null, component: true },
    DA_Component_ChainVest: { name: 'Chain Vest', icon: null, component: true },
    DA_Component_Spatula: { name: 'Spatula', icon: null, component: true },
    DA_GiantSlayer: { name: 'Giant Slayer', icon: null, recipe: ['DA_Component_BFSword', 'DA_Component_RecurveBow'] },
    DA_Bloodthirster: { name: 'Bloodthirster', icon: null, recipe: ['DA_Component_BFSword', 'DA_Component_NegatronCloak'] },
    DA_BrambleVest: { name: 'Bramble Vest', icon: null, recipe: ['DA_Component_ChainVest', 'DA_Component_ChainVest'] },
    DA_BloodthirsterRadiant: { name: 'Radiant Bloodthirster', icon: null },
    TFT5_Item_BloodthirsterRadiant: { name: 'Radiant Bloodthirster', icon: null },
    DA_BrambleVestRadiant: { name: 'Radiant Bramble Vest', icon: null },
    DA_18_EmblemExecutioner: { name: 'Executioner Emblem', icon: null, recipe: ['DA_Component_Spatula', 'DA_Component_BFSword'] },
    DA_18_EmblemLunar: { name: 'Lunar Emblem', icon: null, recipe: ['DA_Component_Spatula', 'DA_Component_ChainVest'] },
    DA_Artifact_Dawncore: { name: 'Dawncore', icon: null },
    DA_Artifact_LudensTempest: { name: "Luden's Tempest", icon: null },
    DA_Artifact_Mittens: { name: 'Mittens', icon: null },
    DA_Consumable_ItemRemover: { name: 'Item Remover', icon: null },
  },
  traits: {}, shopOdds: {}, bagSize: {},
};

const comp: CompanionComp = {
  key: 'DA_18_Executioner__DA_18_Azir', slug: 's', name: 'Executioner · Azir', trait: 'DA_18_Executioner',
  carries: ['DA_18_Azir'], itemCarriers: ['DA_18_Azir', 'DA_18_Rammus'], tier: 'S', avg: 4, top4: 0.5, win: 0.1,
  pick: 0.01, games: 1000, traitLevel: 4, avgLevel: 8,
  units: [
    { id: 'DA_18_Veigar' },
    { id: 'DA_18_Azir', items: ['DA_GiantSlayer', 'DA_Bloodthirster'] },
    { id: 'DA_18_Rammus', items: ['DA_BrambleVest'] },
  ],
};

const stats = new Map([
  ['DA_Artifact_Dawncore', { games: 19521, avg: 3.75 }],
  ['DA_Artifact_LudensTempest', { games: 12440, avg: 3.84 }],
  ['DA_Artifact_Mittens', { games: 900, avg: 3.1 }],
  ['DA_BloodthirsterRadiant', { games: 5000, avg: 3.9 }],
  ['DA_BrambleVestRadiant', { games: 5000, avg: 4.4 }],
]);

test('itemCategory nach Kennung und Lookups', () => {
  assert.equal(itemCategory('DA_Component_BFSword', lk), 'component');
  assert.equal(itemCategory('DA_GiantSlayer', lk), 'finished');
  assert.equal(itemCategory('DA_BloodthirsterRadiant', lk), 'radiant');
  assert.equal(itemCategory('DA_Artifact_Dawncore', lk), 'artifact');
  assert.equal(itemCategory('DA_18_EmblemLunar', lk), 'emblem');
  assert.equal(itemCategory('DA_Consumable_ItemRemover', lk), 'consumable');
  assert.equal(itemCategory('DA_Reforger', lk), null);
});

test('radiantBase und emblemTrait', () => {
  assert.equal(radiantBase('DA_BloodthirsterRadiant', lk), 'DA_Bloodthirster');
  assert.equal(radiantBase('TFT5_Item_BloodthirsterRadiant', lk), 'DA_Bloodthirster');
  assert.equal(radiantBase('DA_GiantSlayer', lk), null);
  assert.equal(emblemTrait('DA_18_EmblemExecutioner'), 'DA_18_Executioner');
});

test('Komponenten: nur Rezept-Treffer bei den Traegern, nie ein Rang', () => {
  const h = adviseOffer(['DA_Component_RecurveBow', 'DA_Component_ChainVest', 'DA_Component_Spatula'], lk, comp, stats);
  assert.deepEqual(h[0], { kind: 'comp', via: 'recipe', item: 'DA_GiantSlayer', unit: 'DA_18_Azir' });
  assert.deepEqual(h[1], { kind: 'comp', via: 'recipe', item: 'DA_BrambleVest', unit: 'DA_18_Rammus' });
  assert.equal(h[2], null);
  assert.deepEqual(adviseOffer(['DA_Component_RecurveBow'], lk, null, stats), [null]);
});

test('Fertige Items und Embleme: Traeger bzw. Trait der Comp', () => {
  const h = adviseOffer(['DA_Bloodthirster', 'DA_18_EmblemExecutioner', 'DA_18_EmblemLunar'], lk, comp, stats);
  assert.deepEqual(h[0], { kind: 'comp', via: 'direct', item: 'DA_Bloodthirster', unit: 'DA_18_Azir' });
  assert.deepEqual(h[1], { kind: 'comp', via: 'emblem', item: 'DA_18_EmblemExecutioner', unit: null });
  assert.equal(h[2], null);
});

test('Strahlende: Comp-Treffer ueber das Grund-Item, sonst Rang', () => {
  const h = adviseOffer(['DA_BrambleVestRadiant', 'DA_BloodthirsterRadiant'], lk, comp, stats);
  assert.deepEqual(h[0], { kind: 'comp', via: 'radiant', item: 'DA_BrambleVest', unit: 'DA_18_Rammus' });
  assert.deepEqual(h[1], { kind: 'comp', via: 'radiant', item: 'DA_Bloodthirster', unit: 'DA_18_Azir' });
  const none = adviseOffer(['DA_BrambleVestRadiant', 'DA_BloodthirsterRadiant'], lk, null, stats);
  assert.deepEqual(none[1], { kind: 'rank', rank: 1, of: 2, best: true, avg: 3.9 });
  assert.deepEqual(none[0], { kind: 'rank', rank: 2, of: 2, best: false, avg: 4.4 });
});

test('Artefakte: Rang nur ab 1000 Spielen, „beste“ nur bei Abstand > 0,2', () => {
  const h = adviseOffer(['DA_Artifact_Mittens', 'DA_Artifact_LudensTempest', 'DA_Artifact_Dawncore', 'DA_Consumable_ItemRemover'], lk, comp, stats);
  assert.equal(h[0], null); // 900 Spiele
  assert.deepEqual(h[2], { kind: 'rank', rank: 1, of: 2, best: false, avg: 3.75 });
  assert.deepEqual(h[1], { kind: 'rank', rank: 2, of: 2, best: false, avg: 3.84 });
  assert.equal(h[3], null);
  // Nur ein bewertbares Artefakt: kein Rang.
  assert.deepEqual(adviseOffer(['DA_Artifact_Dawncore', 'DA_Artifact_Mittens'], lk, null, stats), [null, null]);
});

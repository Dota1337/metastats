import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { levelPlan, compRecipes, shopMatches, groupRecipes } from './plan.ts';

const lookups: CompanionLookups = {
  v: 1, set: 18,
  champions: {
    A: { name: 'A', cost: 1, icon: null, traits: [] },
    B: { name: 'B', cost: 2, icon: null, traits: [] },
    D: { name: 'D', cost: 4, icon: null, traits: [] },
  },
  items: {
    Sword: { name: 'Sword', icon: null, component: true },
    Bow: { name: 'Bow', icon: null, component: true },
    Giant: { name: 'Giant', icon: null, recipe: ['Sword', 'Bow'] },
    Emblem: { name: 'Emblem', icon: null },
  },
  traits: {},
  shopOdds: {},
  bagSize: {},
};

function comp(units: CompanionComp['units'], avgLevel: number | null = 8): CompanionComp {
  return {
    key: 'k', slug: 's', name: 'n', trait: 't', carries: [], itemCarriers: [], tier: 'A',
    avg: 4, top4: 0.5, win: 0.1, pick: 0.01, games: 100, traitLevel: 4, avgLevel, units,
  };
}

test('Reroll: billigste 3-Sterne-Unit bestimmt die Stufe', () => {
  const p = levelPlan(comp([{ id: 'B', star3: true }, { id: 'A', star3: true }, { id: 'D' }]), lookups);
  assert.deepEqual(p, { kind: 'reroll', level: 5, targets: ['A'], avgLevel: 8 });
});

test('3 Sterne auf einer 4-Kosten-Unit ist kein Reroll', () => {
  assert.equal(levelPlan(comp([{ id: 'D', star3: true }], 8.2), lookups).kind, 'fast8');
});

test('fast9 ab Endstufe 8,5, fast8 auch ohne Endstufe', () => {
  assert.equal(levelPlan(comp([{ id: 'D' }], 8.5), lookups).kind, 'fast9');
  assert.equal(levelPlan(comp([{ id: 'D' }], null), lookups).kind, 'fast8');
});

test('Rezepte ohne Doppelte, Items ohne Rezept fallen weg', () => {
  const r = compRecipes(comp([{ id: 'A', items: ['Giant', 'Emblem'] }, { id: 'B', items: ['Giant'] }]), lookups);
  assert.deepEqual(r, [{ item: 'Giant', parts: ['Sword', 'Bow'] }]);
  assert.deepEqual(compRecipes(comp([{ id: 'A', items: ['Giant'] }]), null), []);
});

test('shopMatches markiert nur Plaetze mit Units der Comp', () => {
  assert.deepEqual(shopMatches(['A', null, 'X', 'D', 'A'], comp([{ id: 'A' }, { id: 'D' }])), [true, false, false, true, true]);
  assert.deepEqual(shopMatches([], null), [false, false, false, false, false]);
});

test('groupRecipes: Items, dann Spatula, dann Bratpfanne, je alphabetisch', () => {
  const lk: CompanionLookups = {
    ...lookups,
    items: {
      ...lookups.items,
      DA_Component_Spatula: { name: 'Spatula', icon: null, component: true },
      DA_Component_FryingPan: { name: 'Frying Pan', icon: null, component: true },
      Zeke: { name: "Zeke's Herald", icon: null, recipe: ['Sword', 'Bow'] },
      Cape: { name: "Tactician's Cape", icon: null, recipe: ['DA_Component_Spatula', 'DA_Component_FryingPan'] },
      EmbA: { name: 'Blossom Emblem', icon: null, recipe: ['DA_Component_Spatula', 'Sword'] },
      Shield: { name: "Tactician's Shield", icon: null, recipe: ['DA_Component_FryingPan', 'DA_Component_FryingPan'] },
      EmbB: { name: 'Brawler Emblem', icon: null, recipe: ['Bow', 'DA_Component_FryingPan'] },
    },
  };
  const g = groupRecipes(lk);
  assert.deepEqual(g.map(x => x.kind), ['items', 'spatula', 'pan']);
  assert.deepEqual(g[0].recipes.map(r => r.item), ['Giant', 'Zeke']);
  assert.deepEqual(g[1].recipes.map(r => r.item), ['EmbA', 'Cape']);
  assert.deepEqual(g[2].recipes.map(r => r.item), ['EmbB', 'Shield']);
  assert.deepEqual(groupRecipes(lookups).map(x => x.kind), ['items']);
  assert.deepEqual(groupRecipes(null), []);
});

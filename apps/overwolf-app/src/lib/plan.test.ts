import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp, CompanionCompDetail, CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { levelPlan, boardLevels, startLevel, shownLevels, compRecipes, shopMatches, groupRecipes, compLevelling, positioningView } from './plan.ts';

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

test('Reroll: Stufe und Ziele kommen vom Server', () => {
  const p = levelPlan({ ...comp([{ id: 'B', star3: true }, { id: 'A', star3: true }, { id: 'D' }]), reroll: { level: 7, targets: ['B'] } }, lookups);
  assert.deepEqual(p, { kind: 'reroll', level: 7, targets: ['B'], avgLevel: 8 });
});

test('3 Sterne ohne Reroll-Angabe ist kein Reroll', () => {
  assert.equal(levelPlan(comp([{ id: 'A', star3: true }], 8.2), lookups).kind, 'fast8');
});

test('boardLevels: immer 7/8/9, Reroll startet auf 7, sonst 8', () => {
  assert.deepEqual(boardLevels({ kind: 'reroll', level: 5, targets: ['A'], avgLevel: 8 }), { levels: [7, 8, 9], start: 7 });
  assert.deepEqual(boardLevels({ kind: 'reroll', level: 7, targets: ['A'], avgLevel: 8 }), { levels: [7, 8, 9], start: 7 });
  assert.deepEqual(boardLevels({ kind: 'fast9', avgLevel: 8.7 }), { levels: [7, 8, 9], start: 8 });
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

test('startLevel: erste Stufe ab Start mit Brett, sonst erste mit Brett, sonst Start', () => {
  const has = (set: number[]) => (l: number) => set.includes(l);
  assert.equal(startLevel([7, 8, 9], 7, has([7, 8, 9])), 7);
  assert.equal(startLevel([7, 8, 9], 7, has([8, 9])), 8);
  assert.equal(startLevel([7, 8, 9], 8, has([7, 8, 9])), 8);
  assert.equal(startLevel([7, 8, 9], 8, has([7])), 7);
  assert.equal(startLevel([7, 8, 9], 8, has([])), 8);
});

test('shownLevels: nur Stufen mit Brett, Reihenfolge bleibt', () => {
  const has = (set: number[]) => (l: number) => set.includes(l);
  assert.deepEqual(shownLevels([7, 8, 9], has([])), []);
  assert.deepEqual(shownLevels([7, 8, 9], has([9])), [9]);
  assert.deepEqual(shownLevels([7, 8, 9], has([7, 9])), [7, 9]);
  assert.deepEqual(shownLevels([4, 5, 6, 7], has([6, 4])), [4, 6]);
});

function detail(over: Partial<CompanionCompDetail> = {}): CompanionCompDetail {
  return {
    v: 1, slug: 's', board: [{ unit: 'A', cell: 0 }], boardSource: 'metatft',
    levels: [
      { level: 7, share: 0.3, avg: 4, top4: 0.4, win: 0.1, games: 300 },
      { level: 8, share: 0.5, avg: 4, top4: 0.5, win: 0.1, games: 500 },
    ],
    levelTiming: [], early: {}, ...over,
  };
}

test('compLevelling: MetaTFT-Plan aus dem Detail, sonst der eigene', () => {
  const c = { ...comp([{ id: 'A' }], 8.7), reroll: undefined };
  const plan = { kind: 'reroll' as const, level: 7 };
  const pos = { levels: [], boardsByPlayerLevel: {}, defaultLevel: null, levelling: 'lvl 7', plan, levelTiming: [] };
  assert.deepEqual(compLevelling(c, detail({ positioning: pos })), plan);
  // Ohne Anleitung (plan null), ohne Detail oder alter Stand: eigener Plan.
  assert.deepEqual(compLevelling(c, detail({ positioning: { ...pos, plan: null } })), { kind: 'fast', level: 9 });
  assert.deepEqual(compLevelling(c, null), { kind: 'fast', level: 9 });
  assert.deepEqual(compLevelling({ ...comp([{ id: 'A' }]), reroll: { level: 6, targets: ['A'] } }, detail()), { kind: 'reroll', level: 6 });
});

test('positioningView: Reiter und Startstufe der Homepage, Wahl bleibt, Rueckfall auf Gesamt-Aufstellung', () => {
  const b7 = [{ unit: 'B', cell: 7 }];
  const b9 = [{ unit: 'D', cell: 9 }];
  const d = detail({
    positioning: {
      levels: [{ level: 7, share: 0.3, games: 300, top4Rate: 0.4 }, { level: 9, share: 0.2, games: 200, top4Rate: 0.9 }],
      boardsByPlayerLevel: { 7: b7, 9: b9 }, defaultLevel: 9, levelling: null, plan: null, levelTiming: [],
    },
  });
  const c = comp([{ id: 'A' }]);
  const v = positioningView(c, d, 0);
  assert.deepEqual(v.levels, [7, 9]);
  assert.equal(v.level, 9);
  assert.deepEqual(v.board, b9);
  assert.equal(v.share(7), 0.3);
  assert.equal(positioningView(c, d, 7).level, 7);
  // Gewaehlte Stufe ohne Reiter → Startreiter.
  assert.equal(positioningView(c, d, 8).level, 9);
  // Keine Reiter: Gesamt-Aufstellung.
  const empty = positioningView(c, detail({ positioning: { ...d.positioning!, levels: [], boardsByPlayerLevel: {}, defaultLevel: null } }), 0);
  assert.equal(empty.level, null);
  assert.deepEqual(empty.board, d.board);
  assert.deepEqual(positioningView(c, null, 0).levels, []);
});

test('positioningView: alter Stand ohne positioning nutzt Stufen 7-9 des alten Felds, Start 8', () => {
  const d = detail({ boardsByPlayerLevel: { 5: [{ unit: 'A', cell: 1 }], 7: [{ unit: 'B', cell: 2 }], 8: [{ unit: 'D', cell: 3 }] } });
  const v = positioningView(comp([{ id: 'A' }]), d, 0);
  assert.deepEqual(v.levels, [7, 8]);
  assert.equal(v.level, 8);
  assert.equal(v.share(8), 0.5);
});

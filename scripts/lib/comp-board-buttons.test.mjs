import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compsToCheck, evaluateCompBoardButtons } from './comp-board-buttons.mjs';

const row = (compKey, slug, games, extra = {}) => ({ compKey, slug, games, ...extra });
const comp = (key, games) => ({ key, games: new Map(Object.entries(games)) });

test('compsToCheck: meistgespielte zuerst, ohne Teil-Comps, nur mit mehreren Zeilen', () => {
  const list = { comps: [
    row('A', 'a1', 100), row('A', 'a2', 300),
    row('B', 'b1', 900),
    row('C', 'c1', 500, { compParts: ['C', 'X'] }), row('C', 'c2', 500, { compParts: ['C', 'X'] }),
    row('D', 'd1', 600), row('D', 'd2', 10, { listFill: true }), row('D', 'd3', 100),
    row(null, 'n1', 999), row(null, 'n2', 999),
  ] };
  const out = compsToCheck(list);
  assert.deepEqual(out.map(c => [c.key, c.slug]), [['D', 'd1'], ['A', 'a2']]);
  assert.equal(compsToCheck(list, 1).length, 1);
});

test('gleiche Zahlen → ok', () => {
  const c = comp('L', { l1: 633, l3: 503, l4: 98, l2: 82 });
  const d = new Map([['L', { variants: [{ slug: 'l1', games: 1136, members: ['l1', 'l3'] }, { slug: 'l4', games: 180, members: ['l4', 'l2'] }] }]]);
  assert.equal(evaluateCompBoardButtons([c], d, { minChecked: 1 }).status, 'ok');
});

test('Negativfall: Knopf zaehlt anders als die Liste → broken mit Beispiel', () => {
  const c = comp('L', { l4: 98, l2: 82 });
  const d = new Map([['L', { variants: [{ slug: 'l4', games: 98, members: ['l4', 'l2'] }] }]]);
  const out = evaluateCompBoardButtons([c], d, { minChecked: 1 });
  assert.equal(out.status, 'broken');
  assert.match(out.detail, /Knopf 98, Liste 180/);
});

test('alter Vorrat ohne members → warn, nicht broken', () => {
  const c = comp('L', { l4: 98 });
  const d = new Map([['L', { variants: [{ slug: 'l4', games: 82 }] }]]);
  assert.equal(evaluateCompBoardButtons([c], d, { minChecked: 1 }).status, 'warn');
});

test('zu wenig pruefbare Comps → warn', () => {
  assert.equal(evaluateCompBoardButtons([comp('L', {})], new Map(), { minChecked: 1 }).status, 'warn');
});

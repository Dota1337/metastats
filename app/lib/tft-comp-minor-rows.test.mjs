import test from 'node:test';
import assert from 'node:assert/strict';
import { COMP_ROW_FLOOR, minorCompRow, planCompTotals, sumMinorRows } from './tft-comp-minor-rows.ts';
import { COMP_PRECOMPUTE_MIN_GAMES, DETAIL_MIN_GAMES } from './snapshot-matrix.ts';

const row = (cluster_key, games, avg = 4) => ({ cluster_key, games, sum_placement: avg * games, top4: games / 2, top1: games / 8 });
// Gruppe = Text vor dem '#', 'x' gehoert zu keiner Comp.
const groupOf = k => (k.startsWith('x') ? null : k.split('#')[0]);

test('Untergrenze je Zeile = Detailseite = vorgerechnete Liste', () => {
  assert.equal(COMP_ROW_FLOOR, DETAIL_MIN_GAMES);
  assert.equal(COMP_ROW_FLOOR, COMP_PRECOMPUTE_MIN_GAMES);
});

test('planCompTotals: Ashe-Fall — kleine Zeilen haengen an der groessten, unter der Untergrenze faellt weg', () => {
  const rows = [row('ashe#J3', 213, 3.67), row('ashe#J2', 160, 4.77), row('ashe#H2', 93), row('ashe#I4', 16)];
  const plan = planCompTotals(rows, groupOf, 161);
  assert.deepEqual(plan.fillKeys, []);
  assert.deepEqual([...plan.minorByAnchor.keys()], ['ashe#J3']);
  assert.deepEqual(plan.minorByAnchor.get('ashe#J3').map(r => r.cluster_key), ['ashe#J2', 'ashe#H2']);
});

test('planCompTotals: Summe ueber, jede Zeile unter der Schwelle → meistgespielte als volle Zeile', () => {
  const plan = planCompTotals([row('b#1', 90), row('b#2', 100), row('b#3', 40)], groupOf, 161);
  assert.deepEqual(plan.fillKeys, ['b#2']);
  assert.deepEqual(plan.minorByAnchor.get('b#2').map(r => r.cluster_key), ['b#1', 'b#3']);
});

test('planCompTotals: Comp unter der Schwelle und Zeilen ohne Comp fallen weg', () => {
  const plan = planCompTotals([row('c#1', 100), row('c#2', 50), row('x#1', 500)], groupOf, 161);
  assert.deepEqual(plan.fillKeys, []);
  assert.equal(plan.minorByAnchor.size, 0);
});

test('planCompTotals: mehrere grosse Zeilen — nur die kleinen sind Zusatz', () => {
  const plan = planCompTotals([row('d#1', 400), row('d#2', 200), row('d#3', 60)], groupOf, 161);
  assert.deepEqual(plan.minorByAnchor.get('d#1').map(r => r.cluster_key), ['d#3']);
});

test('planCompTotals: Schwelle auf der Untergrenze → keine kleinen Zeilen', () => {
  const plan = planCompTotals([row('e#1', 40), row('e#2', 30)], groupOf, 30);
  assert.deepEqual(plan.fillKeys, []);
  assert.equal(plan.minorByAnchor.size, 0);
});

test('minorCompRow + sumMinorRows: Raten je Zeile, jede Kennung einmal, volle Zeilen ausgelassen', () => {
  const a = minorCompRow(row('f#1', 100, 4.5), 1000);
  assert.equal(a.avgPlacement, 4.5);
  assert.equal(a.top4Rate, 0.5);
  assert.equal(a.pickRate, 0.1);
  const b = minorCompRow(row('f#2', 50, 3), 1000);
  const s = sumMinorRows([a, b, a, minorCompRow(row('f#3', 70), 1000)], new Set(['f#3']));
  assert.equal(s.games, 150);
  assert.equal(s.place, 450 + 150);
  assert.deepEqual(s.keys, ['f#1', 'f#2']);
});

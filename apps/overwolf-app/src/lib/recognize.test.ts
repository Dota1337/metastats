import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp } from '../../../../app/lib/companion-types.ts';
import { recognizeComp, opponentAhead } from './plan.ts';

function comp(key: string, ids: string[], vs?: CompanionComp['vs']): CompanionComp {
  return {
    key, slug: key, name: key, trait: 't', carries: [], itemCarriers: [], tier: 'A',
    avg: 4, top4: 0.5, win: 0.1, pick: 0.01, games: 100, traitLevel: 4, avgLevel: 8,
    units: ids.map(id => ({ id })), vs,
  };
}

const X = comp('x', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], { y: [120, 0.4] });
const Y = comp('y', ['A', 'B', 'H', 'I', 'J', 'K', 'L']);
const comps = [X, Y];

test('Erkennung: eindeutiger Treffer ab 5 Units', () => {
  assert.equal(recognizeComp(['A', 'B', 'C', 'D', 'E'], comps, '4-2')?.key, 'x');
});

test('Erkennung: ohne gesehenes Brett keine Comp', () => {
  assert.equal(recognizeComp([], comps, '4-2'), null);
});

test('Erkennung: zu wenig Units oder zu knapper Vorsprung -> nichts geraten', () => {
  assert.equal(recognizeComp(['A', 'B', 'C', 'D'], comps, '4-2'), null);
  // X hat 5, Y hat 4 Treffer: Vorsprung 1 reicht nicht.
  assert.equal(recognizeComp(['A', 'B', 'C', 'D', 'E', 'H', 'I'], comps, '4-2'), null);
});

test('Erkennung: vor Stage 3 wird nichts geraten', () => {
  assert.equal(recognizeComp(['A', 'B', 'C', 'D', 'E'], comps, '2-5'), null);
});

test('Matchup: Anteil, in dem der Gegner vorn landet', () => {
  assert.deepEqual(opponentAhead(X, Y), { share: 0.6, games: 120 });
  assert.equal(opponentAhead(Y, X), null);
  assert.equal(opponentAhead(X, X), null);
});

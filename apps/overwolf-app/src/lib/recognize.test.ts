import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CompanionComp } from '../../../../app/lib/companion-types.ts';
import type { OppBoard } from './boards.ts';
import { recognizeComp } from './plan.ts';

function comp(key: string, trait: string, ids: string[], carries: string[]): CompanionComp {
  return {
    key, slug: key, name: `${trait.toUpperCase()} · ${carries.join(' & ')}`, trait, carries, itemCarriers: [], tier: 'A',
    avg: 4, top4: 0.5, win: 0.1, pick: 0.01, games: 100, traitLevel: 4, avgLevel: 8,
    units: ids.map(id => ({ id })),
  };
}
function board(ids: string[], round = 42, stars: Record<string, number> = {}): OppBoard {
  return { units: ids.map(unit => ({ unit, level: stars[unit] ?? 1 })), round, stage: `${Math.floor(round / 10)}-${round % 10}` };
}

// X und X2 sind Geschwister (gleicher Trait), Y hat einen anderen Trait.
const X = comp('x', 'tx', ['A', 'B', 'C', 'D', 'E', 'F', 'G'], ['G']);
const X2 = comp('x2', 'tx', ['A', 'B', 'C', 'D', 'E', 'H', 'I'], ['I']);
const Y = comp('y', 'ty', ['A', 'B', 'C', 'J', 'K', 'L', 'M'], ['M']);

test('sicher: 2 Treffer Vorsprung und ein Carry der Comp steht auf dem Brett', () => {
  const r = recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 42, { G: 2 }), [X, Y]);
  assert.equal(r?.kind, 'sure');
  assert.equal(r?.kind === 'sure' && r.comp.key, 'x');
  assert.deepEqual(r?.carries, [{ unit: 'G', level: 2 }]);
});

test('ohne Carry auf dem Brett wird aus sicher nur wahrscheinlich (Trait ohne Carry)', () => {
  const r = recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'F']), [X, Y]);
  assert.deepEqual(r, { kind: 'likely', trait: 'tx', label: 'TX', carries: [] });
});

test('wahrscheinlich: Geschwister gleichauf, nur Carries auf dem Brett', () => {
  // X und X2 je 6 Treffer, Y 3. Carry I steht drauf, G nicht.
  const r = recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'I']), [X, X2, Y]);
  assert.deepEqual(r, { kind: 'likely', trait: 'tx', label: 'TX', carries: [{ unit: 'I', level: 1 }] });
});

test('verschiedene Traits gleichauf: nichts geraten', () => {
  // X 5 Treffer (A-E), Y 5 Treffer (A,B,C,J,K)
  assert.equal(recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'J', 'K']), [X, Y]), null);
  // ein Treffer Vorsprung bei anderem Trait reicht auch nicht
  assert.equal(recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'F', 'J', 'K']), [X, Y]), null);
});

test('zu wenig Units, leeres Brett oder vor Ende Stufe 2: nichts', () => {
  assert.equal(recognizeComp(board(['A', 'B', 'C', 'D']), [X, Y]), null);
  assert.equal(recognizeComp(null, [X, Y]), null);
  assert.equal(recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 24), [X, Y]), null);
  assert.equal(recognizeComp(board(['A', 'B', 'C', 'D', 'E', 'F', 'G'], 25), [X, Y])?.kind, 'sure');
});

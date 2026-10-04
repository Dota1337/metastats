import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordBoard, ownRounds, findLocalMatch, type Boards, type LocalMatch } from './boards.ts';

test('Eigene Runden: Feld roh 1..28 wird zu 0..27, Gegner und leere Felder fallen weg', () => {
  const b: Boards = new Map();
  recordBoard(b, 'own', 32, null, [{ cell: 1, unit: 'A', level: 2, items: ['Sword'] }, { cell: 0, unit: 'B', level: 1, items: [] }]);
  recordBoard(b, 'own', 21, null, [{ cell: 28, unit: 'C', level: 1, items: [] }]);
  recordBoard(b, 'opp', 32, 'Gegner', [{ cell: 5, unit: 'D', level: 1, items: [] }]);
  assert.deepEqual(ownRounds(b), [
    { round: 21, pieces: [{ cell: 27, unit: 'C', level: 1, items: [] }] },
    { round: 32, pieces: [{ cell: 0, unit: 'A', level: 2, items: ['Sword'] }] },
  ]);
});

function local(id: string, startedAt: number, matchId: string | null = null): LocalMatch {
  return { id, matchId, startedAt, endedAt: startedAt + 30 * 60_000, placement: 3, rounds: [] };
}

test('Spielverlauf: gleiche Kennung gewinnt, sonst naechster Spielbeginn im Zeitfenster', () => {
  const t0 = Date.UTC(2026, 9, 4, 18);
  const list = [local('a', t0, '7881'), local('b', t0 + 40 * 60_000)];
  assert.equal(findLocalMatch(list, { id: 'EUW1_7881', at: t0 + 99 * 60_000 })?.id, 'a');
  assert.equal(findLocalMatch(list, { id: 'EUW1_1', at: t0 + 75 * 60_000 })?.id, 'b');
  assert.equal(findLocalMatch(list, { id: 'EUW1_1', at: t0 + 200 * 60_000 }), null);
});

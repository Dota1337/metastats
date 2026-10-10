import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recordBoard, ownRounds, findLocalMatch, flattenBoards, liveMatchId, type Boards, type LocalMatch } from './boards.ts';

// Der Backfill liest die Startzeit mit genau diesem Muster; ein Name gehoert
// nicht mehr in die Kennung.
test('Behelfs-Kennung: Startzeit fuer den Backfill, sonst nur Zufall', () => {
  const src = readFileSync(new URL('../../../../scripts/backfill-companion-placements.mjs', import.meta.url), 'utf8');
  assert.ok(src.includes('/^LIVE_(\\d+)_/'), 'Muster im Backfill geaendert');
  const id = liveMatchId(1_760_000_040_000);
  assert.match(id, /^LIVE_1760000040000_[0-9a-f]{8}$/);
  assert.equal(Number(/^LIVE_(\d+)_/.exec(id)![1]), 1_760_000_040_000);
  assert.notEqual(liveMatchId(1), liveMatchId(1));
  assert.equal(liveMatchId(5, () => 0), 'LIVE_5_00000000');
});

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

test('Gegner-Brett: je Runde bleibt der groesste Stand, das eigene Brett der letzte', () => {
  const b: Boards = new Map();
  const p = (unit: string) => ({ cell: 1, unit, level: 1, items: [] as string[] });
  recordBoard(b, 'opp', 32, 'G', [p('A'), p('B'), p('C')]);
  recordBoard(b, 'opp', 32, 'G', [p('A')]);
  recordBoard(b, 'own', 32, null, [p('X'), p('Y')]);
  recordBoard(b, 'own', 32, null, [p('X')]);
  const all = flattenBoards(b);
  assert.equal(all.filter(o => o.kind === 'opp').length, 3);
  assert.equal(all.filter(o => o.kind === 'own').length, 1);
});


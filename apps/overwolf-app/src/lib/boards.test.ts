import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordBoard, ownRounds, findLocalMatch, toOppBoard, mergeOppBoard, sameOppBoard, flattenBoards, type Boards, type LocalMatch } from './boards.ts';

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

test('toOppBoard: jede Unit einmal mit hoechstem Stern, leere Felder fallen weg', () => {
  const ob = toOppBoard([
    { cell: 1, unit: 'B', level: 1, items: [] }, { cell: 2, unit: 'A', level: 2, items: [] },
    { cell: 3, unit: 'B', level: 3, items: [] }, { cell: 4, unit: '', level: 1, items: [] },
  ], 42, '4-2');
  assert.deepEqual(ob, { units: [{ unit: 'A', level: 2 }, { unit: 'B', level: 3 }], round: 42, stage: '4-2' });
});

test('mergeOppBoard: gleiche Runde vereinigt, spaete Teilbretter verdraengen nichts', () => {
  const u = (...ids: string[]) => ids.map(unit => ({ unit, level: 1 }));
  const r42 = { units: u('A', 'B', 'C', 'D'), round: 42, stage: '4-2' };
  // gleiche Runde, anderes Teilstueck → Vereinigung, Stern-Maximum
  const same = mergeOppBoard(r42, { units: [{ unit: 'A', level: 2 }, { unit: 'E', level: 1 }], round: 42, stage: '4-2' });
  assert.deepEqual(same.units.map(x => x.unit + x.level), ['A2', 'B1', 'C1', 'D1', 'E1']);
  // spaetere Runde mit weniger Units → altes Brett bleibt
  assert.equal(mergeOppBoard(r42, { units: u('A', 'B'), round: 51, stage: '5-1' }), r42);
  // spaetere Runde mit mindestens so vielen Units → neues Brett
  const later = { units: u('A', 'B', 'C', 'F'), round: 51, stage: '5-1' };
  assert.equal(mergeOppBoard(r42, later), later);
  // fruehere Runde und leeres Brett → ignoriert
  assert.equal(mergeOppBoard(r42, { units: u('Z', 'Y', 'X', 'W', 'V'), round: 33, stage: '3-3' }), r42);
  assert.equal(mergeOppBoard(r42, { units: [], round: 51, stage: '5-1' }), r42);
  // nichts gemerkt → neues Brett
  assert.equal(mergeOppBoard(undefined, later), later);
});

test('sameOppBoard vergleicht Units, Sterne, Runde und Stage', () => {
  const a = { units: [{ unit: 'A', level: 1 }], round: 42, stage: '4-2' };
  assert.equal(sameOppBoard(a, { ...a, units: [{ unit: 'A', level: 1 }] }), true);
  assert.equal(sameOppBoard(a, { ...a, units: [{ unit: 'A', level: 2 }] }), false);
  assert.equal(sameOppBoard(a, { ...a, round: 43 }), false);
  assert.equal(sameOppBoard(a, undefined), false);
  assert.equal(sameOppBoard(undefined, undefined), true);
});

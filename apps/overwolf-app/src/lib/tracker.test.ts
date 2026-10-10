import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RosterRow } from './store.ts';
import { trackRows, matchupCheck, predictionAllowed, lockCount, roundIndex, isMe, type TrackInput } from './tracker.ts';

const names = ['Me#EUW', 'A#EUW', 'B#EUW', 'C#EUW', 'D#EUW', 'E#EUW', 'F#EUW', 'G#EUW'];
const roster = (dead: string[] = []): RosterRow[] => names.map(name => ({ name, health: dead.includes(name) ? 0 : 50, rank: null }));
const base: TrackInput = { pvp: {}, roster: roster(), stage: null, roundKind: null, queueId: 1100, me: 'Me#EUW' };
const row = (rows: ReturnType<typeof trackRows>['rows'], n: string) => rows.find(r => r.name === n)!;

test('lockCount und Vorhersage-Grenzen', () => {
  assert.deepEqual([8, 7, 6, 5, 4, 3].map(lockCount), [4, 3, 2, 1, 0, 0]);
  assert.equal(predictionAllowed(1100, 8, 8), true);
  assert.equal(predictionAllowed(1160, 8, 8), false);   // Double Up
  assert.equal(predictionAllowed(1100, 8, 3), false);
  assert.equal(predictionAllowed(null, 8, 8), true);    // unbekannt + 8 Spieler = Standard
  assert.equal(predictionAllowed(null, 6, 6), false);
});

test('Ohne Kampf: alle „noch nicht“, ich selbst fehlt', () => {
  const { rows } = trackRows(base);
  assert.equal(rows.length, 7);
  assert.ok(rows.every(r => r.status === 'never'));
  assert.equal(rows.some(r => r.name === 'Me#EUW'), false);
});

test('8 Lebende: Gegner der letzten 4 Kampfrunden unwahrscheinlich, Rest „vor N Runden“', () => {
  const pvp = { '2-1': 'A#EUW', '2-2': 'B#EUW', '2-3': 'C#EUW', '2-5': 'D#EUW', '2-6': 'E#EUW' };
  const { rows, lock } = trackRows({ ...base, pvp, stage: '2-7', roundKind: 'pve' });
  assert.equal(lock, 4);
  assert.deepEqual(row(rows, 'E#EUW'), { name: 'E#EUW', status: 'unlikely', roundsAgo: 1, hp: 50, dead: false });
  assert.equal(row(rows, 'B#EUW').status, 'unlikely');
  assert.equal(row(rows, 'B#EUW').roundsAgo, 4);
  assert.equal(row(rows, 'A#EUW').status, 'ago');
  assert.equal(row(rows, 'A#EUW').roundsAgo, 5);
  assert.equal(row(rows, 'F#EUW').status, 'never');
});

test('Laufender Kampf: „dran“, Abstand zaehlt ab dem laufenden', () => {
  const pvp = { '3-1': 'A#EUW', '3-2': 'B#EUW', '3-3': 'C#EUW' };
  const { rows } = trackRows({ ...base, pvp, stage: '3-3', roundKind: 'pvp' });
  assert.equal(row(rows, 'C#EUW').status, 'now');
  assert.equal(row(rows, 'B#EUW').roundsAgo, 1);
  assert.equal(row(rows, 'A#EUW').roundsAgo, 2);
});

test('Weniger Lebende: kuerzere Sperre; Tote nie „unwahrscheinlich“', () => {
  const pvp = { '4-1': 'A#EUW', '4-2': 'B#EUW', '4-3': 'C#EUW' };
  const dead = ['E#EUW', 'F#EUW', 'G#EUW']; // 5 Lebende → 1 Runde gesperrt
  const { rows, lock } = trackRows({ ...base, pvp, roster: roster(dead), stage: '4-4', roundKind: 'carousel' });
  assert.equal(lock, 1);
  assert.equal(row(rows, 'C#EUW').status, 'unlikely');
  assert.equal(row(rows, 'B#EUW').status, 'ago');
  assert.equal(row(rows, 'E#EUW').dead, true);
});

test('Double Up und ≤3 Lebende: nur Fakten', () => {
  const pvp = { '2-1': 'A#EUW', '2-2': 'B#EUW' };
  const du = trackRows({ ...base, pvp, queueId: 1160, stage: '2-3', roundKind: 'pve' });
  assert.equal(du.predicted, false);
  assert.ok(du.rows.every(r => r.status !== 'unlikely'));
  const few = trackRows({ ...base, pvp, roster: roster(['C#EUW', 'D#EUW', 'E#EUW', 'F#EUW', 'G#EUW']), stage: '2-3', roundKind: 'pve' });
  assert.equal(few.predicted, false);
});

test('Ohne Spielerliste: Namen aus den Kaempfen', () => {
  const { rows } = trackRows({ ...base, roster: [], pvp: { '2-1': 'A#EUW' }, stage: '2-2', roundKind: 'pve' });
  assert.deepEqual(rows.map(r => r.name), ['A#EUW']);
  assert.equal(rows[0].status, 'ago');
});

test('isMe: mit und ohne Tag', () => {
  assert.equal(isMe('Me#EUW', 'me#euw'), true);
  assert.equal(isMe('Me', 'Me#EUW'), true);
  assert.equal(isMe('Me#NA1', 'Me#EUW'), false);
  assert.equal(isMe('A#EUW', null), false);
});

test('roundIndex: Stufe 1 hat 4 Runden, danach 7', () => {
  assert.equal(roundIndex('1-1'), 0);
  assert.equal(roundIndex('1-4'), 3);
  assert.equal(roundIndex('2-1'), 4);
  assert.equal(roundIndex('3-1'), 11);
  assert.equal(roundIndex('x'), null);
});

test('matchupCheck: beide Zaehlweisen', () => {
  const pvp = { '2-1': 'A#EUW', '2-2': 'B#EUW', '2-3': 'C#EUW', '2-5': 'D#EUW', '2-6': 'E#EUW', '3-1': 'B#EUW' };
  const c = matchupCheck(pvp, '3-1', 8)!;
  // Kampfrunden davor: 2-6, 2-5, 2-3, 2-2 → B gesperrt.
  assert.equal(c.hitPvpOnly, true);
  // Alle Runden: 3-1 ist Index 11; 4 Runden davor = 2-4..2-7 → B (2-2) nicht drin.
  assert.equal(c.hitAll, false);
  assert.equal(matchupCheck(pvp, '4-1', 8), null);
  assert.equal(matchupCheck(pvp, '3-1', 4)!.hitPvpOnly, false);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isRiftGame, isLaneRole, isNonStandardMode } from './lol-queue.ts';

test('isRiftGame: Kluft-Spiele ja, Sondermodi nein', () => {
  assert.equal(isRiftGame({ queueId: 420, gameMode: 'CLASSIC' }), true);
  assert.equal(isRiftGame({ queueId: 480, gameMode: 'SWIFTPLAY' }), true);
  // neue Queue-Nummern ohne Eintrag zaehlen ueber den Modus (gemessen: 3130, 710)
  assert.equal(isRiftGame({ queueId: 3130, gameMode: 'CLASSIC' }), true);
  assert.equal(isRiftGame({ queueId: 450, gameMode: 'ARAM' }), false);
  assert.equal(isRiftGame({ queueId: 1750, gameMode: 'CHERRY' }), false);
  assert.equal(isRiftGame({ queueId: 900, gameMode: 'URF' }), false);
});

test('isRiftGame: Bots, Tutorial und Remakes nein', () => {
  assert.equal(isRiftGame({ queueId: 850, gameMode: 'CLASSIC' }), false);
  assert.equal(isRiftGame({ queueId: 2000, gameMode: 'CLASSIC' }), false);
  assert.equal(isRiftGame({ queueId: 420, gameMode: 'CLASSIC', gameEndedInEarlySurrender: true }), false);
});

test('isRiftGame: ohne Modus entscheidet die Queue', () => {
  assert.equal(isRiftGame({ queueId: 420 }), true);
  assert.equal(isRiftGame({ queueId: 450 }), false);
  assert.equal(isRiftGame({}), false);
});

test('isLaneRole', () => {
  for (const r of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'mid']) assert.equal(isLaneRole(r), true, r);
  for (const r of ['Invalid', 'UNKNOWN', '', null, undefined]) assert.equal(isLaneRole(r), false, String(r));
});

test('isNonStandardMode erkennt Arena auch unter neuen Queue-Nummern', () => {
  assert.equal(isNonStandardMode({ queueId: 1750, gameMode: 'CHERRY' }), true);
});

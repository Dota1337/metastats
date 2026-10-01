import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCounters } from './lol-counters.mjs';

// Gegner mit g Spielen und w Siegen.
const c = (enemy, g, w) => ({ enemy, gamesAgainst: g, lossesAgainst: g - w });

test('kein Gegner in beiden Listen', () => {
  const r = pickCounters([c('1', 6, 4), c('2', 8, 3), c('3', 10, 6), c('4', 5, 2), c('5', 7, 4), c('6', 9, 4)], 0.5);
  const strong = new Set(r.strongAgainst.map(x => x.enemy));
  assert.ok(r.weakAgainst.every(x => !strong.has(x.enemy)));
});

test('5-0 Zufallstreffer steht hinter 21 von 28', () => {
  const r = pickCounters([c('zufall', 5, 5), c('echt', 28, 21)], 0.5);
  assert.deepEqual(r.strongAgainst.map(x => x.enemy), ['echt', 'zufall']);
});

test('unter 5 Spielen raus, genau auf Rollenquote in keiner Liste', () => {
  const r = pickCounters([c('wenig', 4, 0), c('neutral', 10, 5)], 0.5);
  assert.equal(r.strongAgainst.length + r.weakAgainst.length, 0);
});

test('Ausgabe behaelt das bisherige Format und echte Zahlen', () => {
  const r = pickCounters([c('9', 12, 3)], 0.52);
  assert.deepEqual(r.weakAgainst, [{ enemy: '9', gamesAgainst: 12, lossesAgainst: 9 }]);
});

test('doppelte Eintraege (Datei-Listen vereinigt) zaehlen einmal', () => {
  const r = pickCounters([c('7', 10, 2), c('7', 10, 2)], 0.5);
  assert.equal(r.weakAgainst.length, 1);
});

test('ungueltige Rollenquote -> leere Listen', () => {
  assert.deepEqual(pickCounters([c('1', 10, 9)], NaN), { strongAgainst: [], weakAgainst: [] });
});

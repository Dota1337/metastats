import test from 'node:test';
import assert from 'node:assert/strict';
import { statsForTiers } from './champion-tier-stats.ts';

const s = (games, wins = 0) => ({ wins, games, kills: 0, deaths: 0, assists: 0, bans: 0 });
const file = {
  totalParticipantGames: 60,
  stats: { 1: s(9, 4) },
  perTier: { CHALLENGER: { matches: 1 }, GRANDMASTER: { matches: 2 }, MASTER: { matches: 3 } },
  statsByTier: { CHALLENGER: { 1: s(2, 1) }, GRANDMASTER: { 1: s(3, 1) }, MASTER: { 1: s(4, 2) } },
};
// Wochendatei: zehn Teilnehmer je Spiel, Ban-Nenner = Spiele.
const pick = (stats, totalGames) => ({ stats, totalGames, banMatches: totalGames / 10, kdaOk: true });

test('Einzelrang und Gruppe summieren nur ihre Raenge', () => {
  assert.deepEqual(statsForTiers(file, ['CHALLENGER']), pick({ 1: s(2, 1) }, 10));
  assert.deepEqual(statsForTiers(file, ['GRANDMASTER', 'CHALLENGER']), pick({ 1: s(5, 2) }, 30));
});

test('alle Raenge = Gesamtsumme', () => {
  assert.deepEqual(statsForTiers(file, null), pick(file.stats, 60));
});

test('alte Datei ohne Einzelraenge: nur Master+ bekommt Zahlen', () => {
  const old = { ...file, statsByTier: undefined };
  assert.deepEqual(statsForTiers(old, ['MASTER', 'GRANDMASTER', 'CHALLENGER']), pick(file.stats, 60));
  assert.equal(statsForTiers(old, ['CHALLENGER']), null);
  assert.equal(statsForTiers(old, ['DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER']), null);
});

test('Rang, der nicht gesammelt wurde, liefert nichts', () => {
  assert.equal(statsForTiers(file, ['DIAMOND']), null);
  assert.equal(statsForTiers(null, null), null);
});

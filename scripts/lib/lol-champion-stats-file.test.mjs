import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addMatchBans, addParticipant, buildChampionStatsFile, createPatchStats, describeChampionStatsFile,
} from './lol-champion-stats-file.mjs';
import { boxStatsForTiers, isValidLolChampionStats } from '../../app/lib/lol-champion-stats-blob.mjs';

const NOW = Date.parse('2026-11-08T18:00:00Z');
const row = (o) => ({
  champion_id: 1, team_position: 'MIDDLE', seed_tier: 'MASTER', win: false, match_id: 'M1',
  kills: null, deaths: null, assists: null, game_creation: new Date('2026-11-08T10:00:00Z'), ...o,
});

// Ein Match = 9 gezaehlte Teilnehmer mit Champions base..base+8 (100+ Champions fuer die Pruefregel).
function fillMatch(acc, matchId, tier, base, extra = {}) {
  for (let i = 0; i < 9; i++) {
    addParticipant(acc, row({ match_id: matchId, seed_tier: tier, champion_id: base + i, win: i < 4, ...extra }));
  }
}

test('Teilnehmer, Matches, Siege und Rollen werden je Rang gezaehlt', () => {
  const acc = createPatchStats('16.22');
  addParticipant(acc, row({ match_id: 'A', win: true }));
  addParticipant(acc, row({ match_id: 'A', champion_id: 2, team_position: 'TOP' }));
  addParticipant(acc, row({ match_id: 'B', team_position: 'TOP' }));
  addParticipant(acc, row({ match_id: 'C', seed_tier: 'EMERALD' }));
  const f = buildChampionStatsFile({ builtAt: new Date(NOW).toISOString(), matchesAnalyzed: 3, patches: [acc] });
  const m = f.patches[0].tiers.MASTER;
  assert.equal(m.matches, 2);
  assert.equal(m.participants, 3);
  assert.deepEqual(m.champions['1'], { games: 2, wins: 1, kills: 0, deaths: 0, assists: 0, bans: 0 });
  assert.equal(f.patches[0].tiers.EMERALD.matches, 1);
  assert.deepEqual(f.roles['1'], { MIDDLE: 2, TOP: 1 });
  assert.equal(f.dataNewest, '2026-11-08T10:00:00.000Z');
});

test('K/D/A nur aus Zeilen mit allen drei Werten', () => {
  const acc = createPatchStats('16.22');
  addParticipant(acc, row({ kills: 5, deaths: 2, assists: 7 }));
  addParticipant(acc, row({ match_id: 'M2', kills: 3, deaths: null, assists: 1 }));
  addParticipant(acc, row({ match_id: 'M3' }));
  const c = buildChampionStatsFile({ builtAt: 'x', matchesAnalyzed: 1, patches: [acc] }).patches[0].tiers.MASTER.champions['1'];
  assert.deepEqual(c, { games: 3, wins: 0, kills: 5, deaths: 2, assists: 7, bans: 0 });
});

test('Bans: nur gezaehlte Matches, je Match einmal, ungueltige Kennungen fallen raus', () => {
  const acc = createPatchStats('16.22');
  addParticipant(acc, row({ match_id: 'A' }));
  assert.equal(addMatchBans(acc, 'A', [7, 7, 9, -1, 0]), true);
  assert.equal(addMatchBans(acc, 'NICHT_GEZAEHLT', [7]), false);
  assert.equal(addMatchBans(acc, 'A2', null), false);
  const t = buildChampionStatsFile({ builtAt: 'x', matchesAnalyzed: 1, patches: [acc] }).patches[0].tiers.MASTER;
  assert.equal(t.banMatches, 1);
  assert.equal(t.champions['7'].bans, 1);
  assert.equal(t.champions['9'].bans, 1);
  assert.equal(t.champions['7'].games, 0);
  assert.equal(t.champions['-1'], undefined);
});

test('fertige Datei besteht die Pruefregel, neuester Patch zuerst, Rang ausserhalb der Stichprobe faellt raus', () => {
  const older = createPatchStats('16.21');
  const newer = createPatchStats('16.22');
  for (let m = 0; m < 12; m++) fillMatch(older, `O${m}`, 'DIAMOND', m * 9);
  fillMatch(newer, 'N1', 'MASTER', 0, { kills: 1, deaths: 1, assists: 1 });
  addParticipant(newer, row({ match_id: 'X', seed_tier: 'IRON' }));
  const f = buildChampionStatsFile({ builtAt: new Date(NOW).toISOString(), matchesAnalyzed: 13, patches: [older, newer] });
  assert.deepEqual(f.patches.map((p) => p.patch), ['16.22', '16.21']);
  assert.equal(f.patches[0].tiers.IRON, undefined);
  assert.equal(isValidLolChampionStats(f, NOW), true);
  assert.match(describeChampionStatsFile(f), /^16\.22: 1 Matches, 0 mit Bans\/KDA · 16\.21: 12 Matches/);
  // Fenster: 16.22 hat zu wenig Matches → beide Patches; Teilnehmer = 9 je Match.
  const v = boxStatsForTiers(f, null);
  assert.deepEqual(v.patches, ['16.22', '16.21']);
  assert.equal(v.totalGames, 13 * 9);
});

test('ohne gezaehlte Zeile kein Datum → Pruefregel lehnt ab', () => {
  const f = buildChampionStatsFile({ builtAt: new Date(NOW).toISOString(), matchesAnalyzed: 1, patches: [createPatchStats('16.22')] });
  assert.equal(f.dataNewest, null);
  assert.equal(isValidLolChampionStats(f, NOW), false);
});

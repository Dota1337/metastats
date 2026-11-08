import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boxListReady, boxStatsForTiers, isValidLolChampionStats, LOL_CHAMPION_STATS_MAX_AGE_MS,
  MIN_BAN_MATCHES, NEWEST_PATCH_MIN_MATCHES,
} from './lol-champion-stats-blob.mjs';

const NOW = Date.parse('2026-11-08T18:00:00Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
const champ = (games, wins = 0, o = {}) => ({ games, wins, kills: 0, deaths: 0, assists: 0, bans: 0, ...o });
const tier = (matches, champions = { 1: champ(9 * matches, 4 * matches) }, banMatches = 0) => ({
  matches, participants: 9 * matches, banMatches, champions,
});
const roles = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [String(i + 1), { MIDDLE: 3 }]));

function file(o = {}) {
  return {
    version: 1, source: 'box', region: 'euw1', builtAt: iso(60_000), dataNewest: iso(3_600_000),
    matchesAnalyzed: 300_000,
    patches: [
      { patch: '16.22', tiers: { MASTER: tier(9_000), EMERALD: tier(7_000) } },
      { patch: '16.21', tiers: { MASTER: tier(60_000), CHALLENGER: tier(2_000) } },
    ],
    roles,
    ...o,
  };
}

test('gueltige Datei', () => {
  assert.equal(isValidLolChampionStats(file(), NOW), true);
});

test('Pruefregel: alt, Zukunft, falsche Region/Quelle, Patch-Reihenfolge, kaputte Zahlen, zu wenige Champions', () => {
  const old = iso(LOL_CHAMPION_STATS_MAX_AGE_MS + 1);
  assert.equal(isValidLolChampionStats(file({ builtAt: old }), NOW), false);
  assert.equal(isValidLolChampionStats(file({ dataNewest: old }), NOW), false);
  assert.equal(isValidLolChampionStats(file({ builtAt: iso(-10 * 60_000) }), NOW), false);
  assert.equal(isValidLolChampionStats(file({ region: 'kr' }), NOW), false);
  assert.equal(isValidLolChampionStats(file({ source: 'json' }), NOW), false);
  assert.equal(isValidLolChampionStats(file({ matchesAnalyzed: 0 }), NOW), false);
  const f = file();
  assert.equal(isValidLolChampionStats({ ...f, patches: [f.patches[1], f.patches[0]] }, NOW), false);
  assert.equal(isValidLolChampionStats({ ...f, patches: [{ patch: '16.22', tiers: { IRON: tier(1) } }] }, NOW), false);
  assert.equal(isValidLolChampionStats({ ...f, patches: [{ patch: '16.22', tiers: { MASTER: tier(1, { 1: champ(1, 2) }) } }] }, NOW), false);
  assert.equal(isValidLolChampionStats({ ...f, patches: [{ patch: 'x', tiers: {} }] }, NOW), false);
  assert.equal(isValidLolChampionStats(file({ roles: { 1: { MIDDLE: 1 } } }), NOW), false);
  assert.equal(isValidLolChampionStats(null, NOW), false);
});

test('Fenster: neuester Patch allein ab der Schwelle, sonst beide', () => {
  // Alle Raenge: 16.22 = 16.000 >= 15.000 → nur 16.22.
  assert.ok(9_000 + 7_000 >= NEWEST_PATCH_MIN_MATCHES);
  const all = boxStatsForTiers(file(), null);
  assert.deepEqual(all.patches, ['16.22']);
  assert.equal(all.totalGames, 9 * 16_000);
  assert.equal(all.matches, 16_000);
  // Master+: 16.22 = 9.000 → beide Patches, Challenger aus 16.21 kommt dazu.
  const mplus = boxStatsForTiers(file(), ['MASTER', 'GRANDMASTER', 'CHALLENGER']);
  assert.deepEqual(mplus.patches, ['16.22', '16.21']);
  assert.equal(mplus.matches, 9_000 + 60_000 + 2_000);
  assert.equal(mplus.stats['1'].games, 9 * 71_000);
});

test('Pickraten-Nenner = Teilnehmer: Summe der Pickraten ist 1000 %', () => {
  const f = file({ patches: [{ patch: '16.22', tiers: { MASTER: tier(20_000, { 1: champ(100_000), 2: champ(80_000) }) } }] });
  const v = boxStatsForTiers(f, null);
  const sumPercent = Object.values(v.stats).reduce((s, c) => s + c.games * 10 / v.totalGames * 100, 0);
  assert.equal(Math.round(sumPercent), 1000);
});

test('Bannrate/KDA erst ab MIN_BAN_MATCHES, Liste erst dann bereit', () => {
  const few = file({ patches: [{ patch: '16.22', tiers: { MASTER: tier(16_000, undefined, MIN_BAN_MATCHES - 1) } }] });
  assert.equal(boxStatsForTiers(few, null).banMatches, null);
  assert.equal(boxStatsForTiers(few, null).kdaOk, false);
  assert.equal(boxListReady(few), false);
  const enough = file({ patches: [{ patch: '16.22', tiers: { MASTER: tier(16_000, undefined, MIN_BAN_MATCHES) } }] });
  assert.equal(boxStatsForTiers(enough, null).banMatches, MIN_BAN_MATCHES);
  assert.equal(boxStatsForTiers(enough, null).kdaOk, true);
  assert.equal(boxListReady(enough), true);
});

test('unbekannter Rang oder leere Auswahl liefert nichts, Rang ohne Matches ebenfalls', () => {
  assert.equal(boxStatsForTiers(file(), ['IRON']), null);
  assert.equal(boxStatsForTiers(file(), ['GRANDMASTER']), null);
  assert.equal(boxStatsForTiers(file(), []), null);
  assert.equal(boxStatsForTiers(null, null), null);
});

test('tiers: gezaehlte Raenge mit Matches im Fenster, aufsteigend', () => {
  // Alle: Fenster nur 16.22 → Emerald + Master (Challenger liegt nur in 16.21).
  assert.deepEqual(boxStatsForTiers(file(), null).tiers, ['EMERALD', 'MASTER']);
  // Master+: beide Patches → Master + Challenger, Grandmaster fehlt.
  assert.deepEqual(boxStatsForTiers(file(), ['CHALLENGER', 'MASTER', 'GRANDMASTER']).tiers, ['MASTER', 'CHALLENGER']);
  // Emerald leer → niedrigster gezaehlter Rang ist Master (Knopf heisst dann nicht „Emerald+").
  const noEmerald = file({ patches: [{ patch: '16.22', tiers: { EMERALD: tier(0, {}), MASTER: tier(16_000) } }] });
  assert.deepEqual(boxStatsForTiers(noEmerald, null).tiers, ['MASTER']);
});

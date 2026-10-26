import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerScoring } from './tft-player-scoring-endpoint.mjs';
import { buildPopulation, loadScoringContext, rngOf } from './tft-player-scoring.mjs';
import { loadCurrentSet } from './current-set.mjs';

const SET = loadCurrentSet();
const ctx = loadScoringContext(SET);
const PATCH = ctx.patchOrder[ctx.patchOrder.length - 1];
const PUUID = 'p'.repeat(78);

// Bezugswerte aus erfundenen Merkmalen — genug fuer Zeile „alle, ganzes Set".
function population() {
  const rng = rngOf(9);
  const players = Array.from({ length: 210 }, (_, p) => ({
    puuid: `R${p}`,
    region: 'euw1',
    entries: Array.from({ length: 30 }, (_, k) => ({
      f: {
        matchId: `M${p}_${k}`, region: 'euw1', gameMs: 1_790_000_000_000 - k * 3_600_000, patch: PATCH,
        P: 1 + Math.floor(rng() * 8), level: 8, lr: 30, gold: 2, dmg: 0, elims: 0,
        carry: 'C', family: 'F', arch: 'f', bsi: 50 + rng() * 40, te: rng(), pairs: [], itemUnits: [],
      },
      lobby: null,
    })),
  }));
  return buildPopulation(players, [], ctx).map((r) => ({ ...r, computed_at: new Date('2026-10-26T05:20:00Z') }));
}
const POP = population();

function cacheRow(i) {
  return {
    match_id: `EUW1_${i}`, region: 'euw1', game_datetime: 1_790_000_000_000 - i * 3_600_000,
    placement: 1 + (i % 8), level: 8, last_round: 30, gold_left: 3, total_damage: 0, players_eliminated: 0,
    units: [], traits: [],
  };
}

function fakes({ account = { gameName: 'A', tagLine: 'B' }, games = 30, pop = POP, refreshMs = 0 } = {}) {
  const calls = { account: 0, refresh: 0, queries: [] };
  const pool = {
    async query(sql) {
      calls.queries.push(sql.trim().split(/\s+/).slice(0, 4).join(' '));
      if (sql.includes('tft_player_scoring_population')) return { rows: pop };
      if (sql.includes('tft_player_match_cache')) return { rows: Array.from({ length: games }, (_, i) => cacheRow(i)) };
      if (sql.includes('tft_match_lobby')) return { rows: [] };
      throw new Error(`unerwartet: ${sql}`);
    },
  };
  const riot = { async fetchJson() { calls.account++; return account; } };
  const svc = createPlayerScoring({
    pool, riot,
    regionalOf: (r) => (r === 'euw1' ? 'europe' : undefined),
    accountRoutingOf: () => 'europe',
    refreshCache: async () => { calls.refresh++; if (refreshMs) await new Promise((r) => setTimeout(r, refreshMs)); },
    budgetMs: 50,
  });
  return { svc, calls };
}

test('Bewertung: verfuegbar, Spiele gezaehlt, Zwischenspeicher fuer den zweiten Aufruf', async () => {
  const { svc, calls } = fakes();
  const r = await svc.handle({ puuid: PUUID, region: 'euw1' });
  assert.equal(r.available, true);
  assert.equal(r.games, 30);
  assert.equal(r.refreshing, false);
  assert.equal(r.populationAt, '2026-10-26T05:20:00.000Z');
  assert.ok(Array.isArray(r.metrics) && r.metrics.length > 0);
  await svc.handle({ puuid: PUUID, region: 'euw1' });
  assert.equal(calls.account, 1, 'zweiter Aufruf aus dem Zwischenspeicher');
});

test('Gleichzeitige Aufrufe teilen sich eine Rechnung', async () => {
  const { svc, calls } = fakes({ refreshMs: 20 });
  const [a, b] = await Promise.all([svc.handle({ puuid: PUUID, region: 'euw1' }), svc.handle({ puuid: PUUID, region: 'euw1' })]);
  assert.equal(a, b);
  assert.equal(calls.account, 1);
  assert.equal(calls.refresh, 1);
});

test('Langer Abruf: nach dem Zeitbudget mit vorhandenem Stand rechnen', async () => {
  const { svc } = fakes({ refreshMs: 300 });
  const r = await svc.handle({ puuid: PUUID, region: 'euw1' });
  assert.equal(r.refreshing, true);
  assert.equal(r.available, true);
});

test('Unbekannter Spieler 404, kein Cache-Abruf', async () => {
  const { svc, calls } = fakes({ account: { _status: 404 } });
  await assert.rejects(svc.handle({ puuid: PUUID, region: 'euw1' }), (e) => e.status === 404);
  assert.equal(calls.refresh, 0);
  assert.ok(!calls.queries.some((q) => q.includes('tft_player_match_cache')), 'keine Spiele gelesen');
});

test('Riot weg: aus dem Cache rechnen; ohne Spiele 503', async () => {
  const a = fakes({ account: { _status: 503 } });
  const r = await a.svc.handle({ puuid: PUUID, region: 'euw1' });
  assert.equal(r.available, true);
  assert.equal(a.calls.refresh, 0);
  const b = fakes({ account: null, games: 0 });
  await assert.rejects(b.svc.handle({ puuid: PUUID, region: 'euw1' }), (e) => e.status === 503);
});

test('Falsche Eingaben 400, keine Bezugswerte → nicht verfuegbar', async () => {
  const { svc, calls } = fakes({ pop: [] });
  await assert.rejects(svc.handle({ puuid: 'x', region: 'euw1' }), (e) => e.status === 400);
  await assert.rejects(svc.handle({ puuid: PUUID, region: 'mars' }), (e) => e.status === 400);
  await assert.rejects(svc.handle(null), (e) => e.status === 400);
  const r = await svc.handle({ puuid: PUUID, region: 'euw1' });
  assert.deepEqual([r.available, r.reason], [false, 'no_population']);
  assert.deepEqual([calls.account, calls.refresh], [0, 0], 'ohne Bezugswerte kein Riot-Abruf');
});

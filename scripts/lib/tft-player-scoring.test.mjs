import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  quantiles, percentileOf, contextFrom, gameFeatures, expectedPlacement, fitLobbyModel,
  rawMetrics, prepareGames, populationLookup, buildPopulation, scorePlayer, gameFromLobby,
  lobbyEntry, METRICS, LOBBY_MIN, UNKNOWN_E, K, rngOf,
} from './tft-player-scoring.mjs';

const META = JSON.parse(readFileSync('public/tft-set.json', 'utf8'));
const SET = META.setNumber;

// Kleines Bundle mit bekannten Kosten und Trait-Stufen (Stile wie Set 18: 1,3,5,6).
const BUNDLE = {
  champions: { U1: { cost: 1 }, U4: { cost: 4 }, SUMMON: { cost: 8 } },
  traits: {
    Multi: { tiers: [{ minUnits: 2, style: 1 }, { minUnits: 4, style: 3 }, { minUnits: 6, style: 5 }, { minUnits: 8, style: 6 }] },
    Solo: { tiers: [{ minUnits: 1, style: 4 }] },
  },
};
const ctx = contextFrom(BUNDLE, META, SET);
const PATCHES = ctx.patchOrder;
const P_NOW = PATCHES[PATCHES.length - 1];
const P_PREV = PATCHES[PATCHES.length - 2];

test('Mittelrang bei Gleichstand, Interpolation dazwischen', () => {
  const d = quantiles([...Array(30).fill(0), ...Array.from({ length: 70 }, (_, i) => i + 1)]);
  assert.ok(Math.abs(percentileOf(d, 0) - 0.15) < 0.01, String(percentileOf(d, 0)));
  assert.equal(percentileOf(d, -1), 0);
  assert.equal(percentileOf(d, 1000), 1);
  const u = quantiles(Array.from({ length: 1001 }, (_, i) => i / 1000));
  assert.ok(Math.abs(percentileOf(u, 0.25) - 0.25) < 0.01);
  assert.equal(percentileOf(u, NaN), null);
  assert.equal(quantiles([]), null);
});

test('Kontext: Stufen-Rang aus dem Bundle, Einzel-Traits zaehlen nicht', () => {
  assert.deepEqual(ctx.traitRank.get('Multi'), [1, 2, 3, 4]);
  assert.equal(ctx.traitRank.has('Solo'), false);
  assert.equal(ctx.cost.get('U4'), 4);
});

test('Merkmale: Brettstaerke, Trait-Punkte, Thief\'s Gloves, unbekannte Units', () => {
  const g = {
    matchId: 'EUW1_1', region: 'euw1', gameMs: Date.UTC(2026, 9, 20, 12), placement: 3, level: 8, lastRound: 30,
    goldLeft: 2, damage: 0, elims: 0,
    units: [
      { id: 'U4', star: 2, items: ['DA_Item_A', 'DA_Item_B', 'DA_Component_Sword'] },
      { id: 'U1', star: 3, items: ['TFT_Item_ThiefsGloves', 'DA_Item_C'] },
      { id: 'SUMMON', star: 1, items: ['DA_Item_D'] },
    ],
    traits: [{ name: 'Multi', tier: 2, num: 4, style: 2 }, { name: 'Solo', tier: 1, num: 1, style: 3 }],
  };
  const f = gameFeatures(g, ctx);
  // U4: 4·3 = 12, U1: 1·9 = 9, Items: 2 fertige + 1 Handschuh = 3 → 2·3 = 6
  assert.equal(f.bsi, 12 + 9 + 6);
  assert.equal(f.te, 2 / 8);
  assert.deepEqual(f.pairs.sort(), ['U4|DA_Item_A', 'U4|DA_Item_B']);
  assert.deepEqual(f.itemUnits, ['U4']);
  assert.equal(typeof f.patch, 'string');
});

test('Erwarteter Platz: gleiche Raenge 4,5, viel staerker nahe 1, zu wenig Raenge null', () => {
  assert.equal(expectedPlacement([100, 100, 100, 100, 100, 100, 100, 100], 0, 0.01), 4.5);
  const strong = expectedPlacement([5000, 100, 100, 100, 100, 100, 100, 100], 0, 0.01);
  assert.ok(strong < 1.01, String(strong));
  assert.equal(expectedPlacement([100, 100, 100, 100, 100, null, null, null], 0, 0.01), null);
  assert.equal(expectedPlacement([null, 100, 100, 100, 100, 100, 100, 100], 0, 0.01), null);
  assert.equal(expectedPlacement([100, 100, 100, 100, 100, 100, 100, 100], 0, null), null);
});

// Lobbys, in denen hoehere Leiterpunkte mit wahrem β vorne landen.
function synthLobbies(n, beta, seed = 7) {
  const rng = rngOf(seed);
  const out = [];
  for (let k = 0; k < n; k++) {
    const lpts = Array.from({ length: 8 }, () => Math.round(2400 + rng() * 1200));
    const score = lpts.map((l) => beta * l + Math.log(rng() / (1 - rng())));
    const order = score.map((s, i) => [s, i]).sort((a, b) => b[0] - a[0]).map(([, i]) => i);
    const placements = new Array(8);
    order.forEach((i, r) => { placements[i] = r + 1; });
    out.push({ region: 'euw1', patch: P_NOW, lpts, placements, carries: lpts.map((_, i) => (i < 2 ? 'C1' : `X${i}`)) });
  }
  return out;
}

test('Lobby-Modell: β positiv, erst ab 1.000 Lobbys, Stufen voll besetzt', () => {
  assert.equal(fitLobbyModel(synthLobbies(LOBBY_MIN - 1, 0.004)), null);
  const m = fitLobbyModel(synthLobbies(1500, 0.004));
  assert.ok(m && m.beta > 0, JSON.stringify(m && { beta: m.beta, se: m.se }));
  assert.ok(m.buckets.length >= 2 && m.buckets.every((b) => b.n >= 500));
  assert.ok(m.buckets.every((b, i) => i === 0 || b.lo >= m.buckets[i - 1].hi - 1e-9));
});

function fakeF(i, { P, patch = P_NOW, region = 'euw1', gameMs, family = `F${i % 6}` } = {}) {
  return {
    matchId: `M${i}`, region, gameMs: gameMs ?? 1_790_000_000_000 - i * 3_600_000, patch,
    P, level: 7 + (i % 3), lr: 28 + (i % 6), gold: i % 7, dmg: 0, elims: 0,
    carry: `C${i % 4}`, family, arch: i % 5 === 0 ? 'r' : 'f',
    bsi: 40 + ((i * 37) % 60) - P * 3, te: 0.5 + ((i * 13) % 50) / 100 - P / 40,
    pairs: [`U${i % 5}|I${i % 4}`], itemUnits: [`U${i % 5}`],
  };
}

function synthPlayers(nPlayers, gamesEach, seed = 3) {
  const rng = rngOf(seed);
  const players = [];
  for (let p = 0; p < nPlayers; p++) {
    const skill = rng();
    const entries = [];
    for (let k = 0; k < gamesEach; k++) {
      const i = p * 1000 + k;
      const P = Math.min(8, Math.max(1, Math.round(1 + 7 * (rng() * 0.7 + (1 - skill) * 0.3))));
      entries.push({ f: fakeF(i, { P, patch: k < gamesEach / 2 ? P_NOW : P_PREV, gameMs: 1_790_000_000_000 - k * 3_600_000 }), lobby: null });
    }
    players.push({ puuid: `PU${p}`, region: 'euw1', entries });
  }
  return players;
}

// Paar-Bezugswerte brauchen 300 Beobachtungen: so viele Spiele hat die Stichprobe.
const REF = synthPlayers(220, 80);
const ROWS = buildPopulation(REF, [], ctx);

test('Bezugswerte: Zeilen fuer Set und Patch, Spielerverteilungen nur in Set-Zeilen', () => {
  const keys = ROWS.map((r) => `${r.region}|${r.patch}`).sort();
  assert.ok(keys.includes('all|*') && keys.includes('euw1|*'), keys.join(','));
  const all = ROWS.find((r) => r.region === 'all' && r.patch === '*');
  assert.ok(all.dists.players['1.1'].n >= 200);
  assert.equal(all.dists.lobby, null);
  assert.equal(all.dists.dmg, null, 'Schaden ueberall 0 → nicht geliefert');
  assert.ok(Object.keys(all.dists.delta).length > 0);
  assert.ok(ROWS.filter((r) => r.patch !== '*').every((r) => !r.dists.players));
  // zu wenige Spieler → keine Zeile
  assert.equal(buildPopulation(synthPlayers(50, 80), [], ctx).length, 0);
});

test('Dokument-Beispiel 1.1: 20 Siege → geschrumpft 2,75', () => {
  const pop = populationLookup(ROWS, 'euw1', ctx);
  const entries = Array.from({ length: 20 }, (_, i) => ({ f: fakeF(i, { P: 1 }), lobby: null }));
  const { games } = prepareGames(entries, pop, ctx);
  const { v } = rawMetrics(games, new Map());
  assert.equal(v['1.1'], -((20 + K * UNKNOWN_E) / (20 + K)));
  assert.equal(v['1.2'], null, 'ohne bekannte Lobby kein 1.2');
});

test('Dokument-Beispiel 5.1: 10 Punkte weniger Bot 2 als erwartet', () => {
  // 1.000 Spiele, Erwartung 25 %, beobachtet 15 % → ΔB ≈ −0,1 → Vorlage: 50 − 250·ΔB = 75
  const games = Array.from({ length: 1000 }, (_, i) => ({ P: i % 100 < 15 ? 8 : 3, b7: 0.25, c1: 0.25, known: false, R: 0, f: {} }));
  const { v } = rawMetrics(games, new Map());
  const dB = -v['5.1'];
  assert.ok(Math.abs(50 - 250 * dB - 75) < 0.6, String(50 - 250 * dB));
});

test('Spieler: Werte 0–100, Bereich, gleiches Ergebnis bei gleichem Startwert', () => {
  const pop = populationLookup(ROWS, 'euw1', ctx);
  const entries = REF[0].entries;
  const t0 = performance.now();
  const a = scorePlayer(entries, pop, ctx, { puuid: 'PU0' });
  const ms = performance.now() - t0;
  const b = scorePlayer(entries, pop, ctx, { puuid: 'PU0' });
  assert.deepEqual(a, b);
  assert.ok(ms < 1500, `${ms} ms`);
  assert.equal(a.metrics.length, METRICS.length);
  const m11 = a.metrics.find((m) => m.id === '1.1');
  assert.ok(m11.value >= 0 && m11.value <= 100);
  assert.equal(m11.reps.length, 200);
  assert.ok(m11.lo <= m11.value && m11.value <= m11.hi, JSON.stringify([m11.lo, m11.value, m11.hi]));
  assert.equal(a.metrics.find((m) => m.id === '6.1').value, null);
  assert.equal(a.metrics.find((m) => m.id === '1.2').value, null);
  assert.equal(a.recent.length, 10);
  assert.ok(a.recent[0].overall >= 0 && a.recent[0].overall <= 100);
  // Besser platzierter Spieler → hoeherer 1.1-Wert
  const best = REF.reduce((x, p) => (mean(p) < mean(x) ? p : x));
  const worst = REF.reduce((x, p) => (mean(p) > mean(x) ? p : x));
  const vb = scorePlayer(best.entries, pop, ctx).metrics.find((m) => m.id === '1.1').value;
  const vw = scorePlayer(worst.entries, pop, ctx).metrics.find((m) => m.id === '1.1').value;
  assert.ok(vb > 80 && vw < 20, `${vb} / ${vw}`);
});
const mean = (p) => p.entries.reduce((s, e) => s + e.f.P, 0) / p.entries.length;

test('Spieler mit 5 Spielen: alles „—", Fallzahl steht', () => {
  const pop = populationLookup(ROWS, 'euw1', ctx);
  const r = scorePlayer(REF[1].entries.slice(0, 5), pop, ctx);
  assert.ok(r.metrics.every((m) => m.value == null && m.reps == null));
  assert.equal(r.metrics.find((m) => m.id === '1.1').n, 5);
});

test('Ohne Bezugswerte: nichts bewertet, kein Absturz', () => {
  const pop = populationLookup([], 'euw1', ctx);
  assert.equal(pop.empty, true);
  const r = scorePlayer(REF[0].entries, pop, ctx);
  assert.ok(r.metrics.every((m) => m.value == null));
});

test('3.2 nur mit Spiel im Vorpatch und vollem Fenster', () => {
  const pop = populationLookup(ROWS, 'euw1', ctx);
  const only = Array.from({ length: 40 }, (_, i) => ({ f: fakeF(i, { P: 4, patch: P_NOW }), lobby: null }));
  const { games } = prepareGames(only, pop, ctx);
  assert.ok(games.every((x) => !x.early), 'kein Vorpatch → kein Fenster');
  const both = REF[2].entries;
  const p2 = prepareGames(both, pop, ctx).games;
  assert.equal(p2.filter((x) => x.early).length, 15);
});

test('Lobby-Eintrag: Leiterpunkte in Reihenfolge, Carry je Teilnehmer', () => {
  const row = {
    match_id: 'EUW1_9', region: 'euw1', game_datetime: 1,
    participants: Array.from({ length: 8 }, (_, i) => ({ p: `P${i}`, pl: i + 1, lv: 8, lr: 30, g: 0, u: [], t: [] })),
    ranks: [2800, null, 2400, 2500, 2600, 2700, 2900, 3000],
  };
  const e = lobbyEntry(row, 'P2', ctx);
  assert.equal(e.selfIdx, 2);
  assert.equal(e.lpts[1], null);
  assert.equal(e.carries.length, 8);
  assert.equal(lobbyEntry(row, 'NOPE', ctx), null);
  assert.equal(gameFromLobby(row, 3).placement, 4);
});

test('β wird wiedergefunden (wahr 0,004 je Leiterpunkt)', () => {
  const m = fitLobbyModel(synthLobbies(3000, 0.004, 11));
  assert.ok(Math.abs(m.beta - 0.004) / 0.004 < 0.15, String(m.beta));
});

test('Mit bekannten Lobbys: 1.2, 3.3 und die Nur-bekannt-Fassungen werden bewertet', () => {
  const lobbies = synthLobbies(1500, 0.004, 5);
  const withLobby = REF.map((p, pi) => ({
    ...p,
    entries: p.entries.map((e, k) => {
      const l = lobbies[(pi * 80 + k) % lobbies.length];
      // eigener Platz = Platz aus dem Spiel, Gegner mit gleichem Carry an Stelle 1
      const lpts = [...l.lpts];
      const carries = ['C1', 'C1', 'X2', 'X3', 'X4', 'X5', 'X6', 'X7'];
      return { f: e.f, lobby: { selfIdx: 0, lpts, carries, placements: l.placements } };
    }),
  }));
  const rows = buildPopulation(withLobby, lobbies, ctx);
  const all = rows.find((r) => r.region === 'all' && r.patch === '*');
  assert.ok(all.dists.lobby?.beta > 0);
  assert.ok(all.dists.players['1.2']?.n >= 200, 'Spielerverteilung 1.2');
  const pop = populationLookup(rows, 'euw1', ctx);
  const r = scorePlayer(withLobby[0].entries, pop, ctx, { puuid: 'PU0' });
  const val = (id) => r.metrics.find((m) => m.id === id).value;
  assert.ok(val('1.2') != null && val('5.1k') != null && val('3.1k') != null, JSON.stringify(r.metrics.map((m) => [m.id, m.value, m.n])));
  assert.equal(r.knownGames, 80);
  assert.ok(r.recent[0].E != null && r.recent[0].C === 1);
  if (all.dists.lobby.pi?.[1]) assert.ok(val('3.3') != null);
});

test('Leiterpunkte aus Ranglisten-Treffern, unbekannte Stufe bleibt leer', async () => {
  const { lobbyRanks } = await import('./tft-player-scoring.mjs');
  const m = lobbyRanks([
    { match_id: 'A', idx: 0, tier: 'DIAMOND', rank: 'II', lp: 50 },
    { match_id: 'A', idx: 7, tier: 'CHALLENGER', rank: 'I', lp: 900 },
    { match_id: 'A', idx: 3, tier: 'WOOD', rank: 'I', lp: 1 },
  ]);
  assert.deepEqual(m.get('A'), [2400 + 200 + 50, null, null, null, null, null, null, 3700]);
});

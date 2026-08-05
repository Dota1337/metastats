/**
 * Regressionstests für den Skill-Score-Multiplikator.
 *
 * Warum ausgerechnet hier: Das ist die folgenreichste Berechnung der Seite —
 * jeder Marktwert hängt daran, und die Fehlerklasse ist durchgehend
 * „stille falsche Zahl" statt Absturz: Division durch eine MAD von 0 (die
 * gesamte Population identisch), Dämpfungs-Schwellen um 20/40/100 Spiele,
 * fehlende Signale bei dünner Datenlage, Clamp-Grenzen. Alles Fälle, die
 * einen plausibel aussehenden Multiplikator liefern.
 *
 * Die Property-Tests decken die Zusagen ab, die für JEDEN Input gelten
 * müssen — dort liegen die Nullteiler und NaN, die man sich als Beispiel
 * nicht ausdenkt.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  extractRawMetrics,
  buildPopulation,
  buildCompMeta,
  applyMeta,
  scoreSkill,
  SKILL_WEIGHTS,
} from './tft-skill-score.mjs';

const match = (placement, over = {}) => ({
  placement,
  comp: { clusterKey: 'TFT17_Stargazer@6_TFT17_Lulu', carryUnit: 'TFT17_Lulu' },
  lastRound: 30,
  goldLeft: 5,
  totalDamage: 60,
  ...over,
});
const matches = (n, placement = 4, over = {}) => Array.from({ length: n }, () => match(placement, over));

// Population aus n Spielern, deren Metriken um einen Wert streuen — sonst ist
// die MAD 0 und alle z-Scores fallen weg (eigener Test dafür weiter unten).
function popFrom(rawList) {
  return buildPopulation(rawList);
}
function spreadPopulation() {
  const list = [];
  for (let i = 0; i < 21; i++) {
    list.push(extractRawMetrics(
      matches(30, 1 + (i % 8), { lastRound: 20 + i, goldLeft: i, totalDamage: 40 + 3 * i }),
      { wins: i, losses: 30 - i },
      null,
    ));
  }
  return { list, pop: popFrom(list) };
}

test('Gewichte summieren sich zu 1', () => {
  const sum = Object.values(SKILL_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `Gewichtssumme ${sum}`);
});

test('Dämpfung greift genau an den Schwellen 20 / 40 / 100', () => {
  const { pop } = spreadPopulation();
  const damp = (n) => scoreSkill({ n, perfM: null, metaRelM: null, consM: null, flexM: null, survival: null, eco: null, dmgByPlc: {}, dmgCount: 0 }, pop).damping;
  assert.equal(damp(19), 0.5);
  assert.equal(damp(20), 0.8);
  assert.equal(damp(39), 0.8);
  assert.equal(damp(40), 0.95);
  assert.equal(damp(99), 0.95);
  assert.equal(damp(100), 1.0);
  assert.equal(damp(5000), 1.0);
});

test('MAD 0 (Population völlig homogen) ergibt Multiplikator 1, nicht NaN', () => {
  // Das ist der Nullteiler-Fall: alle Spieler exakt gleich → keine Streuung →
  // kein z-Score berechenbar. Ohne die mad===0-Wache käme hier Infinity heraus
  // und der Multiplikator wäre auf den Clamp geknallt statt neutral zu bleiben.
  const list = Array.from({ length: 10 }, () => extractRawMetrics(matches(30, 4), { wins: 10, losses: 10 }, null));
  const pop = popFrom(list);
  const res = scoreSkill(list[0], pop);
  assert.equal(res.multiplier, 1);
  assert.equal(res.skillScore, 0);
  assert.ok(res.signals.every(s => !s.available), 'kein Signal darf ohne Streuung verfügbar sein');
});

test('leere Population crasht nicht', () => {
  const pop = buildPopulation([]);
  const res = scoreSkill(extractRawMetrics([], null, null), pop);
  assert.equal(res.multiplier, 1);
  assert.equal(res.sampleSize, 0);
});

test('perfM erst ab 8 Spielen, Platzierungen ≤ 0 zählen nicht mit', () => {
  assert.equal(extractRawMetrics(matches(7), null, null).perfM, null);
  assert.ok(extractRawMetrics(matches(8), null, null).perfM != null);
  // Riot liefert bei abgebrochenen Partien Platzierung 0 — die dürfen die
  // Stichprobe weder auffüllen noch den Schnitt nach unten ziehen.
  const raw = extractRawMetrics([...matches(8, 4), ...matches(5, 0)], null, null);
  assert.equal(raw.n, 8);
});

test('ohne Ranked-Daten wird die Karriere-Winrate aus den Matches selbst geschätzt', () => {
  const raw = extractRawMetrics(matches(20, 1), null, null);
  assert.ok(Number.isFinite(raw.perfM));
  const raw0 = extractRawMetrics(matches(20, 1), { wins: 0, losses: 0 }, null);
  assert.equal(raw.perfM, raw0.perfM, 'wins+losses = 0 muss denselben Pfad nehmen wie kein ranked-Objekt');
});

test('metaRelative ignoriert Comps unterhalb der 200-Spiele-Benchmark-Schwelle', () => {
  const raw = extractRawMetrics(matches(20, 2), null, new Map([
    ['TFT17_Stargazer@6_TFT17_Lulu', { avgPlacement: 4.5, games: 199 }],
  ]));
  assert.equal(raw.metaRelM, null);
  assert.equal(raw.metaCount, 0);

  const raw2 = extractRawMetrics(matches(20, 2), null, new Map([
    ['TFT17_Stargazer@6_TFT17_Lulu', { avgPlacement: 4.5, games: 200 }],
  ]));
  assert.equal(raw2.metaCount, 20);
  assert.ok(Math.abs(raw2.metaRelM - 2.5) < 1e-9, 'Δ = benchmark 4.5 − eigene 2.0');
});

test('metaRelative bleibt null unter 10 Benchmark-Spielen', () => {
  const raw = extractRawMetrics(matches(9, 2), null, new Map([
    ['TFT17_Stargazer@6_TFT17_Lulu', { avgPlacement: 4.5, games: 5000 }],
  ]));
  assert.equal(raw.metaRelM, null);
});

test('buildCompMeta aggregiert über alle Spieler, applyMeta füllt nach', () => {
  const a = extractRawMetrics(matches(200, 2), null, null);
  const b = extractRawMetrics(matches(200, 6), null, null);
  const meta = buildCompMeta([a, b]);
  const entry = meta.get('TFT17_Stargazer@6_TFT17_Lulu');
  assert.equal(entry.games, 400);
  assert.equal(entry.avgPlacement, 4);

  applyMeta(a, meta);
  assert.ok(Math.abs(a.metaRelM - 2) < 1e-9, 'Spieler A liegt 2 Plätze über der Cohort-Benchmark');
  const before = a.metaRelM;
  applyMeta(a, meta);
  assert.equal(a.metaRelM, before, 'applyMeta ist idempotent');
});

test('boardStrength braucht mindestens 10 auswertbare Matches', () => {
  const thin = extractRawMetrics(matches(9, 3), null, null);
  const pop = buildPopulation([thin]);
  assert.equal(thin._boardM, null);
  assert.equal(pop.medians.boardStrength.n, 0);
});

test('besser als der Median hebt den Multiplikator, schlechter senkt ihn', () => {
  const { list } = spreadPopulation();
  const best = extractRawMetrics(matches(200, 1, { lastRound: 40, goldLeft: 0, totalDamage: 200 }), { wins: 190, losses: 10 }, null);
  const worst = extractRawMetrics(matches(200, 8, { lastRound: 12, goldLeft: 60, totalDamage: 5 }), { wins: 5, losses: 195 }, null);
  const pop2 = buildPopulation([...list, best, worst]);
  const mBest = scoreSkill(best, pop2).multiplier;
  const mWorst = scoreSkill(worst, pop2).multiplier;
  assert.ok(mBest > 1, `Top-Spieler bekam ${mBest}`);
  assert.ok(mWorst < 1, `Bottom-Spieler bekam ${mWorst}`);
  assert.ok(mBest > mWorst);
});

test('Signal-Beiträge summieren sich zum rohen Skill-Score', () => {
  const { list, pop } = spreadPopulation();
  const res = scoreSkill(list[3], pop);
  const sum = res.signals.reduce((s, x) => s + x.contribution, 0);
  assert.ok(Math.abs(sum - res.skillScoreRaw) < 5e-3, `Σ Beiträge ${sum} vs ${res.skillScoreRaw}`);
  assert.ok(Math.abs(res.skillScore - res.skillScoreRaw * res.damping) < 5e-4);
});

// ── Properties ───────────────────────────────────────────────────────────────

const arbRaw = fc.record({
  n: fc.integer({ min: 0, max: 500 }),
  perfM: fc.option(fc.double({ min: -20, max: 20, noNaN: true }), { nil: null }),
  metaRelM: fc.option(fc.double({ min: -10, max: 10, noNaN: true }), { nil: null }),
  metaCount: fc.integer({ min: 0, max: 500 }),
  consM: fc.option(fc.double({ min: -10, max: 0, noNaN: true }), { nil: null }),
  flexM: fc.option(fc.double({ min: 0, max: 10, noNaN: true }), { nil: null }),
  survival: fc.option(fc.double({ min: 0, max: 50, noNaN: true }), { nil: null }),
  eco: fc.option(fc.double({ min: -100, max: 0, noNaN: true }), { nil: null }),
  dmgByPlc: fc.constant({}),
  dmgCount: fc.constant(0),
});
const arbStat = fc.record({
  median: fc.double({ min: -20, max: 20, noNaN: true }),
  mad: fc.double({ min: 0, max: 10, noNaN: true }),
  n: fc.integer({ min: 0, max: 1000 }),
});
const arbPop = fc.record({
  expectedDmg: fc.constant({}),
  medians: fc.record({
    performance: arbStat, metaRelative: arbStat, consistency: arbStat,
    flexMastery: arbStat, survival: arbStat, eco: arbStat, boardStrength: arbStat,
  }),
});

test('Property: Multiplikator liegt immer in [0.45, 1.65] und ist nie NaN', () => {
  fc.assert(fc.property(arbRaw, arbPop, (raw, pop) => {
    const res = scoreSkill(raw, pop);
    assert.ok(Number.isFinite(res.multiplier), `NaN/Infinity bei ${JSON.stringify(raw)}`);
    assert.ok(res.multiplier >= 0.45 && res.multiplier <= 1.65, `außerhalb: ${res.multiplier}`);
    assert.ok(Number.isFinite(res.skillScore) && Number.isFinite(res.skillScoreRaw));
    for (const s of res.signals) assert.ok(s.z === null || Number.isFinite(s.z));
  }), { numRuns: 3000 });
});

test('Property: besseres Performance-Signal senkt den Multiplikator nie', () => {
  // Monotonie ist die Zusage, die ein Vorzeichenfehler sofort bricht — und die
  // in den fertigen Zahlen niemandem auffällt, weil sie weiter plausibel aussehen.
  fc.assert(fc.property(
    arbPop,
    fc.integer({ min: 0, max: 500 }),
    fc.double({ min: -20, max: 20, noNaN: true }),
    fc.double({ min: 0, max: 20, noNaN: true }),
    (pop, n, perfM, delta) => {
      const base = { n, perfM, metaRelM: null, metaCount: 0, consM: null, flexM: null, survival: null, eco: null, dmgByPlc: {}, dmgCount: 0 };
      const better = { ...base, perfM: perfM + delta };
      assert.ok(scoreSkill(better, pop).multiplier >= scoreSkill(base, pop).multiplier - 1e-9);
    },
  ), { numRuns: 2000 });
});

test('Property: extractRawMetrics liefert nur endliche Zahlen oder null', () => {
  const arbMatch = fc.record({
    placement: fc.integer({ min: 0, max: 8 }),
    comp: fc.record({
      clusterKey: fc.constantFrom('a@1_x', 'b@2_y', 'c@3_z'),
      carryUnit: fc.constantFrom('TFT17_Lulu', 'TFT17_Vex'),
    }),
    lastRound: fc.integer({ min: 0, max: 45 }),
    goldLeft: fc.integer({ min: 0, max: 200 }),
    totalDamage: fc.integer({ min: 0, max: 500 }),
  });
  fc.assert(fc.property(
    fc.array(arbMatch, { maxLength: 60 }),
    fc.option(fc.record({ wins: fc.nat(500), losses: fc.nat(500) }), { nil: null }),
    (ms, ranked) => {
      const raw = extractRawMetrics(ms, ranked, null);
      for (const k of ['perfM', 'consM', 'flexM', 'survival', 'eco']) {
        assert.ok(raw[k] === null || Number.isFinite(raw[k]), `${k} = ${raw[k]}`);
      }
      assert.ok(Number.isInteger(raw.n) && raw.n >= 0);
      // Ein Board, das durchgehend Platz 0 meldet, darf keine Metriken erzeugen.
      if (ms.every(m => m.placement === 0)) assert.equal(raw.perfM, null);
    },
  ), { numRuns: 2000 });
});

test('Property: buildPopulation verkraftet beliebige Spieler-Mischungen', () => {
  fc.assert(fc.property(fc.array(arbRaw, { maxLength: 30 }), (list) => {
    const pop = buildPopulation(list.map(r => ({ ...r, dmgByPlc: {}, dmgCount: 0 })));
    for (const s of Object.values(pop.medians)) {
      assert.ok(Number.isFinite(s.median) && Number.isFinite(s.mad) && s.mad >= 0);
    }
  }), { numRuns: 1000 });
});

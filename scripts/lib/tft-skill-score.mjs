// Weighted skill-score multiplier (MJS) — replaces the multiplicative 6-agent
// product in tft-marketvalue.mjs. The multiplier is a population-relative
// z-score blend over the whole season (no recency weighting), mapped through
// tanh into [0.45, 1.65].
//
// IMPORTANT: keep in sync with app/lib/tft-marketvalue/skill-score.ts.
//
// Two-phase, because every signal is normalised against the REGION population
// (robust median + MAD), which a single-player call cannot compute on its own:
//   1. extractRawMetrics(matches, ranked, compMetaAvg) → per-player raw metrics
//   2. buildPopulation(rawList)                        → median/MAD + expected dmg
//   3. scoreSkill(raw, pop)                            → { multiplier, signals }
// The batch crawler runs all three; the live single-player path persists the
// population stats from the batch and calls scoreSkill() with them.

export const SKILL_WEIGHTS = {
  performance: 0.30,
  metaRelative: 0.25,
  consistency: 0.15,
  flexMastery: 0.10,
  gameSense: 0.10,
  boardStrength: 0.10,
};

// Calibration knobs (tune against real data — see calibration harness).
const K_TOP4_PRIOR = 60;     // Bayesian prior weight blending career WR into top4 rate
const MAP_STEEPNESS = 0.65;  // multiplier = 1 + S·tanh(skillScore); 0.65 uses the full [0.45,1.65] range (calibrated 2026-05-25)
const Z_CLAMP = 3;           // clamp z-scores to ±3 (robust to outliers)
const META_MIN_GAMES = 200;  // a comp needs ≥200 master+ games to be a meta benchmark

const MIN_SAMPLE = {
  performance: 8,
  metaRelative: 10,  // # of meta-benchmarked matches
  consistency: 8,
  flexMastery: 10,
  gameSense: 5,      // per sub-metric (survival / eco)
  boardStrength: 10,
};

// ── robust stats ────────────────────────────────────────────────────────────
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mad(xs, med) {
  if (!xs.length) return 0;
  return 1.4826 * median(xs.map(x => Math.abs(x - med)));
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// ── Phase 1: per-player raw metrics ──────────────────────────────────────────
// All metrics are oriented so HIGHER = better (sign already flipped where the
// natural metric is "lower is better", e.g. placement / stddev / gold left).
//
// matches:     snapshot[] (placement, comp.clusterKey, lastRound, goldLeft, totalDamage)
// ranked:      { wins, losses } — TFT league wins ≈ career top-4 count (prior)
// compMetaAvg: Map<clusterKey, { avgPlacement, games }> from master+ aggregate
export function extractRawMetrics(matches, ranked, compMetaAvg) {
  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const n = placements.length;

  // performance — avg placement + Bayesian-blended top-4 rate
  const avgPlc = mean(placements);
  const top4Count = placements.filter(p => p <= 4).length;
  const wins = ranked?.wins ?? 0, losses = ranked?.losses ?? 0;
  const careerWr = (wins + losses) > 0 ? wins / (wins + losses) : (n ? top4Count / n : 0);
  const top4Blend = n ? (top4Count + K_TOP4_PRIOR * careerWr) / (n + K_TOP4_PRIOR) : 0;
  const perfM = n >= MIN_SAMPLE.performance ? (-avgPlc + 0.5 * top4Blend) : null;

  // metaRelative — placed better than the comp's master+ meta average?
  let metaDeltaSum = 0, metaCount = 0;
  if (compMetaAvg) {
    for (const m of matches) {
      const key = m.comp?.clusterKey;
      if (!key || !(m.placement > 0)) continue;
      const meta = compMetaAvg.get(key);
      if (!meta || meta.games < META_MIN_GAMES) continue;
      metaDeltaSum += (meta.avgPlacement - m.placement);  // higher = beat the comp's norm
      metaCount++;
    }
  }
  const metaRelM = metaCount >= MIN_SAMPLE.metaRelative ? (metaDeltaSum / metaCount) : null;

  // consistency — negative stddev of placements
  let consM = null;
  if (n >= MIN_SAMPLE.consistency) {
    const mu = avgPlc;
    const variance = placements.reduce((s, p) => s + (p - mu) ** 2, 0) / n;
    consM = -Math.sqrt(variance);
  }

  // flexMastery — # of comps mastered (≥5 games, avg ≤4.0), one-trick fallback,
  // plus a carry-diversity term.
  let flexM = null;
  if (n >= MIN_SAMPLE.flexMastery) {
    const byComp = new Map();
    for (const m of matches) {
      const k = m.comp?.clusterKey;
      if (!k || !(m.placement > 0)) continue;
      (byComp.get(k) ?? byComp.set(k, []).get(k)).push(m.placement);
    }
    const compAvgs = [...byComp.values()].filter(ps => ps.length >= 5).map(ps => mean(ps));
    const mastered = compAvgs.filter(a => a <= 4.0).length;
    const dominant = [...byComp.values()].sort((a, b) => b.length - a.length)[0];
    const onetrick = (dominant && dominant.length >= 15 && mean(dominant) <= 2.8) ? 1 : 0;
    const carries = new Set(matches.map(m => m.comp?.carryUnit).filter(Boolean)).size;
    flexM = Math.max(mastered, onetrick) + 0.5 * Math.min(carries, 6) / 6;
  }

  // gameSense — survival (late exits when bottom-4) + eco (low gold left on top-4)
  const lateExits = matches.filter(m => m.placement >= 5 && typeof m.lastRound === 'number' && m.lastRound > 0).map(m => m.lastRound);
  const ecoTops = matches.filter(m => m.placement <= 4 && typeof m.goldLeft === 'number').map(m => m.goldLeft);
  const survival = lateExits.length >= MIN_SAMPLE.gameSense ? mean(lateExits) : null;
  const eco = ecoTops.length >= MIN_SAMPLE.gameSense ? -mean(ecoTops) : null;  // higher = less gold wasted

  // boardStrength — accumulate dmgRate per placement (8 buckets, not per-match,
  // to bound memory across tens of thousands of players). The residual vs the
  // population's expected dmgRate-per-placement is computed in Phase 2/3.
  const dmgByPlc = {};
  let dmgCount = 0;
  for (const m of matches) {
    if (typeof m.totalDamage === 'number' && m.totalDamage > 0 && typeof m.lastRound === 'number' && m.lastRound > 0 && m.placement > 0) {
      const rate = m.totalDamage / Math.max(1, m.lastRound);
      const b = dmgByPlc[m.placement] || (dmgByPlc[m.placement] = { sum: 0, count: 0 });
      b.sum += rate; b.count++; dmgCount++;
    }
  }

  return { n, perfM, metaRelM, metaCount, consM, flexM, survival, eco, dmgByPlc, dmgCount };
}

// ── Phase 2: population stats (median/MAD per metric + expected dmg) ──────────
export function buildPopulation(rawList) {
  const collect = (sel) => rawList.map(sel).filter(v => v != null && Number.isFinite(v));
  const stat = (vals) => { const m = median(vals); return { median: m, mad: mad(vals, m), n: vals.length }; };

  // expected dmgRate per placement (1..8), population mean (aggregate buckets)
  const agg = {};
  for (const r of rawList) for (const plc of Object.keys(r.dmgByPlc)) {
    const a = agg[plc] || (agg[plc] = { sum: 0, count: 0 });
    a.sum += r.dmgByPlc[plc].sum; a.count += r.dmgByPlc[plc].count;
  }
  const expectedDmg = {};
  for (const plc of Object.keys(agg)) expectedDmg[plc] = agg[plc].count ? agg[plc].sum / agg[plc].count : 0;

  // boardStrength M per player needs expectedDmg → compute, then its pop median/MAD
  const boardMs = [];
  for (const r of rawList) {
    r._boardM = boardResidual(r.dmgByPlc, r.dmgCount, expectedDmg);
    if (r._boardM != null) boardMs.push(r._boardM);
  }

  return {
    expectedDmg,
    medians: {
      performance: stat(collect(r => r.perfM)),
      metaRelative: stat(collect(r => r.metaRelM)),
      consistency: stat(collect(r => r.consM)),
      flexMastery: stat(collect(r => r.flexM)),
      survival: stat(collect(r => r.survival)),
      eco: stat(collect(r => r.eco)),
      boardStrength: stat(boardMs),
    },
  };
}

function boardResidual(dmgByPlc, dmgCount, expectedDmg) {
  if (!dmgByPlc || dmgCount < MIN_SAMPLE.boardStrength) return null;
  let sum = 0, k = 0;
  for (const plc of Object.keys(dmgByPlc)) {
    const exp = expectedDmg[plc];
    if (exp == null) continue;
    const b = dmgByPlc[plc];
    sum += (b.sum - b.count * exp);
    k += b.count;
  }
  return k ? sum / k : null;
}

// ── sample-size damping (unchanged thresholds) ───────────────────────────────
function dampFor(n) {
  if (n < 20) return 0.5;
  if (n < 40) return 0.8;
  if (n < 100) return 0.95;
  return 1.0;
}

// ── Phase 3: score one player against the population ─────────────────────────
// opts.steepness overrides MAP_STEEPNESS (calibration knob). Note the effective
// multiplier range is [1-S, 1+S] before the [0.45,1.65] clamp, since tanh∈(-1,1).
export function scoreSkill(raw, pop, opts = {}) {
  const steepness = opts.steepness ?? MAP_STEEPNESS;
  const med = pop.medians;
  const zOf = (M, s) => (M == null || !s || s.mad === 0) ? null : clamp((M - s.median) / s.mad, -Z_CLAMP, Z_CLAMP);

  const zPerf = zOf(raw.perfM, med.performance);
  const zMeta = zOf(raw.metaRelM, med.metaRelative);
  const zCons = zOf(raw.consM, med.consistency);
  const zFlex = zOf(raw.flexM, med.flexMastery);

  // gameSense: blend of survival/eco z-scores (each already population-relative)
  const zSurv = zOf(raw.survival, med.survival);
  const zEco = zOf(raw.eco, med.eco);
  let zSense = null;
  if (zSurv != null && zEco != null) zSense = 0.6 * zSurv + 0.4 * zEco;
  else if (zSurv != null) zSense = zSurv;
  else if (zEco != null) zSense = zEco;

  // boardStrength: residual vs population expected dmg, then z
  const boardM = raw._boardM !== undefined ? raw._boardM : boardResidual(raw.dmgByPlc, raw.dmgCount, pop.expectedDmg);
  const zBoard = zOf(boardM, med.boardStrength);

  const parts = [
    { signal: 'performance', z: zPerf, weight: SKILL_WEIGHTS.performance, detail: raw.perfM == null ? `n<${MIN_SAMPLE.performance}` : `avgΔ` },
    { signal: 'metaRelative', z: zMeta, weight: SKILL_WEIGHTS.metaRelative, detail: `${raw.metaCount} meta-games` },
    { signal: 'consistency', z: zCons, weight: SKILL_WEIGHTS.consistency, detail: raw.consM == null ? 'n<8' : `σ${(-raw.consM).toFixed(2)}` },
    { signal: 'flexMastery', z: zFlex, weight: SKILL_WEIGHTS.flexMastery, detail: raw.flexM == null ? 'n<10' : raw.flexM.toFixed(2) },
    { signal: 'gameSense', z: zSense, weight: SKILL_WEIGHTS.gameSense, detail: 'survival+eco' },
    { signal: 'boardStrength', z: zBoard, weight: SKILL_WEIGHTS.boardStrength, detail: boardM == null ? 'n<10' : boardM.toFixed(0) },
  ];

  const avail = parts.filter(p => p.z != null);
  const wSum = avail.reduce((s, p) => s + p.weight, 0);
  const skillScoreRaw = wSum > 0 ? avail.reduce((s, p) => s + p.weight * p.z, 0) / wSum : 0;
  const damping = dampFor(raw.n);
  const skillScore = skillScoreRaw * damping;
  const multiplier = clamp(1 + steepness * Math.tanh(skillScore), 0.45, 1.65);

  const signals = parts.map(p => ({
    signal: p.signal,
    z: p.z == null ? null : Number(p.z.toFixed(3)),
    weight: p.weight,
    contribution: (p.z == null || wSum === 0) ? 0 : Number((p.weight * p.z / wSum).toFixed(4)),
    detail: p.detail,
    available: p.z != null,
  }));

  return {
    multiplier: Number(multiplier.toFixed(3)),
    skillScore: Number(skillScore.toFixed(4)),
    skillScoreRaw: Number(skillScoreRaw.toFixed(4)),
    damping,
    sampleSize: raw.n,
    signals,
  };
}

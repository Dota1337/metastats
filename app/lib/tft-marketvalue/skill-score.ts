// Weighted skill-score multiplier (TS canon) — mirror of scripts/lib/tft-skill-score.mjs.
// KEEP IN SYNC with the MJS port. The multiplier is a population-relative z-score
// blend over the season, mapped through tanh into [0.45, 1.65].
//
// Two-phase: extractRawMetrics → buildPopulation → scoreSkill. The batch computes
// the population; the live single-player path persists it and reads it back.
import type { TftMatchSnapshot, TftRanked } from './types';

export const SKILL_WEIGHTS = {
  performance: 0.30,
  metaRelative: 0.25,
  consistency: 0.15,
  flexMastery: 0.10,
  gameSense: 0.10,
  boardStrength: 0.10,
} as const;

const K_TOP4_PRIOR = 60;
const MAP_STEEPNESS = 0.65;
const Z_CLAMP = 3;
const META_MIN_GAMES = 200;
const MIN_SAMPLE = { performance: 8, metaRelative: 10, consistency: 8, flexMastery: 10, gameSense: 5, boardStrength: 10 };

export interface CompMetaEntry { avgPlacement: number; games: number; }
export interface RawMetrics {
  n: number;
  perfM: number | null;
  metaRelM: number | null;
  metaCount: number;
  compPlc: Record<string, { sum: number; count: number }>;
  consM: number | null;
  flexM: number | null;
  survival: number | null;
  eco: number | null;
  dmgByPlc: Record<string, { sum: number; count: number }>;
  dmgCount: number;
  _boardM?: number | null;
}
export interface MetricStat { median: number; mad: number; n: number; }
export interface PopulationStats {
  expectedDmg: Record<string, number>;
  medians: {
    performance: MetricStat; metaRelative: MetricStat; consistency: MetricStat;
    flexMastery: MetricStat; survival: MetricStat; eco: MetricStat; boardStrength: MetricStat;
  };
}
export interface SkillSignal {
  signal: string; z: number | null; weight: number; contribution: number; detail: string; available: boolean;
}
export interface SkillResult {
  multiplier: number; skillScore: number; skillScoreRaw: number; damping: number; sampleSize: number; signals: SkillSignal[];
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
const mad = (xs: number[], med: number) => xs.length ? 1.4826 * median(xs.map(x => Math.abs(x - med))) : 0;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export function extractRawMetrics(
  matches: TftMatchSnapshot[],
  ranked: Pick<TftRanked, 'wins' | 'losses'> | null,
  compMetaAvg: Map<string, CompMetaEntry> | null,
): RawMetrics {
  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const n = placements.length;

  const avgPlc = mean(placements);
  const top4Count = placements.filter(p => p <= 4).length;
  const wins = ranked?.wins ?? 0, losses = ranked?.losses ?? 0;
  const careerWr = (wins + losses) > 0 ? wins / (wins + losses) : (n ? top4Count / n : 0);
  const top4Blend = n ? (top4Count + K_TOP4_PRIOR * careerWr) / (n + K_TOP4_PRIOR) : 0;
  const perfM = n >= MIN_SAMPLE.performance ? (-avgPlc + 0.5 * top4Blend) : null;

  const compPlc: Record<string, { sum: number; count: number }> = {};
  for (const m of matches) {
    const key = m.comp?.clusterKey;
    if (!key || !(m.placement > 0)) continue;
    const c = compPlc[key] || (compPlc[key] = { sum: 0, count: 0 });
    c.sum += m.placement; c.count++;
  }
  let metaRelM: number | null = null, metaCount = 0;
  if (compMetaAvg) ({ metaRelM, metaCount } = metaRelFrom(compPlc, compMetaAvg));

  let consM: number | null = null;
  if (n >= MIN_SAMPLE.consistency) {
    const variance = placements.reduce((s, p) => s + (p - avgPlc) ** 2, 0) / n;
    consM = -Math.sqrt(variance);
  }

  let flexM: number | null = null;
  if (n >= MIN_SAMPLE.flexMastery) {
    const byComp = new Map<string, number[]>();
    for (const m of matches) {
      const k = m.comp?.clusterKey;
      if (!k || !(m.placement > 0)) continue;
      const arr = byComp.get(k) ?? (byComp.set(k, []).get(k) as number[]);
      arr.push(m.placement);
    }
    const compAvgs = [...byComp.values()].filter(ps => ps.length >= 5).map(ps => mean(ps));
    const mastered = compAvgs.filter(a => a <= 4.0).length;
    const dominant = [...byComp.values()].sort((a, b) => b.length - a.length)[0];
    const onetrick = (dominant && dominant.length >= 15 && mean(dominant) <= 2.8) ? 1 : 0;
    const carries = new Set(matches.map(m => m.comp?.carryUnit).filter(Boolean)).size;
    flexM = Math.max(mastered, onetrick) + 0.5 * Math.min(carries, 6) / 6;
  }

  const lateExits = matches.filter(m => m.placement >= 5 && typeof m.lastRound === 'number' && m.lastRound > 0).map(m => m.lastRound as number);
  const ecoTops = matches.filter(m => m.placement <= 4 && typeof m.goldLeft === 'number').map(m => m.goldLeft as number);
  const survival = lateExits.length >= MIN_SAMPLE.gameSense ? mean(lateExits) : null;
  const eco = ecoTops.length >= MIN_SAMPLE.gameSense ? -mean(ecoTops) : null;

  const dmgByPlc: Record<string, { sum: number; count: number }> = {};
  let dmgCount = 0;
  for (const m of matches) {
    if (typeof m.totalDamage === 'number' && m.totalDamage > 0 && typeof m.lastRound === 'number' && m.lastRound > 0 && m.placement > 0) {
      const rate = m.totalDamage / Math.max(1, m.lastRound);
      const b = dmgByPlc[m.placement] || (dmgByPlc[m.placement] = { sum: 0, count: 0 });
      b.sum += rate; b.count++; dmgCount++;
    }
  }

  return { n, perfM, metaRelM, metaCount, compPlc, consM, flexM, survival, eco, dmgByPlc, dmgCount };
}

function metaRelFrom(compPlc: Record<string, { sum: number; count: number }>, compMetaAvg: Map<string, CompMetaEntry>): { metaRelM: number | null; metaCount: number } {
  let deltaSum = 0, count = 0;
  for (const key of Object.keys(compPlc)) {
    const meta = compMetaAvg.get(key);
    if (!meta || meta.games < META_MIN_GAMES) continue;
    const c = compPlc[key];
    deltaSum += (meta.avgPlacement * c.count - c.sum);
    count += c.count;
  }
  return { metaRelM: count >= MIN_SAMPLE.metaRelative ? deltaSum / count : null, metaCount: count };
}

// Cohort comp-benchmark from all players' compPlc (self-contained — no Supabase dep).
export function buildCompMeta(rawList: RawMetrics[]): Map<string, CompMetaEntry> {
  const agg: Record<string, { sum: number; count: number }> = {};
  for (const r of rawList) for (const key of Object.keys(r.compPlc || {})) {
    const a = agg[key] || (agg[key] = { sum: 0, count: 0 });
    a.sum += r.compPlc[key].sum; a.count += r.compPlc[key].count;
  }
  const map = new Map<string, CompMetaEntry>();
  for (const key of Object.keys(agg)) map.set(key, { avgPlacement: agg[key].count ? agg[key].sum / agg[key].count : 0, games: agg[key].count });
  return map;
}

export function applyMeta(raw: RawMetrics, compMetaAvg: Map<string, CompMetaEntry>): RawMetrics {
  if (raw.metaRelM != null) return raw;
  const { metaRelM, metaCount } = metaRelFrom(raw.compPlc || {}, compMetaAvg);
  raw.metaRelM = metaRelM; raw.metaCount = metaCount;
  return raw;
}

function boardResidual(dmgByPlc: Record<string, { sum: number; count: number }>, dmgCount: number, expectedDmg: Record<string, number>): number | null {
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

export function buildPopulation(rawList: RawMetrics[]): PopulationStats {
  const collect = (sel: (r: RawMetrics) => number | null) => rawList.map(sel).filter((v): v is number => v != null && Number.isFinite(v));
  const stat = (vals: number[]): MetricStat => { const m = median(vals); return { median: m, mad: mad(vals, m), n: vals.length }; };

  const agg: Record<string, { sum: number; count: number }> = {};
  for (const r of rawList) for (const plc of Object.keys(r.dmgByPlc)) {
    const a = agg[plc] || (agg[plc] = { sum: 0, count: 0 });
    a.sum += r.dmgByPlc[plc].sum; a.count += r.dmgByPlc[plc].count;
  }
  const expectedDmg: Record<string, number> = {};
  for (const plc of Object.keys(agg)) expectedDmg[plc] = agg[plc].count ? agg[plc].sum / agg[plc].count : 0;

  const boardMs: number[] = [];
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

function dampFor(n: number): number {
  if (n < 20) return 0.5;
  if (n < 40) return 0.8;
  if (n < 100) return 0.95;
  return 1.0;
}

export function scoreSkill(raw: RawMetrics, pop: PopulationStats, opts: { steepness?: number } = {}): SkillResult {
  const steepness = opts.steepness ?? MAP_STEEPNESS;
  const med = pop.medians;
  const zOf = (M: number | null, s: MetricStat): number | null => (M == null || !s || s.mad === 0) ? null : clamp((M - s.median) / s.mad, -Z_CLAMP, Z_CLAMP);

  const zPerf = zOf(raw.perfM, med.performance);
  const zMeta = zOf(raw.metaRelM, med.metaRelative);
  const zCons = zOf(raw.consM, med.consistency);
  const zFlex = zOf(raw.flexM, med.flexMastery);
  const zSurv = zOf(raw.survival, med.survival);
  const zEco = zOf(raw.eco, med.eco);
  let zSense: number | null = null;
  if (zSurv != null && zEco != null) zSense = 0.6 * zSurv + 0.4 * zEco;
  else if (zSurv != null) zSense = zSurv;
  else if (zEco != null) zSense = zEco;

  const boardM = raw._boardM !== undefined ? raw._boardM : boardResidual(raw.dmgByPlc, raw.dmgCount, pop.expectedDmg);
  const zBoard = zOf(boardM ?? null, med.boardStrength);

  const parts = [
    { signal: 'performance', z: zPerf, weight: SKILL_WEIGHTS.performance, detail: raw.perfM == null ? `n<${MIN_SAMPLE.performance}` : 'avgΔ' },
    { signal: 'metaRelative', z: zMeta, weight: SKILL_WEIGHTS.metaRelative, detail: `${raw.metaCount} meta-games` },
    { signal: 'consistency', z: zCons, weight: SKILL_WEIGHTS.consistency, detail: raw.consM == null ? 'n<8' : `σ${(-raw.consM).toFixed(2)}` },
    { signal: 'flexMastery', z: zFlex, weight: SKILL_WEIGHTS.flexMastery, detail: raw.flexM == null ? 'n<10' : raw.flexM.toFixed(2) },
    { signal: 'gameSense', z: zSense, weight: SKILL_WEIGHTS.gameSense, detail: 'survival+eco' },
    { signal: 'boardStrength', z: zBoard, weight: SKILL_WEIGHTS.boardStrength, detail: boardM == null ? 'n<10' : boardM.toFixed(0) },
  ];

  const avail = parts.filter(p => p.z != null);
  const wSum = avail.reduce((s, p) => s + p.weight, 0);
  const skillScoreRaw = wSum > 0 ? avail.reduce((s, p) => s + p.weight * (p.z as number), 0) / wSum : 0;
  const damping = dampFor(raw.n);
  const skillScore = skillScoreRaw * damping;
  const multiplier = clamp(1 + steepness * Math.tanh(skillScore), 0.45, 1.65);

  const signals: SkillSignal[] = parts.map(p => ({
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

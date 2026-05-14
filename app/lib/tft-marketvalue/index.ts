// Top-level entry point of the TFT marketvalue pipeline. The pipeline:
//   1. BaseValueAgent  — derives € from tier+rank+lp+playerRank
//   2. Performance     — placement / top-4 / top-1 driven multiplier
//   3. MetaAdaptation  — KG-aware comp diversity / hot-pick rate
//   4. HighRoll        — KG-aware item-slam / augment-quality
//   5. Consistency     — placement stddev / streaks
// Final = base × productOf(agent multipliers) × sample-size damping.
// Master+ only — Iron–Diamond returns Not Rated.

import type { TftRanked, TftMatchSnapshot, MarketValueBreakdown } from './types';
import { computeBaseValue } from './base-value';
import { performanceAgent } from './agents/performance';
import { metaAdaptationAgent, buildMetaKgSlice, type MetaKgSlice } from './agents/meta-adaptation';
import { highRollAgent, buildHighRollKgSlice, type HighRollKgSlice } from './agents/high-roll';
import { consistencyAgent } from './agents/consistency';

export interface TftMarketValueInput {
  ranked: TftRanked | null;
  playerRank?: number;          // ladder rank within the region's apex tier
  matches: TftMatchSnapshot[];
  patchKnowledgeGraph?: any;    // raw tft-graph-{region}.json (or null)
  augmentTierMap?: Record<string, number> | null;  // apiName -> 1/2/3
}

// Sample-size damping pulls the multiplier toward 1.0 when we don't have
// enough matches to trust the agent signals. With set-wide aggregation we
// expect 100+ matches for active players, so 100 is the new "full trust"
// threshold; the old 40-match plateau is replaced with a softer 0.95 ramp.
function dampFor(sampleSize: number): number {
  if (sampleSize < 20) return 0.5;
  if (sampleSize < 40) return 0.8;
  if (sampleSize < 100) return 0.95;
  return 1.0;
}

export function calculateTftMarketValue(input: TftMarketValueInput): MarketValueBreakdown {
  const base = computeBaseValue(input.ranked, input.playerRank);
  if (!base.rated) {
    return {
      baseValue: 0, multiplier: 1, finalValue: 0, rated: false,
      notRatedReason: base.notRatedReason || 'unrated',
      agents: [], sampleSize: input.matches.length, damping: 1,
    };
  }

  const metaKg: MetaKgSlice | null = buildMetaKgSlice(input.patchKnowledgeGraph);
  const highRollKg: HighRollKgSlice | null = buildHighRollKgSlice(input.patchKnowledgeGraph);
  const augTier = input.augmentTierMap || null;

  const perf = performanceAgent(input.matches);
  const meta = metaAdaptationAgent(input.matches, metaKg);
  const high = highRollAgent(input.matches, highRollKg, augTier);
  const cons = consistencyAgent(input.matches);

  const productMultiplier = perf.multiplier * meta.multiplier * high.multiplier * cons.multiplier;
  const damping = dampFor(input.matches.length);
  // Damping pulls multiplier toward 1.0 by `(1 - damping)` weight. So with
  // damping=0.5 a 1.4x multiplier becomes 1.2x; damping=1.0 keeps it at 1.4x.
  const damped = 1 + (productMultiplier - 1) * damping;
  const clamped = Math.max(0.45, Math.min(1.65, damped));

  return {
    baseValue: Math.round(base.baseValue),
    multiplier: Number(clamped.toFixed(3)),
    finalValue: Math.round(base.baseValue * clamped),
    rated: true,
    agents: [perf, meta, high, cons],
    sampleSize: input.matches.length,
    damping,
  };
}

export type { TftRanked, TftMatchSnapshot, MarketValueBreakdown };

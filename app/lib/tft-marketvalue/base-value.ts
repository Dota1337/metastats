import type { TftRanked } from './types';

// TFT base value scale, Diamond II and up (Iron through Diamond III/IV → Not
// Rated). Calibrated relative to LoL: LoL's top pros must outscale TFT's
// because the LoL esports + sponsorship economy is an order of magnitude
// larger. Target final-value range after multiplier (×0.45 .. ×1.65):
//   Chall #1            → ~180k €  (base 130k, typical multi 1.4)
//   Chall #30           → ~60k €   (base 43k)
//   Chall #150          → ~20k €
//   GM 200 LP           → ~10k €
//   Master 200 LP       → ~5k €
//   Master 0 LP         → ~1k €
//   Diamond I  100 LP   → ~1k €    (meets Master 0 LP)
//   Diamond II 0 LP     → ~200 €   (rated floor)
// Diamond III/IV and below stay Not Rated.

const TIER_VAL: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

// Roman division → number. Only used to gate Diamond (II+ rated, III/IV not).
const DIV_VAL: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };

export interface BaseValueResult {
  rated: boolean;
  baseValue: number;
  notRatedReason?: string;
}

export function computeBaseValue(ranked: TftRanked | null, playerRank?: number): BaseValueResult {
  if (!ranked || !ranked.tier) {
    return { rated: false, baseValue: 0, notRatedReason: 'unranked' };
  }
  const tier = ranked.tier.toUpperCase();
  const tierNum = TIER_VAL[tier] ?? -1;
  if (tierNum < TIER_VAL.DIAMOND) {
    return { rated: false, baseValue: 0, notRatedReason: 'below_diamond' };
  }
  const lp = Math.max(0, ranked.leaguePoints || 0);

  // Diamond is rated only from division II up (D3/D4 excluded by decision —
  // keeps the daily crawl scope sane while preserving the climb incentive).
  // Base ramps continuously into Master's 1000 entry:
  //   D2 0LP → 200, D2 100LP → 600, D1 0LP → 600, D1 100LP → 1000 (= Master 0).
  if (tier === 'DIAMOND') {
    const div = DIV_VAL[(ranked.rank ?? '').toUpperCase()] ?? 0;
    if (div !== 1 && div !== 2) {
      return { rated: false, baseValue: 0, notRatedReason: 'below_diamond2' };
    }
    const cappedLp = Math.min(lp, 100);
    return div === 2
      ? { rated: true, baseValue: 200 + (cappedLp / 100) * 400 }
      : { rated: true, baseValue: 600 + (cappedLp / 100) * 400 };
  }

  if (tier === 'MASTER') {
    // 0 → 1000, 200 → 4000. Gentle entry into apex.
    const cappedLp = Math.min(lp, 200);
    return { rated: true, baseValue: 1000 + (cappedLp / 200) * 3000 };
  }
  if (tier === 'GRANDMASTER') {
    // 0 → 4000, 400 → 12000. Smooth bridge between Master ceiling and low Chall.
    const cappedLp = Math.min(lp, 400);
    return { rated: true, baseValue: 4000 + (cappedLp / 400) * 8000 };
  }
  if (tier === 'CHALLENGER') {
    // Top 30 — linear interpolation: rank 1 → 130k, rank 30 → 43k.
    // With typical multiplier ~1.4 this lands at the 60k-180k final-value
    // target band the brief calls for.
    if (playerRank && playerRank <= 30) {
      return { rated: true, baseValue: 130000 - ((playerRank - 1) / 29) * 87000 };
    }
    // Rank 31–150 — continued gentle drop 43k → 15k.
    if (playerRank && playerRank <= 150) {
      return { rated: true, baseValue: 43000 - ((playerRank - 30) / 120) * 28000 };
    }
    // Rank > 150 or unknown — LP-based fade, max ~12k base.
    return { rated: true, baseValue: 5000 + Math.min(1, lp / 1500) * 7000 };
  }

  return { rated: false, baseValue: 0, notRatedReason: 'unknown_tier' };
}

export const TFT_TIER_VAL = TIER_VAL;

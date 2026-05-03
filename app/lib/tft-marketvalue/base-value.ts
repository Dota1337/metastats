import type { TftRanked } from './types';

// TFT base value scale, Master+ only (Iron through Diamond → Not Rated).
// Calibrated against TFT's smaller esports + streaming economy: Top-1 ≈ 200k €,
// Challenger generic ≈ 10–25k €, Master 0–50 LP ≈ 0.5–1.5k €. Numbers are
// rough first-pass values — refine after we see real sample data.

const TIER_VAL: Record<string, number> = {
  IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
  EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
};

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
  if (tierNum < TIER_VAL.MASTER) {
    return { rated: false, baseValue: 0, notRatedReason: 'below_master' };
  }
  const lp = Math.max(0, ranked.leaguePoints || 0);

  if (tier === 'MASTER') {
    // 0 → 500, 200 → 3500 (linear, capped at 200 LP because GM kicks in)
    const cappedLp = Math.min(lp, 200);
    return { rated: true, baseValue: 500 + (cappedLp / 200) * 3000 };
  }
  if (tier === 'GRANDMASTER') {
    // 0 → 3500, 400 → 10000
    const cappedLp = Math.min(lp, 400);
    return { rated: true, baseValue: 3500 + (cappedLp / 400) * 6500 };
  }
  if (tier === 'CHALLENGER') {
    // Top-N curve — falls back to LP-based when player rank is unknown
    if (playerRank === 1) return { rated: true, baseValue: 200000 };
    if (playerRank && playerRank <= 10) {
      return { rated: true, baseValue: 70000 + ((10 - playerRank) / 9) * 80000 };
    }
    if (playerRank && playerRank <= 50) {
      return { rated: true, baseValue: 25000 + ((50 - playerRank) / 40) * 35000 };
    }
    // Generic Chall: scale by LP only
    return { rated: true, baseValue: 10000 + (lp / 1000) * 15000 };
  }

  return { rated: false, baseValue: 0, notRatedReason: 'unknown_tier' };
}

export const TFT_TIER_VAL = TIER_VAL;

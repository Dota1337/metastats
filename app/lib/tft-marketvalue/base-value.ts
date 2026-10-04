import type { TftRanked } from './types';

// TFT base value scale, Diamond II and up (Iron through Diamond III/IV → Not
// Rated). Calibrated relative to LoL: LoL's top pros must outscale TFT's
// because the LoL esports + sponsorship economy is an order of magnitude
// larger. Target final-value range after multiplier (×0.45 .. ×1.65):
//   Chall #1            → ~180k €  (base 130k, typical multi 1.4)
//   Chall #100          → base 60k
//   Chall #300+         → base 30k (Untergrenze, auch ohne Platz)
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
    // User-Vorgabe 2026-10-04 — Stuetzwerte nur mit Freigabe aendern:
    //   Platz 1 → 130k, Platz 100 → 60k (Kurve, oben steiler),
    //   Platz 100–300 → gerade Linie 60k → 30k,
    //   ab Platz 300 oder ohne Platz → 30k (Spieler, die beim Tageswechsel
    //   aus Challenger fallen).
    return { rated: true, baseValue: challengerBase(playerRank) };
  }

  return { rated: false, baseValue: 0, notRatedReason: 'unknown_tier' };
}

// Challenger-Grundwert nach Tabellenplatz. Siehe Kommentar in computeBaseValue.
export function challengerBase(playerRank?: number | null): number {
  if (!playerRank || playerRank < 1 || playerRank >= 300) return 30000;
  if (playerRank <= 100) return 60000 + 70000 * (1 - Math.pow((playerRank - 1) / 99, 0.6));
  return 60000 - (playerRank - 100) * 150;
}

export const TFT_TIER_VAL = TIER_VAL;

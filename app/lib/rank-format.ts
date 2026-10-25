// Centralized rank formatting. Riot's API always returns rank="I" for
// Challenger / Grandmaster / Master because those tiers have no divisions —
// but blindly rendering "{tier} {rank}" produces "CHALLENGER I", which is
// wrong/misleading. This helper drops the rank string for those three tiers.

export const NO_DIVISION_TIERS: ReadonlySet<string> = new Set([
  'CHALLENGER',
  'GRANDMASTER',
  'MASTER',
]);

// Rangfarben — die EINE Quelle fuer TFT- und LoL-Seiten. Die Abrufskripte der
// Rangverteilung (scripts/fetch-tier-distribution.mjs, scripts/fetch-tft-tier-
// distribution.mjs) fuehren dieselbe Liste; scripts/check-contrast.mjs prueft
// den Gleichlauf und dass jede Farbe als Schrift auf --surface-base >= 4,5:1
// erreicht. Seit 25.10.2026 Iron/Bronze/Silver/Diamond/Master/GM heller
// (vorher #6b6b6b #a0652a #8fa0a8 #576cce #9d48e0 #e44040, 2,9-3,8:1).
export const RANK_TIER_COLOR: Readonly<Record<string, string>> = {
  IRON: '#949494', BRONZE: '#cc843c', SILVER: '#a9b8c0', GOLD: '#c89b3c',
  PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#8090da',
  MASTER: '#b778e8', GRANDMASTER: '#ea6c6c', CHALLENGER: '#f0c040',
};

/** Rangfarbe zu einem Schluessel wie "DIAMOND", "diamond" oder "DIAMOND_PLUS". */
export function rankTierColor(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return RANK_TIER_COLOR[key.toUpperCase().replace(/_PLUS$/, '')];
}

/**
 * Render a rank as "DIAMOND II" / "CHALLENGER" / "GOLD IV" etc.
 * For Challenger / Grandmaster / Master the division is omitted because
 * those tiers don't have divisions.
 */
export function formatTier(
  tier: string | null | undefined,
  rank?: string | null,
): string {
  if (!tier) return '';
  const t = tier.toUpperCase();
  if (NO_DIVISION_TIERS.has(t)) return tier;
  return rank ? `${tier} ${rank}` : tier;
}

export interface SoloRank {
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
}

// Solo-Queue-Eintrag aus einer league-v4-Antwort (Liste je Queue).
export function pickSoloRank(entries: unknown): SoloRank | null {
  if (!Array.isArray(entries)) return null;
  const solo = (entries as Array<SoloRank & { queueType?: string }>).find((r) => r?.queueType === 'RANKED_SOLO_5x5');
  return solo
    ? { tier: solo.tier, rank: solo.rank, leaguePoints: solo.leaguePoints, wins: solo.wins, losses: solo.losses }
    : null;
}

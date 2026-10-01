// Centralized rank formatting. Riot's API always returns rank="I" for
// Challenger / Grandmaster / Master because those tiers have no divisions —
// but blindly rendering "{tier} {rank}" produces "CHALLENGER I", which is
// wrong/misleading. This helper drops the rank string for those three tiers.

export const NO_DIVISION_TIERS: ReadonlySet<string> = new Set([
  'CHALLENGER',
  'GRANDMASTER',
  'MASTER',
]);

// Rangfarben (Werte wie app/tft/player/[slug]/page.tsx TIER_COLORS).
export const RANK_TIER_COLOR: Readonly<Record<string, string>> = {
  IRON: '#6b6b6b', BRONZE: '#a0652a', SILVER: '#8fa0a8', GOLD: '#c89b3c',
  PLATINUM: '#209e85', EMERALD: '#00a86b', DIAMOND: '#576cce',
  MASTER: '#9d48e0', GRANDMASTER: '#e44040', CHALLENGER: '#f0c040',
};

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

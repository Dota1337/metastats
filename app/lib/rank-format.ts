// Centralized rank formatting. Riot's API always returns rank="I" for
// Challenger / Grandmaster / Master because those tiers have no divisions —
// but blindly rendering "{tier} {rank}" produces "CHALLENGER I", which is
// wrong/misleading. This helper drops the rank string for those three tiers.

export const NO_DIVISION_TIERS: ReadonlySet<string> = new Set([
  'CHALLENGER',
  'GRANDMASTER',
  'MASTER',
]);

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

// Rang als fortlaufende Zahl (Leiterpunkte): je Stufe 400 Punkte, je Division
// 100, ab Master teilen sich Master/GM/Challenger eine LP-Leiter auf dem
// Master-Sockel. Eine Quelle fuer den Spielervergleich (model.ts re-exportiert)
// und die Box (Spieler-Bewertung, scripts/lib/tft-player-scoring.mjs). Dieselbe
// Leiter steht als SQL in scripts/lib/tft-rising.mjs (ratingSql) —
// tft-rank-score.test.mjs prueft den Gleichlauf.

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND'];
const DIVS = { IV: 0, III: 1, II: 2, I: 3 };
export const MASTER_BASE = TIERS.length * 400;

/**
 * @param {string | null | undefined} tier
 * @param {string | null | undefined} div
 * @param {number | null | undefined} lp
 * @returns {number | null}
 */
export function rankScore(tier, div, lp) {
  if (!tier) return null;
  const t = tier.toUpperCase();
  if (t === 'MASTER' || t === 'GRANDMASTER' || t === 'CHALLENGER') return MASTER_BASE + (lp ?? 0);
  const i = TIERS.indexOf(t);
  if (i < 0) return null;
  return i * 400 + (DIVS[(div || 'IV').toUpperCase()] ?? 0) * 100 + (lp ?? 0);
}

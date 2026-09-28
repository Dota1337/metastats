// Gemeinsame Regeln fuer gespeicherte Set-Raenge (tft_player_rank_history),
// von Spielerseite und Vergleich genutzt. Bewusst ohne Server-Importe, damit
// Client-Komponenten sie ziehen koennen.

/**
 * dakgg liefert je Set nur den Rang am Set-Ende, nie den Hoechstrang — und
 * ohne LP. MetaTFT liefert den echten Hoechstrang. Die Oberflaeche muss das
 * unterscheiden, sonst steht ein Endrang als "Hoechster Rang" da.
 */
export function isEndRank(row: { source?: string | null }): boolean {
  return row.source === 'dakgg';
}

const TIER_ORDER = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const DIV_ORDER: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };

/** Vergleichswert eines Rangs; -1 fuer unbekannt/Unranked. */
export function rankKey(tier: string | null | undefined, div: string | null | undefined, lp: number | null | undefined): number {
  const i = TIER_ORDER.indexOf((tier || '').toUpperCase());
  if (i < 0) return -1;
  return i * 10000 + (DIV_ORDER[(div || '').toUpperCase()] ?? 0) * 1000 + (lp ?? 0);
}

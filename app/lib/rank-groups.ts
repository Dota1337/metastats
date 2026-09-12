// Einheitliche Rang-Gruppen fuer LoL und TFT (User-Entscheid 2026-09-13):
// Einzel-Master und Einzel-Grandmaster gibt es in keiner Auswahl mehr, dafuer
//   Master+       = Master + Grandmaster + Challenger
//   Grandmaster+  = Grandmaster + Challenger
// Challenger und die Raenge darunter bleiben einzeln waehlbar.
//
// Kein 'use client' und keine Server-Importe: Seiten und API-Routen lesen
// beide aus dieser Datei, damit die Gruppen nicht an sechs Stellen driften.

// TFT schreibt Raenge klein (tft_daily_*.bucket, ?bucket=).
export const TFT_RANK_GROUPS: Record<string, string[]> = {
  master_plus: ['master', 'grandmaster', 'challenger'],
  grandmaster_plus: ['grandmaster', 'challenger'],
};

// LoL und die TFT-Ladder/Marktwert-Routen arbeiten mit Riots Grossschreibung.
export const LOL_RANK_GROUPS: Record<string, string[]> = {
  MASTER_PLUS: ['MASTER', 'GRANDMASTER', 'CHALLENGER'],
  GRANDMASTER_PLUS: ['GRANDMASTER', 'CHALLENGER'],
};

// Reihenfolge der Apex-Ligen von oben, zum Mischen einer Gruppe nach Rang und LP.
export const APEX_ORDER = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

/** Alte Links (?bucket=master / grandmaster) auf die neue Gruppe umbiegen. */
export function legacyTftBucket(b: string): string {
  if (b === 'master') return 'master_plus';
  if (b === 'grandmaster') return 'grandmaster_plus';
  return b;
}

/** Gruppe oder Einzelrang (Grossschreibung) → Liste der Einzelraenge. */
export function expandLolTier(tier: string): string[] {
  const t = tier.toUpperCase();
  return LOL_RANK_GROUPS[t] || [t];
}

export function isLolRankGroup(tier: string): boolean {
  return tier.toUpperCase() in LOL_RANK_GROUPS;
}

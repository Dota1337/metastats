// Einheitliche Rang-Gruppen fuer LoL und TFT.
//   X+ = Rang X und alles darueber bis Challenger (User-Entscheid 2026-09-13).
// Einzel-Master, -Grandmaster, -Diamond, -Emerald und -Platinum gibt es in
// keiner Auswahl mehr. Challenger und Gold abwaerts bleiben einzeln.
//
// Kein 'use client' und keine Server-Importe: Seiten und API-Routen lesen
// beide aus dieser Datei, damit die Gruppen nicht an sechs Stellen driften.

// Die Rangleiter von oben nach unten (Riots Grossschreibung).
export const LOL_LADDER = [
  'CHALLENGER', 'GRANDMASTER', 'MASTER',
  'DIAMOND', 'EMERALD', 'PLATINUM', 'GOLD', 'SILVER', 'BRONZE', 'IRON',
] as const;

// Reihenfolge der Apex-Ligen von oben (eine komplette Liga pro Riot-Abfrage).
export const APEX_ORDER = ['CHALLENGER', 'GRANDMASTER', 'MASTER'];

// Raenge, fuer die es eine X+-Gruppe gibt.
const PLUS_FLOORS = ['GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD', 'PLATINUM'] as const;

// Einzelraenge einer Gruppe, von unten nach oben (Diamond, Master, GM, Challenger).
function plusMembers(floor: string): string[] {
  return LOL_LADDER.slice(0, LOL_LADDER.indexOf(floor as any) + 1).reverse();
}

// LoL und die TFT-Ladder/Marktwert-Routen arbeiten mit Riots Grossschreibung.
export const LOL_RANK_GROUPS: Record<string, string[]> = Object.fromEntries(
  PLUS_FLOORS.map(f => [`${f}_PLUS`, plusMembers(f)]),
);

// TFT schreibt Raenge klein (tft_daily_*.bucket, ?bucket=).
export const TFT_RANK_GROUPS: Record<string, string[]> = Object.fromEntries(
  PLUS_FLOORS.map(f => [`${f.toLowerCase()}_plus`, plusMembers(f).map(t => t.toLowerCase())]),
);

/** Alte Links (?bucket=master / grandmaster) auf die neue Gruppe umbiegen. */
export function legacyTftBucket(b: string): string {
  if (b === 'master') return 'master_plus';
  if (b === 'grandmaster') return 'grandmaster_plus';
  return b;
}

/**
 * Wie legacyTftBucket, zusaetzlich diamond/emerald/platinum → *_plus. Nur fuer
 * die Statistik-Auswahlen, in denen es diese Einzelraenge nicht mehr gibt —
 * die Patch-Seiten fuehren Einzel-Diamond weiter und nutzen legacyTftBucket.
 */
export function tftStatsBucket(b: string): string {
  const v = legacyTftBucket(b);
  const plus = `${v}_plus`;
  return plus in TFT_RANK_GROUPS ? plus : v;
}

/** Gruppe oder Einzelrang (Grossschreibung) → Liste der Einzelraenge. */
export function expandLolTier(tier: string): string[] {
  const t = tier.toUpperCase();
  return LOL_RANK_GROUPS[t] || [t];
}

export function isLolRankGroup(tier: string): boolean {
  return tier.toUpperCase() in LOL_RANK_GROUPS;
}

/** Einzelraenge einer Gruppe (oder der Einzelrang) von oben nach unten. */
export function lolTiersTopDown(tier: string): string[] {
  const members = expandLolTier(tier);
  return LOL_LADDER.filter(t => members.includes(t));
}

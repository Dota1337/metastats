// Tier-Buchstabe (S+/S/A/B/C) fuer Comps-, Units- und Items-Listen, den
// Comps-Atlas, den Detailkopf und die Companion-App.
//
// Seit 20.10.2026 nur noch nach Ø-Platz, mit festen Grenzen vom User:
//   Comps + Units  S+ ≤ 3,99 · S ≤ 4,25 · A ≤ 4,39 · B ≤ 4,79 · C darueber
//   Items          S+ ≤ 3,99 · S ≤ 4,10 · A ≤ 4,24 · B ≤ 4,49 · C darueber
// Items liegen enger beisammen und besser (ein Item-Ø zaehlt je getragenem
// Item, Items stecken meist auf Carries starker Bretter): mit der Comp-Skala
// waeren 54 % S+/S (gemessen 20.10.2026, alle Regionen, Diamond+, 3 Tage).
// Grenzen nie ohne Freigabe des Users aendern.
//
// Vorher: Score aus Ø minus Pickrate-Abschlag mit Grenzen aus
// public/tft-tier-cutoffs.json — 35 von 40 Comps landeten in C/D.
//
// Gerechnet wird mit dem ANGEZEIGTEN Wert (toFixed(2), wie jede Anzeige): ein
// Ø von 4,255 steht als 4,25 da und ist deshalb S, nicht A.

import type { TranslationKey } from './i18n';

export type TierLetter = 'S+' | 'S' | 'A' | 'B' | 'C';
export type EntityKind = 'units' | 'items' | 'comps';

/** Beste zuerst. */
export const TIER_LETTERS: readonly TierLetter[] = ['S+', 'S', 'A', 'B', 'C'];

// Obergrenzen (einschliesslich) in Hundertsteln fuer S+, S, A, B — darueber C.
const UPPER: Record<EntityKind, readonly [number, number, number, number]> = {
  comps: [399, 425, 439, 479],
  units: [399, 425, 439, 479],
  items: [399, 410, 424, 449],
};

/** Darunter kein Buchstabe („—"), Zufallswerte sollen nicht in S+ landen. */
export const TIER_MIN_GAMES: Record<EntityKind, number> = { units: 200, items: 150, comps: 50 };

interface TierInput {
  avgPlacement: number | null | undefined;
  games: number | null | undefined;
}

export function tierLetterOf(input: TierInput, kind: EntityKind): TierLetter | null {
  const avg = input.avgPlacement;
  if (avg == null || !Number.isFinite(avg)) return null;
  if (!((input.games ?? 0) >= TIER_MIN_GAMES[kind])) return null;
  const hundredths = Math.round(Number(avg.toFixed(2)) * 100);
  const [sPlus, s, a, b] = UPPER[kind];
  if (hundredths <= sPlus) return 'S+';
  if (hundredths <= s) return 'S';
  if (hundredths <= a) return 'A';
  if (hundredths <= b) return 'B';
  return 'C';
}

/** Items ohne Buchstaben (User 20.10.2026): Komponenten sind unfertige Items
 *  auf dem Endbrett, Traenke keine echte Item-Wahl — beide alle C bzw. Health
 *  Potion S+ (Ø 2,64), das fuehrte in die Irre. Ø und Spiele bleiben sichtbar. */
export function itemTakesTier(apiName: string, tags?: readonly string[] | null): boolean {
  return !tags?.includes('component') && !/_Component_|Potion/i.test(apiName);
}

/** Tier einer Comp-Familie: dieselben Werte wie die gezeigte Ø-Zahl und Spiele. */
export function familyTierLetter(f: { weightedAvgPlacement: number | null; totalGames: number }): TierLetter | null {
  return tierLetterOf({ avgPlacement: f.weightedAvgPlacement, games: f.totalGames }, 'comps');
}

// Roh-Hexe, bewusst: eine Rang-Leiter. Die Stufen muessen untereinander
// unterscheidbar bleiben und duerfen sich nicht mitbewegen, wenn die
// Text-Token fuer Lesbarkeit nachgezogen werden. S+ Pink (User 20.10.2026):
// weder mit dem Gold von S noch mit dem roten ▼ im Atlas zu verwechseln.
export const TIER_COLORS: Record<TierLetter, string> = {
  'S+': '#f472b6',
  S: '#e0c75a',
  A: '#8a73ff',
  B: '#4a9be6',
  C: '#9aa6b2',
};

/** Farbe ohne Buchstaben (unter der Mindest-Spielzahl). */
export const TIER_NONE_COLOR = '#6e7e94';

export const TIER_TOOLTIP_KEY: Record<TierLetter, TranslationKey> = {
  'S+': 'tft.tier.tooltip.Splus',
  S: 'tft.tier.tooltip.S',
  A: 'tft.tier.tooltip.A',
  B: 'tft.tier.tooltip.B',
  C: 'tft.tier.tooltip.C',
};

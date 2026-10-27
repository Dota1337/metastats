// Stufen und Farben der Trait-Aktivierung — eine Quelle fuer Trait-Liste,
// Trait-Detail, Builder und Match-Ansichten. Ohne Importe, damit
// scripts/check-contrast.mjs die Farbtafel direkt lesen kann. Der Leser sucht
// per Text das erste Vorkommen ihres Namens: er darf davor nicht stehen.
//
// Riot und CommunityDragon zaehlen die Stufen verschieden (gemessen 27.10.2026,
// Box-Stichprobe Set 18, 342.745 aktive Traits, ohne Eclipse 100 % eindeutig):
//
//   Stufe        Riot Match-V1 traits[].style   Bundle tiers[].style (CDragon)
//   Bronze       1                              1
//   Silber       2                              3
//   Einzigartig  3                              4   (Traits mit einer Stufe ab 1 Unit)
//   Gold         4                              5
//   Prismatisch  5                              6
//
// Riot 6 traegt nur DA_18_Eclipse, eine Mechanik ohne Stufen → keine Stufe.
// Riots Doku nennt noch 1–4 (Bronze/Silber/Gold/Chromatic) und ist veraltet.
// Farbe oder Text zu einer Stufe immer ueber traitTierFromRiot /
// traitTierFromBundle, nie direkt ueber die Zahl — beide Reihen sehen gleich
// aus und waren bis 27.10.2026 verwechselt. Waechter: tft-trait-style.test.mjs
// (Bundle-Stile aller Sets, Riot gegen Bundle) und der Vertrag
// tft/trait-style-axis in infra/contracts.json (echte Spiele auf der Box).
//
// Bronze war #a07a4d: als Schrift auf eigener Toenung (0x25) ueber base nur
// 3,38:1. #c0956a hat dort 4,58:1, pur auf base 5,77:1. Einzigartig ist im
// Spiel orange; hier vorerst der Gold-Wert (Farbwahl offen).
// Die Comp-Ansichten haben eine eigene Tafel (activeTraitStyleColor in
// tft-active-traits.ts) fuer Rahmen, Leuchten, Zahl und Ueberschrift — sie
// steht nicht im Kontrast-Waechter.
export type TraitTier = 'bronze' | 'silver' | 'unique' | 'gold' | 'prismatic';

export const TRAIT_STYLE_COLOR: Readonly<Record<TraitTier, string>> = {
  bronze: '#c0956a',
  silver: '#cfd6dc',
  unique: '#e0c75a',
  gold: '#e0c75a',
  prismatic: '#c39bff',
};

const FROM_RIOT: Readonly<Record<number, TraitTier>> = { 1: 'bronze', 2: 'silver', 3: 'unique', 4: 'gold', 5: 'prismatic' };
const FROM_BUNDLE: Readonly<Record<number, TraitTier>> = { 1: 'bronze', 3: 'silver', 4: 'unique', 5: 'gold', 6: 'prismatic' };

/** Riot Match-V1 `traits[].style` → Stufe. 0 (inaktiv), 6 (Eclipse) und Unbekanntes → null. */
export function traitTierFromRiot(style: number | null | undefined): TraitTier | null {
  return (style != null && FROM_RIOT[style]) || null;
}

/** Bundle `tiers[].style` (public/tft-assets-<set>.json, CommunityDragon) → Stufe. Unbekanntes → null. */
export function traitTierFromBundle(style: number | null | undefined): TraitTier | null {
  return (style != null && FROM_BUNDLE[style]) || null;
}

/** Farbe zur Stufe; ohne Stufe der Rueckfall der jeweiligen Ansicht. */
export function traitTierColor(tier: TraitTier | null, fallback: string): string {
  return tier ? TRAIT_STYLE_COLOR[tier] : fallback;
}

// Active-Trait-Aggregation aus comp.typicalUnits — berechnet welche
// Synergien bei den meistgespielten Units aktiv sind, und auf welcher
// Stufe (Bronze/Silber/Einzigartig/Gold/Prismatisch, siehe tft-trait-style.ts).
//
// Wichtige Klassifikations-Befunde (Classification-Reviewer 2026-06-21):
//   - bundle.champions[id].traits[] enthält DISPLAY-NAMES, NICHT apiNames
//   - bundle.traits[apiName] muss daher über Reverse-Lookup gefunden werden
//   - Multi-Variant-Traits (Stargazer-Constellations) teilen denselben
//     display-Namen → Constellation-Variante MUSS aus dem cluster_key
//     (parseClusterKey(comp.clusterKey).trait) bestimmt werden
//   - Bundle-Style ist {1, 3, 4, 5, 6} = Bronze/Silber/Einzigartig/Gold/
//     Prismatisch (NICHT Riots Match-Zaehlung, siehe tft-trait-style.ts)
//   - Tier-less Traits (MFUndetermined, CarouselMarket) müssen geskipt werden
//   - bundle.champions[id]?.traits ?? [] guard für ungeknown Champions

import { findChampion, findTrait, tftTraitDisplayName, type TftAssetsBundle, type TftTrait } from './tft-cdragon';
import { parseClusterKey } from './tft-cluster';
import { traitTierFromBundle, type TraitTier } from './tft-trait-style';

export interface ActiveTrait {
  apiName: string;
  displayName: string;
  icon: string | null;
  count: number;
  style: number;            // Bundle-Style, nur zum Sortieren — Farbe über `tier`
  tier: TraitTier | null;   // Stufe aus `style`
  minUnits: number;         // Schwelle für den aktuellen Style
  nextStyleMinUnits: number | null;  // Schwelle für den nächsthöheren Style (null = max erreicht)
  nextStyle: number | null; // Bundle-Style des nächsten Tiers
  desc?: string;
  // Drill-Down: welche Units tragen zu dieser Trait-Aktivierung bei. stack=2
  // bei TwoTanky-Multiplicity, sonst 1. Reihenfolge entspricht typicalUnits-
  // Reihenfolge (= meist-gespielt zuerst).
  contributingUnits: Array<{ characterId: string; stack: number }>;
}

interface TypicalUnit {
  characterId: string;
  count?: number | unknown;
  multiplicity?: number;
}

// Display-Name → apiName Reverse-Lookup mit Slug-Hint-Disambiguation.
// Bei Multi-Variant-Traits (Stargazer) hat die Constellation aus dem Slug
// Vorrang — sonst pickt der Algorithmus eine zufällige Constellation.
function resolveTraitApiName(
  bundle: TftAssetsBundle,
  displayName: string,
  slugTrait: string | null,
  slugTraitDisplayName: string | null,
): string | null {
  // 1) Slug-Variante hat Vorrang bei Display-Name-Match (Stargazer-Constellation-Disambiguation)
  if (slugTrait && slugTraitDisplayName === displayName) {
    return slugTrait;
  }
  // 2) Reverse-Lookup über alle Traits
  const matches: string[] = [];
  for (const [apiName, trait] of Object.entries(bundle.traits)) {
    if (trait.name === displayName) matches.push(apiName);
  }
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  // 3) Mehrere Matches ohne Slug-Hint: bevorzuge den "Base" (kürzester apiName)
  // — bei Stargazer ohne Slug-Hint nimmt das den base Stargazer ohne Constellation-Suffix
  return matches.sort((a, b) => a.length - b.length)[0];
}

export function computeActiveTraits(
  typicalUnits: TypicalUnit[] | undefined | null,
  clusterKey: string,
  bundle: TftAssetsBundle | null,
): ActiveTrait[] {
  if (!bundle || !typicalUnits || typicalUnits.length === 0) return [];

  const parts = parseClusterKey(clusterKey);
  const slugTrait = parts?.trait || null;
  const slugTraitMeta = slugTrait ? findTrait(bundle, slugTrait) : null;
  const slugTraitDisplayName = slugTraitMeta?.name || null;

  // 1) Pro Unit: aggregiere Trait-Counts + tracke contributing Units pro Trait.
  const traitCounts = new Map<string, number>(); // apiName → count
  const traitContrib = new Map<string, Array<{ characterId: string; stack: number }>>();
  for (const unit of typicalUnits) {
    const champ = findChampion(bundle, unit.characterId);
    const champTraits = champ?.traits ?? [];
    if (champTraits.length === 0) continue;
    // Multiplicity ≥ 1.5 = TwoTanky-Signatur (zweite Brett-Kopie der Unit)
    // → zählt 2× für Trait-Synergie. Bei normalen Units (multiplicity ~1.0) zählt 1×.
    const stack = (unit.multiplicity ?? 1) >= 1.5 ? 2 : 1;
    for (const displayName of champTraits) {
      const apiName = resolveTraitApiName(bundle, displayName, slugTrait, slugTraitDisplayName);
      if (!apiName) continue;
      traitCounts.set(apiName, (traitCounts.get(apiName) || 0) + stack);
      if (!traitContrib.has(apiName)) traitContrib.set(apiName, []);
      traitContrib.get(apiName)!.push({ characterId: unit.characterId, stack });
    }
  }

  // 2) Pro Trait: bestimme aktiven Style
  const active: ActiveTrait[] = [];
  for (const [apiName, count] of traitCounts.entries()) {
    const trait = findTrait(bundle, apiName);
    if (!trait?.tiers || trait.tiers.length === 0) continue; // skip tier-less
    const matchingTiers = trait.tiers.filter(t => count >= t.minUnits);
    if (matchingTiers.length === 0) continue; // nicht aktiv
    const current = matchingTiers.reduce((a, b) => (a.style > b.style ? a : b));
    const higher = trait.tiers
      .filter(t => t.style > current.style)
      .sort((a, b) => a.minUnits - b.minUnits)[0];
    active.push({
      apiName,
      displayName: tftTraitDisplayName(bundle, apiName),
      icon: trait.icon,
      count,
      style: current.style,
      tier: traitTierFromBundle(current.style),
      minUnits: current.minUnits,
      nextStyleMinUnits: higher?.minUnits ?? null,
      nextStyle: higher?.style ?? null,
      desc: trait.desc,
      contributingUnits: traitContrib.get(apiName) || [],
    });
  }

  // 3) Sort: höchste Style zuerst, bei Gleichstand höchster Count
  active.sort((a, b) => {
    if (a.style !== b.style) return b.style - a.style;
    return b.count - a.count;
  });

  return active;
}

// Farben der Comp-Ansichten (Rahmen, Leuchten, Zahl und Überschrift). Eigene
// Töne neben TRAIT_STYLE_COLOR, nicht im Kontrast-Wächter; Einzigartig vorerst
// wie Gold (siehe tft-trait-style.ts).
const COMP_TRAIT_COLOR: Readonly<Record<TraitTier, string>> = {
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  unique: '#e0c75a',
  gold: '#e0c75a',
  prismatic: '#c39bff',
};

export function activeTraitStyleColor(tier: TraitTier | null): string {
  return tier ? COMP_TRAIT_COLOR[tier] : 'var(--fg-faint)';
}

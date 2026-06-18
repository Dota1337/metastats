// Carry+Trait → curated augment list lookup, sourced from tftacademy.com via
// scripts/refresh-comp-augments.mjs + scripts/refresh-comp-slug-map.mjs (the
// latter is editorial-only — slug-to-our-cluster-identity mapping).
//
// Riot stopped exposing `augments` in Match-V1 sometime in 2026 (verified
// 2026-06-18 against 12M cache rows: 0% populated). Statistical augment
// aggregation from player data is therefore dead. We surface curated
// recommendations as a UI section, never as stats.

export interface CompAugmentsBundle {
  set: number;
  source: string;
  fetchedAt: string;
  comps: Record<string, string[]>; // slug → augment apiNames (8 each)
}

export interface SlugMapEntry {
  primaryTrait: string;  // e.g. "TFT17_StargazerVariant" (matches all Mountain/Serpent/...)
  primaryCarry: string;  // e.g. "TFT17_Lulu"
  augmentsRef?: string;  // tftacademy-slug; defaults to map-key
}

export interface CompSlugMap {
  set: number;
  source: string;
  fetchedAt: string;
  slugs: Record<string, SlugMapEntry>;
}

let cached: Promise<{ augs: CompAugmentsBundle | null; map: CompSlugMap | null }> | null = null;

export function loadCompAugmentsBundle(): Promise<{ augs: CompAugmentsBundle | null; map: CompSlugMap | null }> {
  if (!cached) {
    cached = Promise.all([
      fetch('/tft-comp-augments-17.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/tft-comp-slug-map-17.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([augs, map]) => ({ augs, map }));
  }
  return cached;
}

// Reverse-lookup: from a comp's cluster_key parts (trait + carry) → curated
// augment list. Returns null when no editorial mapping exists for this comp
// — the UI must NOT render an empty section in that case
// (`feedback_no_info_texts` user rule: no explanatory empty-state text).
export function findCompAugments(
  bundle: { augs: CompAugmentsBundle | null; map: CompSlugMap | null } | null,
  parts: { trait: string; carry: string } | null,
): string[] | null {
  if (!bundle?.augs || !bundle?.map || !parts) return null;
  for (const [slug, entry] of Object.entries(bundle.map.slugs)) {
    const traitMatch =
      parts.trait === entry.primaryTrait
      || parts.trait.startsWith(entry.primaryTrait + '_')
      || entry.primaryTrait.startsWith(parts.trait + '_');
    if (!traitMatch) continue;
    if (parts.carry !== entry.primaryCarry) continue;
    const ref = entry.augmentsRef || slug;
    return bundle.augs.comps[ref] || null;
  }
  return null;
}

// Tier-Border-Color for an augment apiName by lookup into the existing
// tft-augment-tiers-17.json override file (loaded separately via the asset
// bundle's `augments[apiName].tier` field — fetch-tft-assets writes the
// override there). Returns null for unknown augments.
export function augmentTierBorderColor(tier: number | null | undefined): string {
  switch (tier) {
    case 1: return '#9aa5b4';        // Silver
    case 2: return '#e0c75a';        // Gold
    case 3: return '#c39bff';        // Prismatic
    default: return '#1e2a3a';
  }
}

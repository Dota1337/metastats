// Comp-Guide Reader — curated build data from tftacademy.com per cluster
// family. Sourced via scripts/refresh-comp-augments.mjs which parses the
// SvelteKit hydration data island into a typed JSON blob.
//
// Why curated, not statistical: Riot stopped exposing `augments` in
// Match-V1 sometime in 2026 (verified 2026-06-18 across 12M cache rows:
// 0% populated). Statistical aggregation from player data is dead.

export type AugmentGroup = 'ECON' | 'ITEMS' | 'COMBAT' | 'EMBLEM' | 'HERO';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD' | 'CONDITIONAL';

export interface EarlyChampion {
  apiName: string;
  items: string[];   // item apiNames; usually empty for early units
  stars: number;     // 1-3
}

export interface StageTip {
  stage: string;     // e.g. "Stage 2"
  tip: string;
}

export interface CompGuide {
  title: string;
  difficulty: Difficulty | null;
  updated: string | null;
  augments: string[];           // 0-8 augment apiNames, slot-ordered
  augmentTypes: AugmentGroup[]; // parallel to augments, empty when mismatched
  augmentsTip: string;
  carousel: string[];           // round-1 item apiNames
  earlyComp: EarlyChampion[];   // 0-4 champions
  tips: StageTip[];             // 0-N stage tips
}

export interface CompGuidesBundle {
  set: number;
  source: string;
  fetchedAt: string;
  comps: Record<string, CompGuide>;
}

export interface SlugMapEntry {
  primaryTrait: string;
  primaryCarry: string;
  augmentsRef?: string;
}

export interface CompSlugMap {
  set: number;
  source: string;
  fetchedAt: string;
  slugs: Record<string, SlugMapEntry>;
}

let cached: Promise<{ guides: CompGuidesBundle | null; map: CompSlugMap | null }> | null = null;

export function loadCompGuidesBundle(): Promise<{ guides: CompGuidesBundle | null; map: CompSlugMap | null }> {
  if (!cached) {
    cached = Promise.all([
      fetch('/tft-comp-guides-17.json').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/tft-comp-slug-map-17.json').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([guides, map]) => ({ guides, map }));
  }
  return cached;
}

// Reverse-lookup: cluster-key parts → curated guide. Returns null when no
// editorial slug-map entry matches the family — UI must NOT render an
// empty section (`feedback_no_info_texts`).
export function findCompGuide(
  bundle: { guides: CompGuidesBundle | null; map: CompSlugMap | null } | null,
  parts: { trait: string; carry: string } | null,
): { slug: string; guide: CompGuide } | null {
  if (!bundle?.guides || !bundle?.map || !parts) return null;
  for (const [slug, entry] of Object.entries(bundle.map.slugs)) {
    const traitMatch =
      parts.trait === entry.primaryTrait
      || parts.trait.startsWith(entry.primaryTrait + '_')
      || entry.primaryTrait.startsWith(parts.trait + '_');
    if (!traitMatch) continue;
    if (parts.carry !== entry.primaryCarry) continue;
    const ref = entry.augmentsRef || slug;
    const guide = bundle.guides.comps[ref];
    if (guide) return { slug: ref, guide };
  }
  return null;
}

// Tier-Border-Color for an augment by Silver/Gold/Prismatic tier (read from
// bundle.augments[apiName].tier — set by fetch-tft-assets's deriveAugmentTier
// + tactics.tools override). Returns the surface-neutral border when unknown.
export function augmentTierBorderColor(tier: number | null | undefined): string {
  switch (tier) {
    case 1: return '#9aa5b4';   // Silver
    case 2: return '#e0c75a';   // Gold
    case 3: return '#c39bff';   // Prismatic
    default: return '#1e2a3a';
  }
}

// Group augments by their tftacademy-curated slot label, preserving the
// curator's slot order (Stage 2-1 → 3-2 → 4-2). The label-order is
// comp-specific: one comp may go ECON→ITEMS→COMBAT, another HERO→ITEMS→ECON
// — the round-augment slot is the load-bearing axis, not the label.
//
// Returns an empty array when augmentTypes is missing or length-mismatched
// (UI then renders flat without slot grouping).
export function groupAugmentsBySlot(guide: CompGuide): Array<{ label: AugmentGroup; augments: string[] }> {
  if (guide.augmentTypes.length !== guide.augments.length || guide.augments.length === 0) return [];
  const out: Array<{ label: AugmentGroup; augments: string[] }> = [];
  for (let i = 0; i < guide.augments.length; i++) {
    const label = guide.augmentTypes[i];
    const last = out[out.length - 1];
    if (last && last.label === label) {
      last.augments.push(guide.augments[i]);
    } else {
      out.push({ label, augments: [guide.augments[i]] });
    }
  }
  return out;
}

// Difficulty color mapping for the badge.
export function difficultyColor(d: Difficulty | null): string {
  switch (d) {
    case 'EASY': return '#3ecf8e';
    case 'MEDIUM': return '#e0c75a';
    case 'HARD': return '#e44040';
    case 'CONDITIONAL': return '#c39bff';
    default: return '#5a6a80';
  }
}

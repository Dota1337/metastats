import type { TftAssetsBundle } from './tft-cdragon';

export type ItemBucket = 'standard' | 'artifact' | 'emblem' | 'radiant' | 'other';

export const ITEM_BUCKETS: readonly ItemBucket[] = ['standard', 'artifact', 'emblem', 'radiant'] as const;

// Stable classification for the items-list filter. Patterns + composition
// length, NOT name-heuristic. Order matters: Artifact > Emblem > Radiant >
// Standard > Other. PsyOps_*_Radiant and Anima*_RadiantField fall into
// "radiant" (they ARE the trait-radiants in Set 17). PsyOps base items and
// AnimaSquad tier items without "Radiant" suffix end up in "other" —
// acceptable for a top-level filter; users can still reach them via "all".
export function itemBucketOf(apiName: string, assets: TftAssetsBundle | null): ItemBucket {
  const meta = assets?.items[apiName];
  // Set-agnostisch, und zwar ohne das Segment `_Item_`: Set 18 hat nicht nur
  // das Praefix getauscht, sondern die ganze ID-Form. Gemessen am 2026-09-08
  // in public/tft-assets-18.json: `_Item_Artifact_` trifft 1 von 29 aktiven
  // Artefakten, `_Artifact_` trifft alle 29 (DA_Artifact_WitsEnd,
  // DA_Artifact_ZhonyasParadox, ...). Set 17 bleibt bitgleich bei 31.
  //
  // Der Unterstrich am ENDE ist Pflicht: ohne ihn faengt das Muster auch
  // DA_Artifactinate18 — die Set-18-Spielmechanik, kein Gegenstand.
  if (/_Artifact_/i.test(apiName)) return 'artifact';
  const name = meta?.name || '';
  const isEmblem =
    /EmblemItem$/.test(apiName) ||
    / Emblem$/.test(name) ||
    (Array.isArray(meta?.tags) && meta!.tags!.some(t => String(t).toLowerCase() === 'emblem'));
  if (isEmblem) return 'emblem';
  if (/Radiant$/.test(apiName) || /\bRadiant\b/.test(name)) return 'radiant';
  if (Array.isArray(meta?.composition) && meta!.composition!.length === 2) return 'standard';
  return 'other';
}

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
  // Set-agnostisch: das Praefix wechselt pro Set. Set 17 fuehrt
  // TFT17_Item_Artifact_* und TFT_Item_Artifact_*, Set 18 zusaetzlich
  // DA_Item_Artifact_*. Im Bundle am 2026-08-26 gemessen: Praefixe
  // TFT17, TFT, DA ueber 47 Artefakte. Das alte /^TFT\d*_/ liess die
  // DA_-Artefakte still in den Bucket "other" fallen.
  if (/^[A-Za-z]+\d*_Item_Artifact_/i.test(apiName)) return 'artifact';
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

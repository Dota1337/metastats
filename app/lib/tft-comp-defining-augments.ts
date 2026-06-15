// TS-Mirror von scripts/lib/tft-comp-defining-augments.mjs — die mjs-Datei
// ist Source-of-Truth (wird vom Aggregator auf der Hetzner-Box importiert).
// Bei Änderungen BEIDE Dateien synchron halten.

export const COMP_DEFINING_AUGMENTS = new Map<string, string>([
  ['TFT_Augment_TwoTanky', 'TwoTanky'],
  ['TFT_Augment_TwoMuchValue', 'TwoMuchValue'],
  ['TFT_Augment_TwoTrick', 'TwoTrick'],
]);

export function compDefiningAugmentSlug(augments: readonly string[] | null | undefined): string | null {
  if (!Array.isArray(augments)) return null;
  for (const a of augments) {
    if (!a) continue;
    const slug = COMP_DEFINING_AUGMENTS.get(a);
    if (slug) return slug;
  }
  return null;
}

/**
 * Reverse-lookup: aus dem Sub-Cluster-Slug die ursprüngliche Augment-ApiName,
 * die das Frontend benötigt, um den lesbaren Namen aus dem CDragon-Bundle
 * zu lesen (assets.items[apiName].name).
 */
export function compDefiningAugmentApiNameFromSlug(slug: string): string | null {
  for (const [apiName, s] of COMP_DEFINING_AUGMENTS) {
    if (s === slug) return apiName;
  }
  return null;
}

// TS-Mirror von scripts/lib/tft-comp-defining-augments.mjs — die mjs-Datei
// ist Source-of-Truth (wird vom Aggregator auf der Hetzner-Box importiert).
// Bei Änderungen BEIDE Dateien synchron halten.

export const COMP_DEFINING_AUGMENTS = new Map<string, string>([
  ['TFT_Augment_TwoTanky', 'TwoTanky'],
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
 * Anzeige-Filter: ~TwoTanky wurde bis 2026-09-13 aus doppelten Einheiten
 * geraten (Riot liefert keine Augments mehr). Alte Cluster-Keys tragen den
 * Suffix noch, das Etikett ist aber falsch — daher nie anzeigen.
 */
export function shownAugmentSlug(slug: string | null | undefined): string | null {
  return slug && slug !== 'TwoTanky' ? slug : null;
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

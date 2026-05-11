// IDs that show up in the raw Riot match data but are NOT meaningful
// gameplay entities — they're internal placeholders, summoned helpers,
// or empty-state stand-ins. If we leave them in, they pollute the
// leaderboards (e.g. Bard's follower NPC appearing as "most-played unit"
// because it spawns in every Bard game).

// Comparison is case-insensitive — Riot occasionally returns the same
// id with different casing across endpoints.
const EXCLUDED_UNITS_LOWER: ReadonlySet<string> = new Set([
  'tft17_bardfollower', // Bard's spawned helper, not a draftable unit
]);

const EXCLUDED_ITEMS_LOWER: ReadonlySet<string> = new Set([
  'tft_item_emptybag', // empty-bag placeholder
]);

export function isExcludedUnit(characterId: string | null | undefined): boolean {
  return !!characterId && EXCLUDED_UNITS_LOWER.has(characterId.toLowerCase());
}

export function isExcludedItem(apiName: string | null | undefined): boolean {
  return !!apiName && EXCLUDED_ITEMS_LOWER.has(apiName.toLowerCase());
}

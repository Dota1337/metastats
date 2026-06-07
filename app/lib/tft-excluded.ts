// IDs that show up in the raw Riot match data but are NOT meaningful
// gameplay entities — they're internal placeholders, summoned helpers,
// PvE encounters, or empty-state stand-ins. If we leave them in, they
// pollute the leaderboards (e.g. Bard's follower NPC appearing as
// "most-played unit" because it spawns in every Bard game; Apex
// Primordian / Mini Black Hole / Ivern Minion appearing in comp
// classifications).

// Pattern-based exclude — catches the structural categories at any
// set number, no need to enumerate every single id:
//   PVE_*          — PvE-Encounter rewards (e.g. PVE_ElderDragon)
//   Enemy_*        — Encounter boss spawns (Apex Primordian = Enemy_Aatrox)
//   *Minion        — summoned helpers (Ivern's Minion, Bard's …)
//   *Follower      — Bard's BardFollower, generic followers
//   FakeUnit       — Dark Star Mini Black Hole etc.
const EXCLUDED_UNIT_PATTERN = /^tft\d+_(pve_|enemy_|.*minion$|.*follower$|.*fakeunit$)/i;

// Explicit overrides for ids that don't match the pattern but should
// still be filtered. Lowercase comparison.
const EXCLUDED_UNITS_LOWER: ReadonlySet<string> = new Set<string>([
  // kept for stable-id overrides only; the regex above covers the bulk.
]);

const EXCLUDED_ITEMS_LOWER: ReadonlySet<string> = new Set([
  'tft_item_emptybag', // empty-bag placeholder
]);

export function isExcludedUnit(characterId: string | null | undefined): boolean {
  if (!characterId) return false;
  const lower = characterId.toLowerCase();
  return EXCLUDED_UNITS_LOWER.has(lower) || EXCLUDED_UNIT_PATTERN.test(lower);
}

export function isExcludedItem(apiName: string | null | undefined): boolean {
  return !!apiName && EXCLUDED_ITEMS_LOWER.has(apiName.toLowerCase());
}

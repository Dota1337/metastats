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

// Pattern-Filter für Items die nicht auf "best items" Listen gehören. Aktuell
// nur Thief's Gloves in allen Varianten (Basis, Radiant, Shadow, Support,
// Assist-Pickup) — das Item rolld pro Runde völlig zufällige Items und wäre
// als "Top-Build" deshalb nur Lärm statt Signal. Die User-Vorgabe: "Top Item-
// Builds müssen die besten/meistgespielten Items zeigen, nicht Random-Pulls."
const EXCLUDED_ITEM_PATTERN = /thiefsgloves/i;

export function isExcludedUnit(characterId: string | null | undefined): boolean {
  if (!characterId) return false;
  const lower = characterId.toLowerCase();
  return EXCLUDED_UNITS_LOWER.has(lower) || EXCLUDED_UNIT_PATTERN.test(lower);
}

export function isExcludedItem(apiName: string | null | undefined): boolean {
  if (!apiName) return false;
  const lower = apiName.toLowerCase();
  return EXCLUDED_ITEMS_LOWER.has(lower) || EXCLUDED_ITEM_PATTERN.test(lower);
}

// Für Item-Sets (Carry-Builds = mehrere Items zusammen). Wenn auch nur ein
// Item im Set excluded ist, fliegt das ganze Set raus — denn ein Build mit
// Thief's Gloves drin ist kein zielführender Build, sondern ein zufälliger
// Snapshot. Wird in der API verwendet wo `topItemSets` und `carryItems`
// gerendert werden.
export function setContainsExcludedItem(items: string[] | null | undefined): boolean {
  if (!items?.length) return false;
  for (const it of items) if (isExcludedItem(it)) return true;
  return false;
}

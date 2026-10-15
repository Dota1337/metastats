// Build-Gruppen der Varianten (User-Override C, 2026-06-21): Sub-Cluster einer
// Familie mit denselben Units sind EINE Variante mit gewichteten Zahlen.
// Eine Regel fuer die Knopf-Zahlen (/api/tft/comps/variants) und die genaue
// Ansicht, die der Knopf oeffnet (/api/tft/comps?variant=<Kennung>) — liefen
// die beiden auseinander, zeigte der Knopf andere Zahlen als die Seite nach
// dem Klick.
//
// Unit zaehlt mit, wenn sie in mindestens 15 % der Spiele steht (mind. 3) —
// seltene Tech-Picks sollen die Gruppe nicht aufspalten.

const EMPTY = '~empty~';

/** Gruppen-Schluessel: sortierte characterIds mit ausreichendem Anteil. */
export function compBuildHash(unitCounts: Iterable<readonly [string, number]>, games: number): string {
  if (!(games > 0)) return EMPTY;
  const minCo = Math.max(3, Math.floor(games * 0.15));
  const ids = [...unitCounts]
    .filter(([, c]) => c >= minCo)
    .map(([id]) => id)
    .sort();
  return ids.length > 0 ? ids.join('|') : EMPTY;
}

/** Zaehlt characterId → count ueber Tages-Arrays ({characterId, count}). */
export function addUnitCounts(into: Map<string, number>, units: unknown): void {
  if (!Array.isArray(units)) return;
  for (const u of units) {
    const id = (u as { characterId?: unknown })?.characterId;
    if (typeof id !== 'string' || !id) continue;
    into.set(id, (into.get(id) ?? 0) + Number((u as { count?: unknown })?.count || 0));
  }
}

/**
 * Mitglieder der Build-Gruppe von `key` unter `rows` (Zeilen EINER Familie,
 * Units je Zeile als Liste von Tages-Arrays). `key` steht immer vorn; ohne
 * eigene Zeile nur `key` selbst.
 */
export function buildGroupMembers<T>(
  rows: T[],
  key: string,
  keyOf: (r: T) => string,
  gamesOf: (r: T) => number,
  unitDaysOf: (r: T) => unknown[],
): string[] {
  const hashOf = (r: T) => {
    const counts = new Map<string, number>();
    for (const day of unitDaysOf(r)) addUnitCounts(counts, day);
    return compBuildHash(counts, gamesOf(r));
  };
  const own = rows.find(r => keyOf(r) === key);
  if (!own) return [key];
  const h = hashOf(own);
  return [key, ...rows.filter(r => keyOf(r) !== key && hashOf(r) === h).map(keyOf)];
}

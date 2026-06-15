// Zentrale Helper für Cluster-Key-Parsing + Aggregat-Dedup. Wird von allen
// Pages benutzt, die Comp-Cluster-Keys anzeigen (Detail-Counters, Meta-Pulse-
// Listen, Patch-Winners etc.). Single-Source-of-Truth statt jede Page ihren
// eigenen parseClusterKey zu wartet.

export interface ClusterKeyParts {
  trait: string;
  level: number;
  carry: string;
  carryStar: number;
  augmentSlug: string | null;
  secondary: string | null;
}

/** Vollständiges Cluster-Key-Parsing inkl. aller Sub-Cluster-Suffixe:
 *    *N      = N-Star-Carry-Variante
 *    ~<slug> = comp-definierendes Augment (~TwoTanky)
 *    #<id>   = Secondary-Damage-Carry
 */
export function parseClusterKey(key: string): ClusterKeyParts | null {
  if (!key) return null;
  const m = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/.exec(key);
  if (!m) return null;
  return {
    trait: m[1],
    level: Number(m[2]),
    carry: m[3],
    carryStar: m[4] ? Number(m[4]) : 2,
    augmentSlug: m[5] || null,
    secondary: m[6] || null,
  };
}

/** Reduziert den clusterKey auf die "Primary"-Identität: Trait + Carry +
 *  Carry-Star + Augment. Secondary-Carry-Suffix wird abgeknippt. Ergibt den
 *  Group-Key für Dedup in Aggregat-Sichten (Counters, Trending, Patch-Mover).
 */
export function primaryClusterKey(clusterKey: string): string {
  const parts = parseClusterKey(clusterKey);
  if (!parts) return clusterKey;
  const star = parts.carryStar === 3 ? '*3' : '';
  const aug = parts.augmentSlug ? `~${parts.augmentSlug}` : '';
  return `${parts.trait}@${parts.level}_${parts.carry}${star}${aug}`;
}

/** Generischer Dedup-Reducer für Aggregat-Listen mit Cluster-Keys. Gruppiert
 *  Einträge nach `primaryClusterKey()`; pro Gruppe wird der Eintrag mit der
 *  höchsten `weight` (typisch Spielanzahl) als Repräsentant behalten und alle
 *  metric-Felder via `merge`-Callback zusammengeführt (z.B. weighted Win-Rate
 *  oder summierte games).
 */
export function dedupeByPrimaryCluster<T>(
  items: T[],
  getKey: (item: T) => string,
  getWeight: (item: T) => number,
  merge: (group: T[]) => T,
): T[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const primary = primaryClusterKey(getKey(it));
    if (!groups.has(primary)) groups.set(primary, []);
    groups.get(primary)!.push(it);
  }
  const out: T[] = [];
  for (const group of groups.values()) {
    if (group.length === 1) out.push(group[0]);
    else out.push(merge(group));
  }
  out.sort((a, b) => getWeight(b) - getWeight(a));
  return out;
}

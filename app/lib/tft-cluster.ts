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

/** Reduziert den clusterKey auf die "Family"-Identität: Trait + Level + Carry,
 *  ohne irgendwelche Sub-Cluster-Suffixe (`*N`, `~aug`, `#secondary`). Ergibt
 *  den Aufhänger für den Variants-Switcher — alle Cluster mit gleicher Family
 *  sind Geschwister (Reroll, Push, Dual-Carry-Variants, Augment-Variants).
 *
 *  Beispiele:
 *    `TFT17_Stargazer@8_TFT17_Lulu*3#TFT17_Milio` → `TFT17_Stargazer@8_TFT17_Lulu`
 *    `TFT17_SpaceGroove@3_TFT17_Samira#TFT17_Nami` → `TFT17_SpaceGroove@3_TFT17_Samira`
 */
export function compFamilyKey(clusterKey: string): string {
  const parts = parseClusterKey(clusterKey);
  if (!parts) return clusterKey;
  return `${parts.trait}@${parts.level}_${parts.carry}`;
}

/** Reduziert den clusterKey auf die TRAIT+CARRY-Family-Identität.
 *  Alle Level-Varianten, Star-Varianten, Augment-Sub-Cluster und Secondary-
 *  Carry-Varianten desselben Trait+Carry-Paares landen in derselben Family.
 *  Genutzt für die Comp-Liste mit Drop-Down — User-Vorgabe 2026-06-20:
 *  „2 Stargazer-Mountain-Lulu-Comps, die sich nur durch 1 Unit auf Lvl 9
 *  unterscheiden" müssen in eine Card.
 *
 *  Star wird absichtlich NICHT in den Key aufgenommen (data-skeptic-Verdict
 *  2026-06-20: Carry-Star ist im byComp-Snapshot nicht stabil ableitbar).
 *
 *  Beispiele:
 *    `TFT17_Stargazer_Mountain@8_TFT17_Lulu*3#TFT17_Milio` → `TFT17_Stargazer_Mountain__TFT17_Lulu`
 *    `TFT17_Stargazer_Mountain@9_TFT17_Lulu*3` → `TFT17_Stargazer_Mountain__TFT17_Lulu`
 *    `TFT17_SpaceGroove@3_TFT17_Samira~TwoTanky` → `TFT17_SpaceGroove__TFT17_Samira`
 *
 *  Doppel-Underscore als Separator vermeidet Kollisionen mit Trait-Namen, die
 *  selbst Underscores enthalten (z.B. `TFT17_Stargazer_Mountain`).
 */
export function compTraitFamilyKey(clusterKey: string): string {
  const parts = parseClusterKey(clusterKey);
  if (!parts) return clusterKey;
  return `${parts.trait}__${parts.carry}`;
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

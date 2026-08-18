// Family-Merge für die Comp-Detail-Page. Aggregiert mehrere Sub-Cluster der
// gleichen `compFamilyKey + augmentSlug`-Familie zu einem synthetischen
// CompRow, der dann normal durch `baseComp`+`enrichComp` läuft.
//
// Warum eigenes Modul (architect F3, 2026-06-20):
// - `route.ts` ist bereits 900+ Zeilen und enthält keinen Multi-Row-Merge-
//   Pattern. Inline-Logik würde den Detail-Branch um ~150 Zeilen aufblasen.
// - Modul ist unit-testbar isoliert ohne Next.js-Request-Setup.
// - Pattern-Grenze klar: enrichComp arbeitet auf EINEM Row; mergeFamilyRows
//   produziert genau diesen einen Row aus N Family-Members.
//
// Family-Definition (data-skeptic Real-Probe 2026-06-20):
//   Family = alle Sub-Cluster mit gleichem `compFamilyKey` (= <trait>@<level>
//   _<carry>) UND gleichem `augmentSlug` (oder beide ohne).
//   Star (*N) + Secondary (#X) werden konsolidiert.
//   Level (@N) bleibt SEPARAT — wegen statistischer Trennung von Reroll-
//   (@2-3) vs Push- (@4-5) vs Singleton- (@1) Strategien. Astronaut-Gnar-
//   Probe zeigte Avg-Spread 1.15 (@4*3) vs 7.26 (@1) — Sum-Mittelung würde
//   den Skill-Win der Reroll-Variante verstecken.
//
// Outcome-Reconstruction:
//   carry_star_dist + contested_dist bleiben dict-merged → der carryStar-
//   Outcome-Block in enrichComp zeigt nach dem Merge weiter sauber die *2/*3-
//   Splits, weil das die Sub-Cluster jeweils selbst trugen.

import { parseClusterKey } from './tft-cluster';

export interface CompRowLike {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  sum_level: number;
  sum_last_round: number;
  sum_players_eliminated: number;
  sum_gold_left: number;
  participants: number;
  typical_units_merged: any[][];
  typical_augments_merged: any[][];
  carry_items_merged: any[][];
  last_round_dist_merged: any[] | null;
  top4_by_round_merged: any[] | null;
  level_dist_merged: any[] | null;
  level_sum_last_round_merged: any[] | null;
  carry_star_dist_merged: any[] | null;
  contested_dist_merged: any[] | null;
  bucket_breakdown: Record<string, { games: number; sum_placement: number }> | null;
}

/** Familien-Identität für den Detail-Merge: `<trait>__<carry>` (User-Entscheid
 *  2026-06-21 / Option C). Level UND Augment werden konsolidiert. Die
 *  Skill-Ceiling-Strategie bleibt sichtbar via VariantsSwitcher (Sub-Cluster
 *  individuell klickbar), via `?variant=exact` (isolierte mainComp-Stats),
 *  und via `levelOutcome`-Block in Detail-Page (rekonstruiert aus
 *  level_dist_merged). Vorher (bis 2026-06-20): `<trait>@<level>_<carry>~aug`.
 *  Anker-Slug bestimmt die Familie — alle Rows die diesen Key matchen sind
 *  Geschwister.
 */
export function familyKeyForMerge(clusterKey: string): string {
  const parts = parseClusterKey(clusterKey);
  if (!parts) return clusterKey;
  return `${parts.trait}__${parts.carry}`;
}

/** Filtert aus dem RPC-Result alle Family-Members für den Anker-Slug.
 *  Reihenfolge: games desc (für Anker-Default + Multiplicity-Tie-Breaks).
 */
export function selectFamilyMembers<T extends { cluster_key: string; games: number }>(
  allRows: T[],
  anchorSlug: string,
): T[] {
  const target = familyKeyForMerge(anchorSlug);
  return allRows
    .filter(r => familyKeyForMerge(r.cluster_key) === target)
    .sort((a, b) => Number(b.games) - Number(a.games));
}

/** Mergt eine Liste von Family-Member-Rows zu einem synthetischen Aggregat-
 *  Row. Top-Level-Counts werden summiert, JSONB-Arrays werden konkateniert
 *  (mergeJsonbCountArrays/Dicts in route.ts schluckt das durch ohne Re-Wrap).
 *  bucket_breakdown wird per-Bucket-Key gemergt.
 *
 *  Cluster_key des Aggregats = der games-stärkste Sub-Cluster (= Anker-
 *  Default). Damit bleiben Cluster-Key-abhängige Derives (carry, secondary,
 *  carryStar im Cluster-Key) auf der dominanten Variante.
 */
export function mergeFamilyRows(members: CompRowLike[]): CompRowLike {
  if (members.length === 0) {
    throw new Error('mergeFamilyRows: empty member list');
  }
  if (members.length === 1) {
    return members[0];
  }
  // Sortieren um den Anker (games desc) deterministisch zu bestimmen.
  const sorted = [...members].sort((a, b) => Number(b.games) - Number(a.games));
  const anchor = sorted[0];

  const sumNum = (key: keyof CompRowLike): number =>
    sorted.reduce((s, r) => s + Number((r[key] as number | null) ?? 0), 0);

  // JSONB-Array-Konkatenation. mergeJsonbCountArrays nimmt arrays[][] und merget
  // intra-array per-key; wenn wir mehrere Family-Rows haben, ziehen wir alle
  // per-day jsonb-arrays in einen großen Pool — der Merger summiert dann über
  // Day-Granularität UND Sub-Cluster-Granularität.
  const concatArrays = (key: keyof CompRowLike): any[][] => {
    const out: any[][] = [];
    for (const r of sorted) {
      const v = r[key] as any;
      if (Array.isArray(v)) {
        for (const inner of v) {
          if (Array.isArray(inner)) out.push(inner);
        }
      }
    }
    return out;
  };

  // jsonb-Dict-Arrays (carry_star_dist_merged & contested_dist_merged) sind
  // already arrays of dicts (1 dict pro day). Konkatenieren reicht — der
  // Dict-Merger summiert per-Key.
  const concatDictArrays = (key: keyof CompRowLike): any[] | null => {
    const out: any[] = [];
    let any = false;
    for (const r of sorted) {
      const v = r[key] as any;
      if (Array.isArray(v)) {
        any = true;
        for (const d of v) {
          if (d) out.push(d);
        }
      }
    }
    return any ? out : null;
  };

  // bucket_breakdown ist ein single Object pro Row mit { bucketKey:
  // { games, sum_placement } }. Wir summieren per-Bucket über alle Members.
  const mergeBucketBreakdown = (): CompRowLike['bucket_breakdown'] => {
    const out: Record<string, { games: number; sum_placement: number }> = {};
    let any = false;
    for (const r of sorted) {
      if (!r.bucket_breakdown) continue;
      for (const [bk, v] of Object.entries(r.bucket_breakdown)) {
        if (!v) continue;
        any = true;
        const cur = out[bk] || { games: 0, sum_placement: 0 };
        cur.games += Number(v.games ?? 0);
        cur.sum_placement += Number(v.sum_placement ?? 0);
        out[bk] = cur;
      }
    }
    return any ? out : null;
  };

  return {
    cluster_key: anchor.cluster_key,
    games: sumNum('games'),
    sum_placement: sumNum('sum_placement'),
    top4: sumNum('top4'),
    top1: sumNum('top1'),
    sum_level: sumNum('sum_level'),
    sum_last_round: sumNum('sum_last_round'),
    sum_players_eliminated: sumNum('sum_players_eliminated'),
    sum_gold_left: sumNum('sum_gold_left'),
    // participants ist pro-RPC ein constanter Wert (Window-Total) → erster Row.
    participants: Number(anchor.participants) || 0,
    typical_units_merged: concatArrays('typical_units_merged'),
    typical_augments_merged: concatArrays('typical_augments_merged'),
    carry_items_merged: concatArrays('carry_items_merged'),
    last_round_dist_merged: concatDictArrays('last_round_dist_merged'),
    top4_by_round_merged: concatDictArrays('top4_by_round_merged'),
    level_dist_merged: concatDictArrays('level_dist_merged'),
    level_sum_last_round_merged: concatDictArrays('level_sum_last_round_merged'),
    carry_star_dist_merged: concatDictArrays('carry_star_dist_merged'),
    contested_dist_merged: concatDictArrays('contested_dist_merged'),
    bucket_breakdown: mergeBucketBreakdown(),
  };
}

/** Setzt `multiplicity` der gemergten Units auf den Wert des Anker-Sub-Clusters.
 *
 *  Warum eine Ausnahme vom Family-Merge (2026-08-18): `multiplicity` ist keine
 *  Erfolgsrate, sondern eine STRUKTURELLE Eigenschaft der Variante — „gehoeren
 *  zwei Ornn aufs Board?". Der Family-Merge konsolidiert Level UND Augment
 *  (Entscheid C), also faellt `~TwoTanky` mit den Geschwistern ohne Doppel-Unit
 *  in einen Topf: gemessen sank Ornn von 1,94 auf 1,44 und damit unter die
 *  1,5-Schwelle, die das ×2-Abzeichen (CompRow/CompCard) und den Trait-Stack in
 *  `tft-active-traits.ts` steuert. Die Listen-Card zeigt an derselben Stelle die
 *  Units des Ankers (`app/tft/comps/page.tsx` ueberschreibt nur die Skalare mit
 *  Family-Werten) — die beiden Flaechen widersprachen sich also sichtbar.
 *
 *  Dieselbe Ausnahme gilt hier schon fuer alle Cluster-Key-Derives (carry,
 *  secondary, carryStar): sie bleiben auf der dominanten Variante. `multiplicity`
 *  gehoert in genau diese Klasse.
 *
 *  Units, die der Anker gar nicht kennt, verlieren das Feld — ein Family-Wert
 *  waere dort eine andere Bezugsmenge als bei allen uebrigen Units.
 *  Mutiert `units` in-place und gibt dieselbe Referenz zurueck.
 */
export function applyAnchorMultiplicity<T extends Record<string, any>>(
  units: T[],
  anchorUnits: Array<Record<string, any>>,
): T[] {
  const byId = new Map<string, number | undefined>();
  for (const a of anchorUnits) {
    if (a && typeof a.characterId === 'string') byId.set(a.characterId, a.multiplicity);
  }
  for (const u of units) {
    if (!u || typeof u.characterId !== 'string') continue;
    const m = byId.get(u.characterId);
    const rec = u as Record<string, any>;
    if (typeof m === 'number') rec.multiplicity = m;
    else delete rec.multiplicity;
  }
  return units;
}

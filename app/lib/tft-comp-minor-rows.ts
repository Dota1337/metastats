// Kleine Zeilen in der Comp-Summe der Liste (User 20.10.2026, Plan in
// .claude/plan-current.md). Die Liste filterte jede Tageszeile
// (Trait@Stufe_Carry) gegen die Listen-Schwelle, bevor sie ihrer Comp
// zugeordnet wurde: Juggernaut·Ashe zeigte 213 statt 586 Spiele und einen
// geschoenten Ø (euw1/Diamond+/3 Tage). Jetzt entscheidet die Summe der Comp.
//
// Die vollen Zeilen (mit Units und Items) bleiben, wie sie sind — Brett,
// Varianten, Rollen und die Seiten, die einzelne Zeilen zeigen (Trait, Item),
// aendern sich nicht. Die kleinen Zeilen (ab COMP_ROW_FLOOR, unter der
// Schwelle) kommen schlank als `minorRows` an der meistgespielten Zeile ihrer
// Comp mit und zaehlen nur in deren Summen (buildCompFamilies).

// Untergrenze je Zeile. MUSS gleich DETAIL_MIN_GAMES (Detailseite) und
// COMP_PRECOMPUTE_MIN_GAMES (vorgerechnete Liste) sein — sonst zaehlen Liste
// und Detail verschieden bzw. die vorgerechnete Liste taugt nicht mehr
// (tft-comp-minor-rows.test.mjs prueft das).
export const COMP_ROW_FLOOR = 30;

/** Schlanke Zeile: nur, was in die Summe der Comp eingeht. */
export interface MinorCompRow {
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
}

/** Zeile mit Spielen und Platzierungen (get_tft_comp_stats_for_diff oder volle Zeile). */
export interface CompTotalsRow {
  cluster_key: string;
  games: number | string;
  sum_placement: number | string;
  top4: number | string;
  top1: number | string;
}

export interface CompTotalsPlan<R extends CompTotalsRow> {
  /** Zeilen unter der Schwelle, die als volle Zeile kommen muessen: das Brett
   *  einer Comp, deren Zeilen alle darunter liegen, deren Summe aber nicht. */
  fillKeys: string[];
  /** Kleine Zeilen je Anker (cluster_key der meistgespielten Zeile der Comp). */
  minorByAnchor: Map<string, R[]>;
}

/**
 * Teilt die Zeilen ab `floor` je Comp auf. `groupOf` liefert die Comp einer
 * Zeile (Katalog-Comp bzw. klassische Familie), null = gehoert zu keiner.
 * Comps mit Summe unter `threshold` fallen weg wie bisher.
 */
export function planCompTotals<R extends CompTotalsRow>(
  rows: R[],
  groupOf: (clusterKey: string) => string | null,
  threshold: number,
  floor: number = COMP_ROW_FLOOR,
): CompTotalsPlan<R> {
  const groups = new Map<string, R[]>();
  for (const r of rows) {
    if (!(Number(r.games) >= floor)) continue;
    const g = groupOf(r.cluster_key);
    if (g == null) continue;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(r);
  }
  const fillKeys: string[] = [];
  const minorByAnchor = new Map<string, R[]>();
  for (const list of groups.values()) {
    const total = list.reduce((s, r) => s + Number(r.games), 0);
    if (total < threshold) continue;
    const sorted = [...list].sort((a, b) => Number(b.games) - Number(a.games) || (a.cluster_key < b.cluster_key ? -1 : 1));
    const anchor = sorted[0];
    if (Number(anchor.games) < threshold) fillKeys.push(anchor.cluster_key);
    const minor = sorted.filter(r => r !== anchor && Number(r.games) < threshold);
    if (minor.length > 0) minorByAnchor.set(anchor.cluster_key, minor);
  }
  return { fillKeys: fillKeys.sort(), minorByAnchor };
}

export function minorCompRow(r: CompTotalsRow, participants: number): MinorCompRow {
  const games = Number(r.games) || 0;
  return {
    clusterKey: r.cluster_key,
    games,
    avgPlacement: games > 0 ? Number(r.sum_placement) / games : null,
    top4Rate: games > 0 ? Number(r.top4) / games : null,
    top1Rate: games > 0 ? Number(r.top1) / games : null,
    pickRate: participants > 0 ? games / participants : null,
  };
}

/** Summen der kleinen Zeilen, je Kennung einmal (`skip` = schon als volle Zeile da). */
export function sumMinorRows(rows: Iterable<MinorCompRow>, skip: Set<string> = new Set()) {
  const seen = new Set<string>();
  let games = 0, place = 0, top4 = 0, top1 = 0, pick = 0;
  const keys: string[] = [];
  for (const m of rows) {
    if (!m?.clusterKey || seen.has(m.clusterKey) || skip.has(m.clusterKey) || !(m.games > 0)) continue;
    seen.add(m.clusterKey);
    keys.push(m.clusterKey);
    games += m.games;
    place += (m.avgPlacement ?? 0) * m.games;
    top4 += (m.top4Rate ?? 0) * m.games;
    top1 += (m.top1Rate ?? 0) * m.games;
    pick += m.pickRate ?? 0;
  }
  return { games, place, top4, top1, pick, keys };
}

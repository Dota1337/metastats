// LevelOutcome — Aktivierungs-Level-Split-Stats für die Detail-Page nach
// User-Entscheid 2026-06-21 (Option C: Konsolidierung auf <trait>__<carry>).
//
// Warum eigenes Modul (architect F3, data-skeptic F3 KRITISCH 2026-06-21):
// die C-Konsolidierung mergt Trait-Aktivierungs-Level — die Skill-Ceiling-
// Strategie (z.B. Stargazer@6_Lulu*3 Avg 2.17) wird in der Family-Card-Avg
// (3.66) versteckt. Ohne diesen Block hätte User in der Detail-Page keinen
// Pfad mehr um zu sehen "diese Comp ist S-Tier wenn auf 6er-Aktivierung
// gespielt".
//
// Datenpfad: KEIN jsonb-Dict-Merge (level_dist trägt Spieler-Final-Level,
// nicht Trait-Aktivierung). Stattdessen aggregieren wir über die rohen
// Family-Member-CompRows — der Aktivierungs-Level lebt im cluster_key:
// `<trait>@<level>_<carry>...`. parseClusterKey extrahiert den @level.
//
// Trade-off mit data-skeptic-Empfehlung: data-skeptic schlug level_dist-
// Bar-Chart vor (Spieler-Final-Level). Wir zeigen Trait-Aktivierungs-Level
// weil DAS der direkte Treiber der Sub-Cluster-Spread ist — die Family-Sub-
// Cluster sind PER DEFINITION nach Aktivierungs-Level getrennt.

import { parseClusterKey } from './tft-cluster';
import type { CompRowLike } from './tft-comp-family-merge';

export interface LevelOutcomeRow {
  level: number;          // Trait-Aktivierungs-Level (z.B. 3, 4, 5, 6)
  games: number;          // Σ games über alle Sub-Cluster dieses Levels
  share: number;          // games / family_total_games
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  // Sub-Star-Split: wenn die Level-Gruppe sowohl *2 als auch *3 Sub-Cluster
  // enthält, zeigen wir den Star-Anteil als zusätzliche Information.
  star3Games: number;     // Σ games der *3-Sub-Cluster im Level
}

/** Aggregiert Family-Member-Rows nach Trait-Aktivierungs-Level. Filter:
 *  Sub-Cluster mit < minGames werden ausgelassen (Singleton-Noise). Sortiert
 *  by Aktivierungs-Level asc (User-Erwartung: 3 → 4 → 5 → 6).
 */
export function buildLevelOutcome(
  members: CompRowLike[],
  minGamesPerSubCluster = 30,
): LevelOutcomeRow[] {
  if (members.length === 0) return [];
  const byLevel = new Map<number, {
    games: number;
    sumPlacement: number;
    top4: number;
    top1: number;
    star3Games: number;
  }>();
  let total = 0;
  for (const m of members) {
    if (Number(m.games) < minGamesPerSubCluster) continue;
    const parts = parseClusterKey(m.cluster_key);
    if (!parts || parts.level <= 0) continue;
    total += Number(m.games);
    const cur = byLevel.get(parts.level) || {
      games: 0, sumPlacement: 0, top4: 0, top1: 0, star3Games: 0,
    };
    cur.games += Number(m.games);
    cur.sumPlacement += Number(m.sum_placement);
    cur.top4 += Number(m.top4);
    cur.top1 += Number(m.top1);
    if (parts.carryStar === 3) cur.star3Games += Number(m.games);
    byLevel.set(parts.level, cur);
  }
  return [...byLevel.entries()]
    .map(([level, v]): LevelOutcomeRow => ({
      level,
      games: v.games,
      share: total > 0 ? v.games / total : 0,
      avgPlacement: v.games > 0 ? v.sumPlacement / v.games : 0,
      top4Rate: v.games > 0 ? v.top4 / v.games : 0,
      top1Rate: v.games > 0 ? v.top1 / v.games : 0,
      star3Games: v.star3Games,
    }))
    .sort((a, b) => a.level - b.level);
}

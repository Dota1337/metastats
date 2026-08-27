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
import { mergeJsonbCountArrays } from './tft-supabase-reader';

export interface LevelOutcomeUnit {
  characterId: string;
  count: number;
  cooccurrence: number;            // count / level-games
  topItems: Array<{ apiName: string; count: number }>;
}

export interface LevelOutcomeRow {
  level: number;                   // Trait-Aktivierungs-Level (z.B. 3, 4, 5, 6)
  games: number;                   // Σ games über alle Sub-Cluster dieses Levels
  share: number;                   // games / family_total_games
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  star3Games: number;              // Σ games der *3-Sub-Cluster im Level
  typicalUnits: LevelOutcomeUnit[]; // Top-Units des Boards bei dieser Aktivierung
}

/** Aggregiert Family-Member-Rows nach Trait-Aktivierungs-Level. Liefert pro
 *  Level neben den Stats auch die Top-Units des Boards (gemergt aus den
 *  typical_units_merged-Arrays der Sub-Cluster mit gleicher Aktivierung).
 *  User-Wortlaut 2026-06-21: „Für Spieler ist nur interessant, welche Units
 *  auf welchem Level gespielt werden". Filter: Sub-Cluster mit < minGames
 *  ausgelassen (Singleton-Noise). Sortiert by Aktivierungs-Level asc — so
 *  liest sich die Card-Reihe wie eine Power-Curve (klein → maxed-out).
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
    typicalUnitsArrays: any[][]; // Pool für mergeJsonbCountArrays
  }>();
  let total = 0;
  for (const m of members) {
    if (Number(m.games) < minGamesPerSubCluster) continue;
    const parts = parseClusterKey(m.cluster_key);
    if (!parts || parts.level <= 0) continue;
    total += Number(m.games);
    const cur = byLevel.get(parts.level) || {
      games: 0, sumPlacement: 0, top4: 0, top1: 0, star3Games: 0,
      typicalUnitsArrays: [],
    };
    cur.games += Number(m.games);
    cur.sumPlacement += Number(m.sum_placement);
    cur.top4 += Number(m.top4);
    cur.top1 += Number(m.top1);
    if (parts.carryStar === 3) cur.star3Games += Number(m.games);
    // typical_units_merged ist Array<Array<{characterId,count,...}>>. Wir
    // sammeln alle inneren Arrays in einen Pool für mergeJsonbCountArrays.
    if (Array.isArray(m.typical_units_merged)) {
      for (const innerArr of m.typical_units_merged) {
        if (Array.isArray(innerArr)) cur.typicalUnitsArrays.push(innerArr);
      }
    }
    byLevel.set(parts.level, cur);
  }
  return [...byLevel.entries()]
    .map(([level, v]): LevelOutcomeRow => {
      // Merge typical_units über alle Sub-Cluster mit gleichem Aktivierungs-
      // Level. Cooccurrence-Filter 15 % von Level-games (analog Aggregator)
      // + Top 9 by count + Bard-Follower-Filter via TFT<N>_<Upper>-Pattern.
      const merged = mergeJsonbCountArrays(v.typicalUnitsArrays, 'characterId', 24, [
        { field: 'topItems', innerKey: 'apiName', topN: 3 },
      ]);
      const minCo = Math.max(3, Math.floor(v.games * 0.15));
      const typicalUnits = merged
        .filter(u => /^(?:TFT\d+|Set\d+|DA)_(?:\d+_)?[A-Z]/.test((u as any).characterId))
        .filter(u => Number((u as any).count || 0) >= minCo)
        .sort((a, b) => Number((b as any).count || 0) - Number((a as any).count || 0))
        .slice(0, 9)
        .map((u): LevelOutcomeUnit => ({
          characterId: (u as any).characterId as string,
          count: Number((u as any).count || 0),
          cooccurrence: v.games > 0 ? Number((u as any).count || 0) / v.games : 0,
          topItems: Array.isArray((u as any).topItems) ? (u as any).topItems : [],
        }));
      return {
        level,
        games: v.games,
        share: total > 0 ? v.games / total : 0,
        avgPlacement: v.games > 0 ? v.sumPlacement / v.games : 0,
        top4Rate: v.games > 0 ? v.top4 / v.games : 0,
        top1Rate: v.games > 0 ? v.top1 / v.games : 0,
        star3Games: v.star3Games,
        typicalUnits,
      };
    })
    .sort((a, b) => a.level - b.level);
}

import type { AgentScore, TftMatchSnapshot } from '../types';

// HighRollAgent — uses the unit→item edges from the patch KG.
// Rewards two things:
//   1) The carry's items match the patch's KG-recommended top items for that
//      unit (= "you slammed the right items").
//   2) Augment-tier quality, when augments are present in the DTO. Set 17
//      DTOs lack augments entirely, so this slice noops gracefully.

export interface HighRollKgSlice {
  // unitId -> Set of "highly recommended" item apiNames (top 5 from KG)
  recommendedItems: Record<string, Set<string>>;
}

export function buildHighRollKgSlice(kg: any, topPerUnit = 5): HighRollKgSlice | null {
  if (!kg?.edges?.unitToItem) return null;
  const grouped: Record<string, { item: string; games: number }[]> = {};
  for (const e of kg.edges.unitToItem) {
    if (!grouped[e.unit]) grouped[e.unit] = [];
    grouped[e.unit].push({ item: e.item, games: e.games });
  }
  const out: Record<string, Set<string>> = {};
  for (const [unit, list] of Object.entries(grouped)) {
    list.sort((a, b) => b.games - a.games);
    out[unit] = new Set(list.slice(0, topPerUnit).map(x => x.item));
  }
  return { recommendedItems: out };
}

export function highRollAgent(matches: TftMatchSnapshot[], kg: HighRollKgSlice | null, augTierMap: Record<string, number> | null): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;

  if (matches.length === 0) {
    return { agent: 'highRoll', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }

  // Item-slam efficiency: per match, ratio of carry items that are KG-recommended
  if (kg) {
    let scored = 0;
    let scoreSum = 0;
    for (const m of matches) {
      const carry = m.comp?.carryUnit;
      const carryItems = m.comp?.carryItems || [];
      if (!carry || carryItems.length === 0) continue;
      const rec = kg.recommendedItems[carry];
      if (!rec || rec.size === 0) continue;
      const hits = carryItems.filter(i => rec.has(i)).length;
      scoreSum += hits / Math.max(1, carryItems.length);
      scored++;
    }
    if (scored >= 5) {
      const avgHit = scoreSum / scored;
      if (avgHit > 0.80) {
        multiplier += 0.05;
        notes.push({ label: 'item slam', impact: +0.05, detail: `${(avgHit * 100).toFixed(0)}% recommended` });
      } else if (avgHit > 0.60) {
        multiplier += 0.02;
        notes.push({ label: 'item slam', impact: +0.02, detail: `${(avgHit * 100).toFixed(0)}% recommended` });
      } else if (avgHit < 0.30) {
        multiplier -= 0.04;
        notes.push({ label: 'item slam', impact: -0.04, detail: `${(avgHit * 100).toFixed(0)}% recommended` });
      }
    }
  }

  // Augment quality — only if augTierMap covers the matches.
  if (augTierMap) {
    let totalAugs = 0, prismatics = 0;
    for (const m of matches) {
      for (const a of m.augments || []) {
        totalAugs++;
        if (augTierMap[a] === 3) prismatics++;
      }
    }
    if (totalAugs >= 15) {
      const prismaticShare = prismatics / totalAugs;
      if (prismaticShare > 0.30) {
        multiplier += 0.04;
        notes.push({ label: 'prismatic share', impact: +0.04, detail: `${(prismaticShare * 100).toFixed(0)}%` });
      } else if (prismaticShare > 0.20) {
        multiplier += 0.02;
        notes.push({ label: 'prismatic share', impact: +0.02, detail: `${(prismaticShare * 100).toFixed(0)}%` });
      }
    }
  }

  multiplier = Math.max(0.90, Math.min(1.12, multiplier));
  return { agent: 'highRoll', multiplier, delta: multiplier - 1, notes };
}

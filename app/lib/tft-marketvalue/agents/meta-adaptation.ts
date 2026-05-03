import type { AgentScore, TftMatchSnapshot } from '../types';

// MetaAdaptationAgent — uses the patch knowledge graph.
// Rewards comp diversity (flex players), playing meta-relevant comps, and
// patch responsiveness; penalises one-tricks.
//
// `kg` is the relevant chunk of tft-graph-{region}.json. Pass null when the
// graph isn't available yet (e.g. fresh region with no crawl) — the agent
// then degrades gracefully to a neutral score with diversity-only bonus.

export interface MetaKgSlice {
  hotCompKeys: Set<string>;        // Top-N comps by play rate / avg placement
  knownCompKeys: Set<string>;      // every comp seen in the patch (universe)
}

export function buildMetaKgSlice(kg: any, topN = 10): MetaKgSlice | null {
  if (!kg?.edges?.compToUnit) return null;
  const compsSeen = new Set<string>(kg.edges.compToUnit.map((e: any) => e.comp));
  // We don't have explicit "play rate" in the graph — derive it from
  // typicalUnits cumulative count as a proxy. Hot = those that appeared
  // most often in the source aggregator.
  const compCounts: Record<string, number> = {};
  for (const e of kg.edges.compToUnit) {
    compCounts[e.comp] = (compCounts[e.comp] || 0) + (e.count || 0);
  }
  const hotKeys = Object.entries(compCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k);
  return { hotCompKeys: new Set(hotKeys), knownCompKeys: compsSeen };
}

export function metaAdaptationAgent(matches: TftMatchSnapshot[], kg: MetaKgSlice | null): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;

  if (matches.length === 0) {
    return { agent: 'metaAdaptation', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }

  const compKeys = matches.map(m => m.comp?.clusterKey).filter(Boolean) as string[];
  const uniqueComps = new Set(compKeys);
  const dominantCount = compKeys.length > 0
    ? Math.max(...[...uniqueComps].map(k => compKeys.filter(c => c === k).length))
    : 0;
  const dominantShare = compKeys.length > 0 ? dominantCount / compKeys.length : 0;

  // Comp diversity — flex players play 3+ different comps in 30 games
  if (uniqueComps.size >= 4) {
    multiplier += 0.06;
    notes.push({ label: 'comp diversity', impact: +0.06, detail: `${uniqueComps.size} comps` });
  } else if (uniqueComps.size >= 3) {
    multiplier += 0.03;
    notes.push({ label: 'comp diversity', impact: +0.03, detail: `${uniqueComps.size} comps` });
  }
  if (dominantShare > 0.85 && compKeys.length >= 10) {
    multiplier -= 0.10;
    notes.push({ label: 'one-trick penalty', impact: -0.10, detail: `${(dominantShare * 100).toFixed(0)}% one comp` });
  }

  // Hot-meta-pick share — only meaningful if we have a KG slice
  if (kg && kg.hotCompKeys.size > 0 && compKeys.length > 0) {
    const hotPicks = compKeys.filter(k => kg.hotCompKeys.has(k)).length;
    const hotShare = hotPicks / compKeys.length;
    if (hotShare >= 0.60) {
      multiplier += 0.07;
      notes.push({ label: 'meta picks', impact: +0.07, detail: `${(hotShare * 100).toFixed(0)}% in top-10` });
    } else if (hotShare >= 0.40) {
      multiplier += 0.03;
      notes.push({ label: 'meta picks', impact: +0.03, detail: `${(hotShare * 100).toFixed(0)}% in top-10` });
    } else if (hotShare < 0.10 && compKeys.length >= 10) {
      multiplier -= 0.05;
      notes.push({ label: 'off-meta', impact: -0.05, detail: `${(hotShare * 100).toFixed(0)}%` });
    }
  }

  multiplier = Math.max(0.85, Math.min(1.18, multiplier));
  return { agent: 'metaAdaptation', multiplier, delta: multiplier - 1, notes };
}

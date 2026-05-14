import type { AgentScore, TftMatchSnapshot } from '../types';

// FlexMasteryAgent — rewards players who can pilot multiple comps at a high
// level. Pure one-tricks still get a small bonus when their average
// placement on the single comp is exceptional (≤2.8), but they max out
// below what a multi-comp flex player can reach.

export function flexMasteryAgent(matches: TftMatchSnapshot[]): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;
  if (matches.length < 10) {
    return { agent: 'flexMastery', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }

  // Per-comp placement averages (min 5 games per comp counted)
  const byComp = new Map<string, number[]>();
  for (const m of matches) {
    const k = m.comp?.clusterKey;
    if (!k) continue;
    if (!byComp.has(k)) byComp.set(k, []);
    byComp.get(k)!.push(m.placement);
  }
  const compAvgs = [...byComp.entries()]
    .filter(([, plcs]) => plcs.length >= 5)
    .map(([key, plcs]) => ({ key, avg: plcs.reduce((a, b) => a + b, 0) / plcs.length, games: plcs.length }));
  const masteredComps = compAvgs.filter(c => c.avg <= 3.5);
  const dominant = compAvgs.slice().sort((a, b) => b.games - a.games)[0];

  if (masteredComps.length >= 3) {
    multiplier += 0.06;
    notes.push({ label: 'flex mastery', impact: +0.06, detail: `${masteredComps.length} comps avg ≤3.5` });
  } else if (masteredComps.length >= 2) {
    multiplier += 0.03;
    notes.push({ label: 'flex mastery', impact: +0.03, detail: `${masteredComps.length} comps avg ≤3.5` });
  } else if (dominant && dominant.games >= 15 && dominant.avg <= 2.8) {
    multiplier += 0.03;
    notes.push({ label: 'one-trick mastery', impact: +0.03, detail: `avg ${dominant.avg.toFixed(2)}` });
  } else if (compAvgs.length >= 3 && compAvgs.every(c => c.avg > 4.5)) {
    multiplier -= 0.04;
    notes.push({ label: 'flex without substance', impact: -0.04, detail: `${compAvgs.length} comps all avg >4.5` });
  }

  // Carry-unit diversity — separate axis from comp variety
  const carryUnits = new Set(matches.map(m => m.comp?.carryUnit).filter(Boolean) as string[]);
  if (carryUnits.size >= 6) {
    multiplier += 0.03;
    notes.push({ label: 'carry diversity', impact: +0.03, detail: `${carryUnits.size} carries` });
  } else if (carryUnits.size <= 2 && matches.length >= 30) {
    multiplier -= 0.04;
    notes.push({ label: 'narrow carry pool', impact: -0.04, detail: `${carryUnits.size} carries` });
  }

  multiplier = Math.max(0.90, Math.min(1.12, multiplier));
  return { agent: 'flexMastery', multiplier, delta: multiplier - 1, notes };
}

import type { AgentScore, TftMatchSnapshot } from '../types';

// PerformanceAgent — pure outcome-based scoring (no KG dependency).
// Inputs: list of match snapshots ordered newest first.
// Output: multiplier ∈ ~[0.45, 1.40].

export function performanceAgent(matches: TftMatchSnapshot[]): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;

  if (matches.length === 0) {
    return { agent: 'performance', multiplier: 1, delta: 0, notes: [{ label: 'no matches', impact: 0 }] };
  }

  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const avgPlace = placements.reduce((a, b) => a + b, 0) / placements.length;
  const top4 = placements.filter(p => p <= 4).length / placements.length;
  const top1 = placements.filter(p => p === 1).length / placements.length;

  // Avg-Placement: the central TFT skill metric. Lower = better.
  if (avgPlace < 3.5) {
    multiplier += 0.20;
    notes.push({ label: 'avg-placement', impact: +0.20, detail: avgPlace.toFixed(2) });
  } else if (avgPlace < 4.0) {
    multiplier += 0.10;
    notes.push({ label: 'avg-placement', impact: +0.10, detail: avgPlace.toFixed(2) });
  } else if (avgPlace > 4.8) {
    multiplier -= 0.15;
    notes.push({ label: 'avg-placement', impact: -0.15, detail: avgPlace.toFixed(2) });
  } else if (avgPlace > 4.5) {
    multiplier -= 0.07;
    notes.push({ label: 'avg-placement', impact: -0.07, detail: avgPlace.toFixed(2) });
  }

  // Top-4 rate: stability indicator
  if (top4 > 0.60) {
    multiplier += 0.10;
    notes.push({ label: 'top-4 rate', impact: +0.10, detail: `${(top4 * 100).toFixed(0)}%` });
  } else if (top4 < 0.40) {
    multiplier -= 0.10;
    notes.push({ label: 'top-4 rate', impact: -0.10, detail: `${(top4 * 100).toFixed(0)}%` });
  }

  // Top-1 rate: closing-power bonus, capped
  if (top1 > 0.18) {
    multiplier += 0.08;
    notes.push({ label: 'top-1 rate', impact: +0.08, detail: `${(top1 * 100).toFixed(0)}%` });
  } else if (top1 > 0.13) {
    multiplier += 0.04;
    notes.push({ label: 'top-1 rate', impact: +0.04, detail: `${(top1 * 100).toFixed(0)}%` });
  }

  // Hard floor + ceiling so a single hot streak can't blow up the value
  multiplier = Math.max(0.45, Math.min(1.40, multiplier));

  return { agent: 'performance', multiplier, delta: multiplier - 1, notes };
}

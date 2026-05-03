import type { AgentScore, TftMatchSnapshot } from '../types';

// ConsistencyAgent — placement-stability and streak detection.
// Stable Top-4 players are weighted higher than swing-trader players with
// equal averages (which the PerformanceAgent rewards on its own).

export function consistencyAgent(matches: TftMatchSnapshot[]): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;

  if (matches.length < 5) {
    return { agent: 'consistency', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }

  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const mean = placements.reduce((a, b) => a + b, 0) / placements.length;
  const variance = placements.reduce((s, p) => s + (p - mean) ** 2, 0) / placements.length;
  const stddev = Math.sqrt(variance);

  if (stddev < 1.8) {
    multiplier += 0.06;
    notes.push({ label: 'placement stddev', impact: +0.06, detail: stddev.toFixed(2) });
  } else if (stddev < 2.1) {
    multiplier += 0.03;
    notes.push({ label: 'placement stddev', impact: +0.03, detail: stddev.toFixed(2) });
  } else if (stddev > 2.6) {
    multiplier -= 0.04;
    notes.push({ label: 'placement stddev', impact: -0.04, detail: stddev.toFixed(2) });
  }

  // Top-4 streak: longest consecutive run of placement <= 4
  let bestStreak = 0, current = 0;
  for (const p of placements) {
    if (p <= 4) { current++; bestStreak = Math.max(bestStreak, current); }
    else current = 0;
  }
  if (bestStreak >= 5 && placements.length >= 20) {
    multiplier += 0.03;
    notes.push({ label: 'top-4 streak', impact: +0.03, detail: `${bestStreak} in a row` });
  }

  // Bottom-4 crash rate
  const bottom4Rate = placements.filter(p => p >= 5).length / placements.length;
  if (bottom4Rate > 0.55) {
    multiplier -= 0.06;
    notes.push({ label: 'bottom-4 share', impact: -0.06, detail: `${(bottom4Rate * 100).toFixed(0)}%` });
  }

  multiplier = Math.max(0.88, Math.min(1.10, multiplier));
  return { agent: 'consistency', multiplier, delta: multiplier - 1, notes };
}

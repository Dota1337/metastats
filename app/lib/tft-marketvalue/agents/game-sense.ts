import type { AgentScore, TftMatchSnapshot } from '../types';

// GameSenseAgent — late-game decision making.
//   Survival skill — how late did the player exit in bottom-4 placements?
//                    Late exits = good macro / late-stage decisions.
//   Eco mastery    — how much gold sat unused at Top-4 finishes?
//                    Low = bench spent efficiently; high = under-rolled.
// goldLeft can be null for matches cached before migration 0012 — those
// are silently skipped (need at least 5 samples either way).

export function gameSenseAgent(matches: TftMatchSnapshot[]): AgentScore {
  const notes: AgentScore['notes'] = [];
  let multiplier = 1;
  if (matches.length < 10) {
    return { agent: 'gameSense', multiplier: 1, delta: 0, notes: [{ label: 'sample too small', impact: 0 }] };
  }

  const bottoms = matches.filter(m => m.placement >= 5 && typeof m.lastRound === 'number' && (m.lastRound as number) > 0);
  if (bottoms.length >= 5) {
    const avgLate = bottoms.reduce((a, b) => a + (b.lastRound as number), 0) / bottoms.length;
    if (avgLate > 6.0) {
      multiplier += 0.05;
      notes.push({ label: 'late exit', impact: +0.05, detail: `Ø Stage ${avgLate.toFixed(1)}` });
    } else if (avgLate > 5.5) {
      multiplier += 0.02;
      notes.push({ label: 'late exit', impact: +0.02, detail: `Ø Stage ${avgLate.toFixed(1)}` });
    }
  }

  const tops = matches.filter(m => m.placement <= 4 && typeof m.goldLeft === 'number');
  if (tops.length >= 5) {
    const avgGold = tops.reduce((a, b) => a + (b.goldLeft as number), 0) / tops.length;
    if (avgGold < 15) {
      multiplier += 0.03;
      notes.push({ label: 'eco mastery', impact: +0.03, detail: `Ø ${avgGold.toFixed(0)}g leftover` });
    } else if (avgGold > 40) {
      multiplier -= 0.02;
      notes.push({ label: 'unspent gold', impact: -0.02, detail: `Ø ${avgGold.toFixed(0)}g leftover` });
    }
  }

  multiplier = Math.max(0.94, Math.min(1.10, multiplier));
  return { agent: 'gameSense', multiplier, delta: multiplier - 1, notes };
}

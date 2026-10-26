// Gewinner und Verlierer eines Patches aus den Rohzeilen beider Seiten — reine
// Rechnung ohne Abfragen. Benutzt von /api/tft/patch-diff (Patch-Gewinner) und
// den Startdaten der Seite /tft/patch/winners (seo/page-start-tft.ts), damit
// beide genau dieselbe Liste zeigen.
import { PATCH_DIFF_MIN_GAMES, type PatchDiffRow } from './snapshot-matrix';

export interface PatchDiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;        // negative = better in current patch
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

const LIST_SIZE = 15;

/** Zeilen nach dem Zusammenlegen der Stufen (sumPatchDiffLevels). */
export function patchDiffEntries(curr: PatchDiffRow[], prev: PatchDiffRow[]): {
  sampleSize: number;
  winners: PatchDiffEntry[];
  losers: PatchDiffEntry[];
} {
  const prevMap = new Map(prev.map(r => [r.key, r]));
  const diffs: PatchDiffEntry[] = [];
  for (const c of curr) {
    const p = prevMap.get(c.key);
    if (!p) continue;
    if (c.games < PATCH_DIFF_MIN_GAMES || p.games < PATCH_DIFF_MIN_GAMES) continue;
    const cAvg = c.sum_placement / c.games;
    const pAvg = p.sum_placement / p.games;
    const cPick = c.participants > 0 ? c.games / c.participants : 0;
    const pPick = p.participants > 0 ? p.games / p.participants : 0;
    const cTop4 = c.top4 / c.games;
    const pTop4 = p.top4 / p.games;
    diffs.push({
      key: c.key,
      currentGames: c.games,
      previousGames: p.games,
      currentAvgPlacement: cAvg,
      previousAvgPlacement: pAvg,
      deltaAvgPlacement: cAvg - pAvg,
      currentPickRate: cPick,
      previousPickRate: pPick,
      deltaPickRate: cPick - pPick,
      currentTop4Rate: cTop4,
      previousTop4Rate: pTop4,
      deltaTop4Rate: cTop4 - pTop4,
    });
  }

  // Winners = avg placement got better (lower) by the largest amount.
  // Losers = avg placement got worse (higher).
  const winners = [...diffs].sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, LIST_SIZE);
  const losers = [...diffs].sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, LIST_SIZE);
  return { sampleSize: diffs.length, winners, losers };
}

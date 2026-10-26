// Haupt- und Gesamtwerte der Spieler-Bewertung fuer den Vergleich.
//
// Die Box liefert nur Unterwerte. Hier entsteht, was die Spalten vergleichbar
// macht:
//   - je Unterwert EINE Fassung fuer alle Spieler: die Nur-bekannte-Lobby-
//     Fassung (z. B. '5.1k'), wenn alle sie haben, sonst die gemischte;
//   - ein Hauptwert nur aus Unterwerten, die ALLE Spieler haben — sonst
//     vergliche man z. B. 3 Unterwerte mit einem;
//   - der Bereich aus denselben Bootstrap-Wiederholungen (Index r gehoert bei
//     allen Unterwerten eines Spielers zur selben Stichprobe).

import type { PlayerScoring, ScoringMain, ScoringMetric } from '../../../lib/tft-player-scoring-types';

export const SCORING_MAINS: ScoringMain[] = ['results', 'board', 'range', 'economy', 'ceiling', 'tempo'];
export const SCORING_SUBS: Record<ScoringMain, string[]> = {
  results: ['1.1', '1.2', '1.3'],
  board: ['2.1', '2.2', '2.3'],
  range: ['3.1', '3.2', '3.3'],
  economy: ['4.1', '4.2'],
  ceiling: ['5.1', '5.2'],
  tempo: ['6.1', '6.2'],
};
const BAND_MIN_SHARE = 0.8;

export interface Band { value: number | null; lo: number | null; hi: number | null }

export interface ScoringView {
  /** gewaehlte Fassung je Unterwert ('5.1' → '5.1k' oder '5.1') */
  pick: Record<string, string>;
  /** Unterwerte je Hauptwert, die alle Spieler haben (ohne Varianten-Suffix) */
  common: Record<ScoringMain, string[]>;
  /** je Spieler, gleiche Reihenfolge wie die Eingabe */
  main: Record<ScoringMain, Band>[];
  overall: Band[];
}

export function metricOf(s: PlayerScoring, id: string): ScoringMetric | null {
  return s.metrics.find(m => m.id === id) ?? null;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function bandOf(reps: (number | null)[]): [number | null, number | null] {
  const ok = reps.filter((x): x is number => x != null).sort((a, b) => a - b);
  if (ok.length === 0 || ok.length < BAND_MIN_SHARE * reps.length) return [null, null];
  const at = (p: number) => ok[Math.min(ok.length - 1, Math.max(0, Math.round(p * (ok.length - 1))))];
  return [at(0.05), at(0.95)];
}

// Mittel je Wiederholung; null, sobald ein Teil fehlt.
function repMeans(parts: ((number | null)[] | null)[]): (number | null)[] {
  const len = Math.max(0, ...parts.map(p => p?.length ?? 0));
  return Array.from({ length: len }, (_, r) => {
    const xs = parts.map(p => p?.[r] ?? null);
    return xs.every((x): x is number => x != null) ? mean(xs) : null;
  });
}

function band(values: number[], reps: (number | null)[]): Band {
  if (values.length === 0) return { value: null, lo: null, hi: null };
  const [lo, hi] = bandOf(reps);
  return { value: Math.round(mean(values) * 10) / 10, lo, hi };
}

export function buildScoringView(players: PlayerScoring[]): ScoringView {
  const pick: Record<string, string> = {};
  for (const subs of Object.values(SCORING_SUBS)) {
    for (const id of subs) {
      const k = `${id}k`;
      const all = players.length > 0 && players.every(p => metricOf(p, k)?.value != null);
      pick[id] = all ? k : id;
    }
  }
  const common = Object.fromEntries(SCORING_MAINS.map(m => [
    m,
    SCORING_SUBS[m].filter(id => players.length > 0 && players.every(p => metricOf(p, pick[id])?.value != null)),
  ])) as Record<ScoringMain, string[]>;

  const main: Record<ScoringMain, Band>[] = [];
  const overall: Band[] = [];
  for (const p of players) {
    const row = {} as Record<ScoringMain, Band>;
    const mainVals: number[] = [];
    const mainReps: (number | null)[][] = [];
    for (const m of SCORING_MAINS) {
      const ms = common[m].map(id => metricOf(p, pick[id])!);
      const reps = repMeans(ms.map(x => x.reps));
      row[m] = band(ms.map(x => x.value!), reps);
      if (row[m].value != null) {
        mainVals.push(row[m].value!);
        mainReps.push(reps);
      }
    }
    main.push(row);
    overall.push(band(mainVals, repMeans(mainReps)));
  }
  return { pick, common, main, overall };
}

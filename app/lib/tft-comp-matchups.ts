// Comp-Duelle aus tft_daily_comp_matchups (Migration 0092): je Familie
// (<trait>__<carry>) und Gegner-Familie die Zahl der Vergleiche — zwei Spieler
// derselben Lobby — und wie oft die eigene vorn landete. Ein Helfer fuer
// Detailseite, Companion und Vergleichsseite, damit alle drei dieselben
// Schwellen nutzen (data-skeptic 2026-10-11):
//   - bewertet erst ab MATCHUP_MIN_N Vergleichen
//   - vorn/hinten nur, wenn der Abstand zu 50 % mindestens max(5 Punkte,
//     Unsicherheit) betraegt; Unsicherheit = 0,98/√n (95-%-Spanne um 50 %)
//   - „ausgeglichen" nur, wenn Abstand + Unsicherheit hoechstens 5 Punkte sind
//   - Reihenfolge nach Abstand minus Unsicherheit (sichere Befunde zuerst)
// Reine Funktionen ohne Netz; die Abfrage steht in tft-comp-matchups-server.ts.
import { familyKeyForMerge } from './tft-comp-family-merge';

export const MATCHUP_MIN_N = 100;
export const MATCHUP_MIN_GAP = 0.05;

/** Eine Zeile der Abfrage get_tft_comp_matchups: [Familie, Gegner, Vergleiche, vorn]. */
export type MatchupRow = [comp: string, opp: string, games: number, better: number];

/** days = Tage mit neuen Zeilen im Fenster; 0 heisst: alter Weg ueber tft_daily_comp_pairs. */
export interface MatchupResult { days: number; rows: MatchupRow[] }

export type MatchupVerdict = 'ahead' | 'behind' | 'even' | 'unclear';

export function matchupNoise(n: number): number {
  return n > 0 ? 0.98 / Math.sqrt(n) : 1;
}

/** null unter MATCHUP_MIN_N Vergleichen. */
export function matchupVerdict(n: number, rate: number): MatchupVerdict | null {
  if (!(n >= MATCHUP_MIN_N) || !Number.isFinite(rate)) return null;
  const gap = Math.abs(rate - 0.5);
  const noise = matchupNoise(n);
  if (gap >= Math.max(MATCHUP_MIN_GAP, noise)) return rate > 0.5 ? 'ahead' : 'behind';
  if (gap + noise <= MATCHUP_MIN_GAP) return 'even';
  return 'unclear';
}

/** Sortierwert: Abstand zu 50 % minus Unsicherheit. */
export function matchupScore(n: number, rate: number): number {
  return Math.abs(rate - 0.5) - matchupNoise(n);
}

export interface MatchupEdge {
  fam: string;
  games: number;
  rate: number;
  verdict: MatchupVerdict | null;
}

function toEdge(fam: string, games: number, better: number): MatchupEdge {
  const rate = games > 0 ? better / games : 0.5;
  return { fam, games, rate, verdict: matchupVerdict(games, rate) };
}

/**
 * Gegner einer Comp, summiert ueber alle ihre Familien (Zwei-Carry-Familien
 * zusammen). Eigene Familien sind nie Gegner, ebenso alles in `exclude`.
 */
export function opponentsOf(
  rows: ReadonlyArray<MatchupRow>,
  ownFams: Iterable<string>,
  exclude: Iterable<string> = [],
): MatchupEdge[] {
  const own = new Set(ownFams);
  const skip = new Set(exclude);
  const acc = new Map<string, { games: number; better: number }>();
  for (const [comp, opp, g, b] of rows) {
    if (!own.has(comp) || own.has(opp) || skip.has(opp)) continue;
    const cur = acc.get(opp) ?? { games: 0, better: 0 };
    cur.games += Number(g) || 0;
    cur.better += Number(b) || 0;
    acc.set(opp, cur);
  }
  return [...acc].map(([fam, v]) => toEdge(fam, v.games, v.better));
}

/**
 * Duell-Zeilen auf andere Namen umlegen (Comp-Katalog: klassische Familie →
 * Comp). Zeilen mit einer Familie ohne Ziel fallen weg, ebenso Paare innerhalb
 * desselben Ziels; gleiche Paare werden summiert. Jeder Spieler hat genau eine
 * Familie, also zaehlt kein Vergleich doppelt.
 */
export function remapMatchupRows(
  rows: ReadonlyArray<MatchupRow>,
  map: (fam: string) => string | null | undefined,
): MatchupRow[] {
  const acc = new Map<string, MatchupRow>();
  for (const [comp, opp, g, b] of rows) {
    const c = map(comp);
    const o = map(opp);
    if (!c || !o || c === o) continue;
    const k = `${c}\u0000${o}`;
    const cur = acc.get(k);
    if (cur) {
      cur[2] += Number(g) || 0;
      cur[3] += Number(b) || 0;
    } else {
      acc.set(k, [c, o, Number(g) || 0, Number(b) || 0]);
    }
  }
  return [...acc.values()];
}

/**
 * A gegen B: alle Vergleiche zwischen einer Familie von A und einer von B.
 * Familien, die zu beiden gehoeren, zaehlen nicht (gleiche Comp).
 */
export function duelOf(
  rows: ReadonlyArray<MatchupRow>,
  famsA: Iterable<string>,
  famsB: Iterable<string>,
): { games: number; aAhead: number; rate: number; verdict: MatchupVerdict | null } {
  const a = new Set(famsA);
  const b = new Set(famsB);
  let games = 0;
  let aAhead = 0;
  for (const [comp, opp, g, bt] of rows) {
    if (!a.has(comp) || b.has(comp) || !b.has(opp) || a.has(opp)) continue;
    games += Number(g) || 0;
    aAhead += Number(bt) || 0;
  }
  const rate = games > 0 ? aAhead / games : 0.5;
  return { games, aAhead, rate, verdict: matchupVerdict(games, rate) };
}

/** Klare Gegner: vorn (strong) und hinten (weak), sichere Befunde zuerst. */
export function splitOpponents(edges: ReadonlyArray<MatchupEdge>, limit = Infinity): {
  strong: MatchupEdge[]; weak: MatchupEdge[]; even: MatchupEdge[];
} {
  const byScore = (x: MatchupEdge, y: MatchupEdge) =>
    matchupScore(y.games, y.rate) - matchupScore(x.games, x.rate);
  return {
    strong: edges.filter(e => e.verdict === 'ahead').sort(byScore).slice(0, limit),
    weak: edges.filter(e => e.verdict === 'behind').sort(byScore).slice(0, limit),
    // Ausgeglichene nach Menge: die meistgespielten Muenzwuerfe zuerst.
    even: edges.filter(e => e.verdict === 'even').sort((x, y) => y.games - x.games).slice(0, limit),
  };
}

/** Trait und Carry einer Familie `<trait>__<carry>`. */
export function familyParts(fam: string): { trait: string; carry: string } | null {
  const i = fam.indexOf('__');
  if (i <= 0 || i + 2 >= fam.length) return null;
  return { trait: fam.slice(0, i), carry: fam.slice(i + 2) };
}

export const FAMILY_KEY_RE = /^[A-Za-z0-9_]+__[A-Za-z0-9_]+$/;

/**
 * Familie → meistgespielter cluster_key. Link-Ziel der Gegnerlisten: dieselbe
 * Wahl wie die Detail-Snapshots des Publishers (meistgespielte Comps der Liste).
 * Bei Gleichstand gewinnt der zuerst gesehene Eintrag.
 */
export function familyRepresentatives(
  comps: Iterable<{ clusterKey?: string | null; games?: number | null }>,
  into: Map<string, { key: string; games: number }> = new Map(),
): Map<string, { key: string; games: number }> {
  for (const c of comps) {
    if (!c.clusterKey) continue;
    const fam = familyKeyForMerge(c.clusterKey);
    const games = Number(c.games) || 0;
    const cur = into.get(fam);
    if (!cur || games > cur.games) into.set(fam, { key: c.clusterKey, games });
  }
  return into;
}

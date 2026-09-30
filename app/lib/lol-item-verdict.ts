// Item-Urteil fuer LoL-Champion-Builds: Kern / Wichtig / Optional / schwach.
//
// Gemessen wird der Einfluss auf die Winrate, nicht die Kaufhaeufigkeit. Der
// naive Vergleich "Winrate mit Item minus Winrate ohne" luegt: wer ein
// sechstes Item kauft, hat meist ein langes, gewonnenes Spiel hinter sich. Deshalb
// wird innerhalb gleicher Schichten verglichen (Anzahl fertiger Items 1-6 x
// Spieldauer <25 / 25-30 / >30 min) und nach Mantel-Haenszel zusammengefasst.
//
// Die Schicht-Nummern schreibt scripts/aggregate-lol-builds.mjs
// (stratumOf in scripts/lib/lol-items.mjs): stratum = (fertigeItems-1)*3 + Dauerstufe,
// also 0..17. Spiele ohne fertiges Item tragen -1 und zaehlen nur zur Gesamtsumme.

export type ItemVerdict = 'core' | 'important' | 'optional' | 'weak';

export interface StratumCount { stratum: number; games: number; wins: number }

export const MIN_WITH = 100;          // Spiele mit dem Item
export const MIN_WITHOUT = 100;       // Spiele ohne das Item
export const CORE_BUY_RATE = 0.6;     // Kaufrate in Spielen mit >= 3 fertigen Items
export const MIN_EFFECT = 0.015;      // 1,5 Prozentpunkte
export const Z99 = 2.576;             // 99 %-Intervall

const itemsInStratum = (s: number) => Math.floor(s / 3) + 1;

export interface VerdictResult {
  verdict: ItemVerdict | null;        // null = zu wenig Spiele fuer ein Urteil
  delta: number | null;               // Winrate-Differenz (0..1), Mantel-Haenszel
  low: number | null;                 // untere Grenze 99 %
  high: number | null;                // obere Grenze 99 %
  buyRate3: number;                   // Kaufrate in Spielen mit >= 3 fertigen Items
  withGames: number;
  withoutGames: number;
}

/**
 * @param totals Alle Spiele des Champions in dieser Rolle/Rangstufe je Schicht.
 * @param withItem Spiele MIT dem Item je Schicht (Teilmenge von totals).
 */
export function itemVerdict(totals: StratumCount[], withItem: StratumCount[]): VerdictResult {
  const tot = new Map<number, StratumCount>();
  for (const t of totals) {
    const prev = tot.get(t.stratum);
    tot.set(t.stratum, prev ? { stratum: t.stratum, games: prev.games + t.games, wins: prev.wins + t.wins } : { ...t });
  }
  const wit = new Map<number, StratumCount>();
  for (const w of withItem) {
    const prev = wit.get(w.stratum);
    wit.set(w.stratum, prev ? { stratum: w.stratum, games: prev.games + w.games, wins: prev.wins + w.wins } : { ...w });
  }

  let withGames = 0, withoutGames = 0, g3 = 0, a3 = 0;
  let sumW = 0, sumWD = 0, sumVar = 0;
  for (const [s, t] of tot) {
    if (s < 0) continue;
    const w = wit.get(s) || { stratum: s, games: 0, wins: 0 };
    const n1 = w.games;
    const n0 = t.games - w.games;
    if (n0 < 0) continue;                       // inkonsistente Zeile, nicht werten
    withGames += n1;
    withoutGames += n0;
    if (itemsInStratum(s) >= 3) { g3 += t.games; a3 += n1; }
    if (n1 === 0 || n0 === 0) continue;         // Schicht ohne Vergleich
    const p1 = w.wins / n1;
    const p0 = (t.wins - w.wins) / n0;
    const weight = (n1 * n0) / (n1 + n0);
    sumW += weight;
    sumWD += weight * (p1 - p0);
    sumVar += weight * weight * (p1 * (1 - p1) / n1 + p0 * (1 - p0) / n0);
  }

  const buyRate3 = g3 > 0 ? a3 / g3 : 0;
  const base = { buyRate3, withGames, withoutGames };

  if (withGames >= MIN_WITH && buyRate3 >= CORE_BUY_RATE) {
    // Kern: fast immer gekauft — ein Vergleich gegen die wenigen Spiele ohne
    // ist dann kaum aussagekraeftig, das Urteil kommt aus der Kaufrate.
    const d = sumW > 0 ? sumWD / sumW : null;
    return { verdict: 'core', delta: d, low: null, high: null, ...base };
  }
  if (withGames < MIN_WITH || withoutGames < MIN_WITHOUT || sumW === 0) {
    return { verdict: null, delta: null, low: null, high: null, ...base };
  }

  const delta = sumWD / sumW;
  const se = Math.sqrt(sumVar) / sumW;
  const low = delta - Z99 * se;
  const high = delta + Z99 * se;
  let verdict: ItemVerdict = 'optional';
  if (low > 0 && delta >= MIN_EFFECT) verdict = 'important';
  else if (high < 0 && delta <= -MIN_EFFECT) verdict = 'weak';
  return { verdict, delta, low, high, ...base };
}

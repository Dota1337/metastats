// Bewertung der Items und Builds einer Unit (Unit-Detailseite), nach der Logik
// von MetaTFT (metatft.com/units, Units-*.js: Et, Rt, assembleData) — am
// 19.10.2026 gegen deren Seite nachgerechnet: 100 von 100 Zeilen gleich in
// Stufe, Ø Platz und Place Change.
//
// Eingaben sind Zeilen des Explorer-Dienstes (Items- bzw. Builds-Reiter mit
// Traeger f=Unit): games, avg, half (= 1,96 · Standardfehler). Bezug ist die
// Zusammenfassung derselben Abfrage (alle Bretter der Unit mit denselben
// Filtern, z. B. genau 3 Items).
//
// Abweichungen von MetaTFT (Review 19.10.2026, data-skeptic):
// - Stufe erst ab MIN_TIER_GAMES Spielen; das Strecken auf mind. 3× S rechnet
//   nur unter diesen Zeilen, sonst macht Zufall bei 7 Spielen ein S.

export const MIN_TIER_GAMES = 30;

// 1,282 · Standardfehler = halbe Breite eines 80-%-Bereichs (MetaTFT), aus
// unserer 95-%-Halbbreite (1,96 · SE) umgerechnet.
const PESSIMISM = 1.282 / 1.96;
const TIER_S = 0.35;
const MIN_S = 3;

export type BuildTier = 'S' | 'A' | 'B' | 'C' | 'D';

export interface ScoreRow { key: string; games: number; avg: number; half: number }
export interface ScoreRef { games: number; avg: number }

export interface Scored<T extends ScoreRow> {
  row: T;
  /** Place Change: vorsichtiger Ø (avg + Aufschlag) minus Ø der übrigen Bretter. Kleiner = besser. */
  pc: number | null;
  /** Anteil an den Brettern des Bezugs. */
  share: number;
  score: number;
  tier: BuildTier | null;
}

// Ø der Bretter des Bezugs OHNE diese Zeile; w = Gewicht der Zeile.
function restAvg(ref: ScoreRef, avg: number, w: number): number | null {
  const n = ref.games - w;
  return n > 0 ? (ref.avg * ref.games - avg * w) / n : null;
}

export function placeChange(row: ScoreRow, ref: ScoreRef, weight = row.games): number | null {
  const rest = restAvg(ref, row.avg, weight);
  return rest == null ? null : row.avg + PESSIMISM * row.half - rest;
}

const tierOf = (v: number): BuildTier => (v >= TIER_S ? 'S' : v >= 0.25 ? 'A' : v >= 0.15 ? 'B' : v >= 0.05 ? 'C' : 'D');

// Stufen vergeben: unter den Zeilen mit genug Spielen, gestreckt, bis
// mindestens MIN_S Zeilen S sind (MetaTFT Rt).
function assignTiers<T extends ScoreRow>(list: Scored<T>[]): void {
  const ok = list.filter(s => s.row.games >= MIN_TIER_GAMES && s.pc != null);
  const vals = ok.map(s => s.score).sort((a, b) => b - a);
  let f = 1;
  if (vals.length && vals.filter(v => v >= TIER_S).length < MIN_S) {
    const n = vals[Math.min(MIN_S, vals.length) - 1];
    if (n > 0 && vals[0] > 0) f = TIER_S / n;
  }
  for (const s of ok) s.tier = tierOf(s.score * f);
}

const raw = (pc: number | null, damp: number, games: number, maxGames: number) =>
  pc == null || maxGames <= 0 ? -Infinity : -(pc - 0.5) * 0.7 * damp * (games / maxGames) ** 0.1;

/**
 * Einzel-Items. maxGames = meistgespieltes Item derselben Abfrage. Items auf
 * fast jeder Kopie (> 85 %) zaehlen im Rest gedaempft, sonst waere der Rest
 * winzig und der Place Change bedeutungslos.
 */
export function scoreItems<T extends ScoreRow>(rows: readonly T[], ref: ScoreRef): Scored<T>[] {
  const c = ref.games;
  const maxGames = Math.max(0, ...rows.map(r => r.games));
  const out = rows.map(row => {
    const share = c > 0 ? row.games / c : 0;
    const w = share > 0.85 ? c * (0.85 + 0.1 * row.games / (3 * c)) : row.games;
    const pc = placeChange(row, ref, w);
    const damp = share < 0.08 ? Math.sqrt(share / 0.08) : 1;
    return { row, pc, share, score: raw(pc, damp, row.games, maxGames), tier: null as BuildTier | null };
  });
  assignTiers(out);
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Builds (Item-Kombinationen, Schluessel "A|B|C"). maxGames wie bei MetaTFT
 * das meistgespielte EINZEL-Item (nicht der meistgespielte Build).
 * Kleine Builds zaehlen weniger ((Itemzahl/3)²), Diebeshandschuhe ÷ 30.
 */
export function scoreBuilds<T extends ScoreRow>(rows: readonly T[], ref: ScoreRef, maxItemGames: number): Scored<T>[] {
  const c = ref.games;
  const out = rows.map(row => {
    const share = c > 0 ? row.games / c : 0;
    const pc = placeChange(row, ref);
    const items = row.key.split('|');
    let damp = share < 0.01 ? Math.sqrt(share / 0.01) : 1;
    damp *= (items.length / 3) ** 2;
    if (isThiefsGlovesBuild(row.key)) damp /= 30;
    return { row, pc, share, score: raw(pc, damp, row.games, maxItemGames), tier: null as BuildTier | null };
  });
  assignTiers(out);
  return out.sort((a, b) => b.score - a.score);
}

export const isThiefsGlovesBuild = (key: string) => /ThiefsGloves/i.test(key);

/**
 * Builds mit genau n Items behalten. Der Filter "n Items" des Dienstes zaehlt
 * Bauteile mit (Itemzahl auf der Kopie), der Schluessel nicht — ohne diesen
 * Schritt stuenden 2er-Builds in der 3er-Liste (19.10.2026: 32 Zeilen bei Lux).
 * Diebeshandschuhe stehen allein im Schluessel (die Zufallsitems fehlen dort).
 */
export function buildsWithCount<T extends { key: string }>(rows: readonly T[], n: number | null): T[] {
  if (n == null) return [...rows];
  return rows.filter(r => isThiefsGlovesBuild(r.key) || r.key.split('|').length === n);
}

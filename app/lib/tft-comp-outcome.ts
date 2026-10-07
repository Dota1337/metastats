// Rechen-Lib fuer die neuen Bloecke der Comp-Detailseite (Migration 0078).
//
// Eingang ist die Antwort von get_tft_comp_outcome (Summen ueber Tage/Regionen/
// Buckets), Ausgang sind anzeigefertige Zahlen: Platzverteilung, Endlevel-
// Ergebnis, Unit-Wirkung je Spielerlevel und Item-Wirkung je Unit mit Stufe.
//
// Wirkung = Ø Platz mit − Ø Platz ohne. Negativ ist gut (niedrigerer Platz).
// Unsicherheit = ±1,96 · Standardfehler aus den Quadratsummen. Die Spiele einer
// Lobby sind nicht ganz unabhaengig (rund 6 % der Lobbys haben dieselbe Comp
// doppelt) — das ignorieren wir, der Bereich ist dadurch minimal zu schmal.
//
// Tupel-Formate stehen im Kopf von supabase/migrations/0078_tft_comp_outcome.sql.

export const LOW_DATA_GAMES = 200;
export const CORE_SHARE = 0.3;
const Z = 1.96;

export type OutcomeTuple = number[];

export interface CompOutcomeRaw {
  games: number;
  rows_outcome: number;
  rows_stats: number;
  placement_hist: number[];
  level_stats: Record<string, OutcomeTuple>;
  level_stats_s5: Record<string, OutcomeTuple>;
  units: Record<string, {
    t: OutcomeTuple;
    lv: Record<string, OutcomeTuple>;
    it: Record<string, OutcomeTuple>;
    sets: Record<string, OutcomeTuple>;
  }>;
}

export type ItemGroup = 'standard' | 'artifact' | 'radiant' | 'emblem' | 'tactician';
export type ItemGrade = 'core' | 'strong' | 'optional' | 'weak' | null;

export interface Effect {
  /** Ø mit − Ø ohne; negativ = besser */
  delta: number;
  /** halbe Breite des 95-%-Bereichs */
  ci: number;
}

export interface ItemOutcome {
  item: string;
  group: ItemGroup;
  /** Kopien mit dem Item */
  copies: number;
  /** Anteil der Kopien mit 3 fertigen Items, die das Item tragen */
  share: number;
  avgPlacement: number;
  top4Rate: number;
  /** Items je Kopie, wenn getragen (2 = doppelt gebaut) */
  perCopy: number;
  effect: Effect | null;
  grade: ItemGrade;
  lowData: boolean;
}

export interface ItemSetOutcome {
  items: string[];
  copies: number;
  share: number;
  avgPlacement: number;
  top4Rate: number;
}

export interface UnitOutcome {
  characterId: string;
  games: number;
  /** Anteil der Boards der Comp mit der Unit */
  presence: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  /** Wirkung innerhalb gleichen Spielerlevels, nach Spielen gewichtet */
  effect: Effect | null;
  lowData: boolean;
  /** Kopien mit genau 3 fertigen Items */
  itemCopies: number;
  itemCopiesAvg: number | null;
  items: ItemOutcome[];
  sets: ItemSetOutcome[];
  /** Spielerstufe am Spielende -> Boards mit der Unit (Endbrett auf dieser Stufe). */
  levelGames: Record<string, number>;
}

export interface LevelRow {
  level: number;
  games: number;
  share: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
}

export interface CompOutcome {
  games: number;
  lowData: boolean;
  /** Anteil Platz 1..8 */
  placementShare: number[];
  levels: LevelRow[];
  levelsStage5: LevelRow[];
  units: UnitOutcome[];
}

/** Gruppe fuer die Anzeige. Nur 'standard' bekommt eine Stufe. */
export function outcomeItemGroup(apiName: string): ItemGroup {
  // `_Artifact_` mit Unterstrich am Ende — sonst faengt es DA_Artifactinate18
  // (Mechanik, kein Item). Gleiche Regel wie tft-item-bucket.ts.
  if (/_Artifact_/i.test(apiName)) return 'artifact';
  if (/Emblem/i.test(apiName)) return 'emblem';
  if (/Radiant$/.test(apiName)) return 'radiant';
  if (/Tactician/i.test(apiName)) return 'tactician';
  return 'standard';
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * Differenz zweier Mittelwerte mit 95-%-Bereich. n/s/q = Anzahl, Summe,
 * Quadratsumme der Platzierung. null, wenn eine Seite < 2 Werte hat.
 */
export function meanDiff(n1: number, s1: number, q1: number, n2: number, s2: number, q2: number): Effect | null {
  if (n1 < 2 || n2 < 2) return null;
  const m1 = s1 / n1;
  const m2 = s2 / n2;
  const v1 = Math.max(0, (q1 - n1 * m1 * m1) / (n1 - 1));
  const v2 = Math.max(0, (q2 - n2 * m2 * m2) / (n2 - 1));
  return { delta: m1 - m2, ci: Z * Math.sqrt(v1 / n1 + v2 / n2) };
}

export function gradeItem(group: ItemGroup, share: number, effect: Effect | null): ItemGrade {
  if (group !== 'standard') return null;
  if (share >= CORE_SHARE) return 'core';
  if (!effect) return 'optional';
  if (effect.delta + effect.ci < 0) return 'strong';
  if (effect.delta - effect.ci > 0) return 'weak';
  return 'optional';
}

function levelRows(src: Record<string, OutcomeTuple>): LevelRow[] {
  const rows = Object.entries(src || {})
    .map(([lvl, t]) => ({ level: Number(lvl), n: num(t[0]), s: num(t[1]), t4: num(t[3]), t1: num(t[4]) }))
    .filter(r => r.n > 0 && Number.isFinite(r.level));
  const total = rows.reduce((a, r) => a + r.n, 0);
  return rows
    .sort((a, b) => a.level - b.level)
    .map(r => ({
      level: r.level,
      games: r.n,
      share: total > 0 ? r.n / total : 0,
      avgPlacement: r.s / r.n,
      top4Rate: r.t4 / r.n,
      top1Rate: r.t1 / r.n,
    }));
}

/**
 * Unit-Wirkung nur innerhalb gleichen Spielerlevels: je Level Ø mit − Ø ohne,
 * dann nach Spielen mit der Unit gewichtet. Sonst misst die Zahl das Level
 * (5-Kosten-Units stehen auf Level 9 und sehen allein dadurch gut aus).
 */
function unitEffect(unitLv: Record<string, OutcomeTuple>, compLv: Record<string, OutcomeTuple>): Effect | null {
  let wSum = 0;
  let dSum = 0;
  let varSum = 0;
  for (const [lvl, t] of Object.entries(unitLv || {})) {
    const all = compLv?.[lvl];
    if (!all) continue;
    const n1 = num(t[0]), s1 = num(t[1]), q1 = num(t[2]);
    const n2 = num(all[0]) - n1, s2 = num(all[1]) - s1, q2 = num(all[2]) - q1;
    const e = meanDiff(n1, s1, q1, n2, s2, q2);
    if (!e) continue;
    wSum += n1;
    dSum += n1 * e.delta;
    // Varianz der gewichteten Summe: Σ w² · (ci/Z)²
    varSum += n1 * n1 * (e.ci / Z) ** 2;
  }
  if (wSum === 0) return null;
  return { delta: dSum / wSum, ci: (Z * Math.sqrt(varSum)) / wSum };
}

export function buildCompOutcome(raw: CompOutcomeRaw): CompOutcome {
  const games = num(raw.games);
  const hist = (raw.placement_hist || []).map(num);
  const histTotal = hist.reduce((a, b) => a + b, 0);

  const units: UnitOutcome[] = Object.entries(raw.units || {}).map(([cid, u]) => {
    const t = u.t || [];
    const n = num(t[0]), s = num(t[1]);
    const n3 = num(t[5]), s3 = num(t[6]), q3 = num(t[7]);

    const items: ItemOutcome[] = Object.entries(u.it || {}).map(([item, it]) => {
      const c = num(it[0]), is = num(it[1]), iq = num(it[2]), t4 = num(it[3]), k = num(it[4]);
      const group = outcomeItemGroup(item);
      const share = n3 > 0 ? c / n3 : 0;
      // Ohne-Seite = Kopien mit 3 fertigen Items, die das Item NICHT tragen.
      const effect = group === 'standard' ? meanDiff(c, is, iq, n3 - c, s3 - is, q3 - iq) : null;
      return {
        item,
        group,
        copies: c,
        share,
        avgPlacement: c > 0 ? is / c : 0,
        top4Rate: c > 0 ? t4 / c : 0,
        perCopy: c > 0 ? k / c : 0,
        effect,
        grade: gradeItem(group, share, effect),
        lowData: c < LOW_DATA_GAMES,
      };
    }).sort((a, b) => b.copies - a.copies);

    const sets: ItemSetOutcome[] = Object.entries(u.sets || {}).map(([key, st]) => {
      const c = num(st[0]);
      return {
        items: key.split('|'),
        copies: c,
        share: n3 > 0 ? c / n3 : 0,
        avgPlacement: c > 0 ? num(st[1]) / c : 0,
        top4Rate: c > 0 ? num(st[2]) / c : 0,
      };
    }).sort((a, b) => b.copies - a.copies);

    return {
      characterId: cid,
      games: n,
      presence: games > 0 ? n / games : 0,
      avgPlacement: n > 0 ? s / n : 0,
      top4Rate: n > 0 ? num(t[3]) / n : 0,
      top1Rate: n > 0 ? num(t[4]) / n : 0,
      effect: unitEffect(u.lv, raw.level_stats),
      lowData: n < LOW_DATA_GAMES,
      itemCopies: n3,
      itemCopiesAvg: n3 > 0 ? s3 / n3 : null,
      items,
      sets,
      levelGames: Object.fromEntries(Object.entries(u.lv || {})
        .map(([lvl, t]) => [lvl, num(t[0])] as const)
        .filter(([, n]) => n > 0)),
    };
  }).sort((a, b) => b.games - a.games);

  return {
    games,
    lowData: games < LOW_DATA_GAMES,
    placementShare: hist.map(v => (histTotal > 0 ? v / histTotal : 0)),
    levels: levelRows(raw.level_stats),
    levelsStage5: levelRows(raw.level_stats_s5),
    units,
  };
}

/** Untergrenze wie in der Comp-Liste (minGames=30). */
export const OUTCOME_MIN_GAMES = 30;

/**
 * Bloecke zeigen, sobald im Fenster genug Spiele mit Ergebnis-Zeilen liegen —
 * auch wenn noch nicht jeder Tag welche hat (User 2026-09-29, Weg 3). Die
 * Bloecke nennen ihre eigene Spielzahl. Eine Region schreibt ihren Tag immer
 * am Stueck, halbe Tage einer Region gibt es nicht.
 */
export function outcomeHasData(raw: Pick<CompOutcomeRaw, 'games'> | null | undefined): boolean {
  return !!raw && num(raw.games) >= OUTCOME_MIN_GAMES;
}

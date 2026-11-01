// Bretter einer Comp: welche Zeilen sind EINE Unterzeile (Liste) bzw. EIN Knopf
// (Detailseite)? Eine Regel fuer beide — liefen sie auseinander, zeigte der Knopf
// andere Zahlen als die Liste und die Seite nach dem Klick.
//
// Eingabe ist immer das gezeigte Brett (Top 9, ab 30 %, mind. 8 Units:
// tft-comp-list-units.ts; die Liste bekommt es fertig von der API).
//
//  - Gleiche Units = ein Brett (User-Override C, 21.06.2026).
//  - Brett, dessen Units alle in einem groesseren Brett derselben Comp stehen,
//    gehoert dazu (User 01.11.2026: „hat aber die selben Units wie die 1. Comp
//    auf LVL 9 drin. Füge sie ebenfalls zusammen"). Meist ist das die Grund-Comp
//    und ihre Endstufe, gleiche Logik wie tft-comp-merge.mjs. Stehen mehrere
//    groessere zur Wahl: das meistgespielte, dann der Schluessel.
//  - canJoin begrenzt das: nie ueber eine Teil-Comp hinweg, Reroll bleibt fuer
//    sich (boardJoinRule, dieselbe Reroll-Regel wie tft-comp-merge.mjs).
//  - Gezeigt wird das vollere Brett (boardRows), gezaehlt wird die ganze Gruppe.
// Die Summen der Comp aendern sich dadurch nicht, nur die Einteilung darunter.
import { addMergeRow, isRerollComp, newMergeInput } from './tft-comp-merge.mjs';

export interface BoardGroup<T> {
  // Alle Zeilen der Gruppe, meistgespielte zuerst.
  rows: T[];
  // Die Zeilen des volleren Bretts, meistgespielte zuerst: ihre erste ist der Anker.
  boardRows: T[];
  // Units des volleren Bretts, sortiert.
  board: string[];
}

export interface BoardGroupOptions<T> {
  keyOf: (r: T) => string;
  gamesOf: (r: T) => number;
  boardOf: (r: T) => readonly string[];
  // Darf das kleinere Brett zum groesseren? Ohne Angabe: immer.
  canJoin?: (small: T[], big: T[]) => boolean;
}

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Alle Gruppen unter `rows`, meistgespielte zuerst. Das Ergebnis haengt nicht von der Reihenfolge ab. */
export function boardGroups<T>(rows: readonly T[], opts: BoardGroupOptions<T>): BoardGroup<T>[] {
  const { keyOf, gamesOf, boardOf, canJoin } = opts;
  const order = (a: T, b: T) => gamesOf(b) - gamesOf(a) || compareText(keyOf(a), keyOf(b));
  type Exact = { hash: string; ids: Set<string>; rows: T[]; games: number };
  const exact = new Map<string, Exact>();
  for (const r of rows) {
    const ids = [...new Set(boardOf(r).filter(Boolean))].sort();
    // Zeile ohne Units bleibt fuer sich: die leere Menge steckt sonst in jedem Brett.
    const hash = ids.length > 0 ? ids.join('|') : `~empty~${keyOf(r)}`;
    let e = exact.get(hash);
    if (!e) { e = { hash, ids: new Set(ids), rows: [], games: 0 }; exact.set(hash, e); }
    e.rows.push(r);
    e.games += gamesOf(r);
  }
  const all = [...exact.values()]
    .map(e => ({ ...e, rows: [...e.rows].sort(order) }))
    .sort((a, b) => b.games - a.games || compareText(a.hash, b.hash));
  // Je Brett sein Ziel. Das Ziel ist immer groesser, Kreise gibt es also nicht.
  const target = new Map<Exact, Exact>();
  for (const e of all) {
    if (e.ids.size === 0) continue;
    const big = all.find(o => o !== e && o.ids.size > e.ids.size
      && [...e.ids].every(id => o.ids.has(id))
      && (!canJoin || canJoin(e.rows, o.rows)));
    if (big) target.set(e, big);
  }
  const rootOf = (e: Exact): Exact => {
    let cur = e;
    for (let next = target.get(cur); next; next = target.get(cur)) cur = next;
    return cur;
  };
  const grouped = new Map<Exact, T[]>();
  for (const e of all) {
    const root = rootOf(e);
    const list = grouped.get(root);
    if (list) list.push(...e.rows);
    else grouped.set(root, [...e.rows]);
  }
  return [...grouped.entries()]
    .map(([root, list]) => ({ rows: list.sort(order), boardRows: root.rows, board: [...root.ids] }))
    .sort((a, b) => {
      const sum = (g: { rows: T[] }) => g.rows.reduce((s, r) => s + gamesOf(r), 0);
      return sum(b) - sum(a) || compareText(keyOf(a.rows[0]), keyOf(b.rows[0]));
    });
}

/** Schluessel der Gruppe von `key`, `key` vorn; ohne eigene Zeile nur `key` selbst. */
export function boardGroupMembers<T>(rows: readonly T[], key: string, opts: BoardGroupOptions<T>): string[] {
  const group = boardGroups(rows, opts).find(g => g.rows.some(r => opts.keyOf(r) === key));
  if (!group) return [key];
  return [key, ...group.rows.map(opts.keyOf).filter(k => k !== key)];
}

/**
 * Grenzen des Zusammenlegens: gleiche Teil-Comp, gleicher Reroll-Status. Eine
 * Regel fuer Liste (Browser) und Knoepfe (Server).
 */
export function boardJoinRule<T>(o: {
  gamesOf: (r: T) => number;
  unitsOf: (r: T) => ReadonlyArray<unknown>;
  costOf: (characterId: string) => number | null | undefined;
  isComponent: (apiName: string) => boolean;
  partOf?: (r: T) => string | null | undefined;
}): (small: T[], big: T[]) => boolean {
  const memo = new Map<T[], boolean>();
  const reroll = (rows: T[]): boolean => {
    const hit = memo.get(rows);
    if (hit !== undefined) return hit;
    const input = newMergeInput();
    for (const r of rows) addMergeRow(input, 'x', { games: o.gamesOf(r), units: o.unitsOf(r) as Array<unknown> }, o.isComponent);
    const c = input.get('x');
    const out = c ? isRerollComp(c, o.costOf) : false;
    memo.set(rows, out);
    return out;
  };
  return (small, big) => {
    if (o.partOf && (o.partOf(small[0]) ?? null) !== (o.partOf(big[0]) ?? null)) return false;
    return reroll(small) === reroll(big);
  };
}

// Units, die das gezeigte Brett einer Zeile nicht enthaelt: [characterId, Spiele].
// Sonst fehlte die Zusatz-Unit eines zusammengelegten Bretts in den 8er-Zeilen als
// 0 und ihr Anteil waere zu klein (Lux bei Draven 5 % statt 14 %).
export type RestUnit = readonly [string, number];

type BoardRow<U> = { typicalUnits?: readonly U[] | null; restUnits?: ReadonlyArray<RestUnit> | null };

const n = (v: unknown) => Number(v) || 0;
const SUM_FIELDS = ['carryItemGames', 'carryItemGamesAll', 'tankItemGames', 'star3Games', 'gamesWithOutcome', 'top1', 'top4', 'sumPlacement'] as const;

/**
 * Units einer Gruppe in der Reihenfolge des gezeigten Bretts (`shown`), Zahlen
 * ueber ALLE Zeilen der Gruppe: Zaehler und Nenner aus denselben Zeilen.
 */
export function sumBoardUnits<U extends { characterId: string }>(rows: ReadonlyArray<BoardRow<U>>, shown: readonly U[], games: number): U[] {
  return shown.map(unit => {
    const id = unit.characterId;
    const out: Record<string, unknown> = { ...unit };
    let count = 0;
    let withUnit = 0;
    let dup = 0;
    const sums = new Map<string, number>();
    const items = new Map<string, number>();
    for (const row of rows) {
      const u = row.typicalUnits?.find(x => x.characterId === id) as (U & Record<string, unknown>) | undefined;
      if (!u) {
        const rest = n(row.restUnits?.find(x => x[0] === id)?.[1]);
        count += rest;
        withUnit += rest;
        continue;
      }
      const g = n(u.gamesWithUnit) || n(u.count);
      count += n(u.count);
      withUnit += g;
      dup += (Math.max(1, n(u.multiplicity) || 1) - 1) * g;
      for (const f of SUM_FIELDS) if (u[f] != null) sums.set(f, (sums.get(f) ?? 0) + n(u[f]));
      for (const it of (u.topItems as Array<{ apiName?: string; count?: unknown }> | undefined) ?? []) {
        if (it?.apiName) items.set(it.apiName, (items.get(it.apiName) ?? 0) + n(it.count));
      }
    }
    out.count = count;
    out.gamesWithUnit = withUnit;
    for (const [f, v] of sums) out[f] = v;
    if (out.multiplicity != null) out.multiplicity = withUnit > 0 ? 1 + dup / withUnit : 1;
    if (out.cooccurrence != null) out.cooccurrence = games > 0 ? count / games : 0;
    if (out.topItems != null) {
      out.topItems = [...items.entries()]
        .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
        .map(([apiName, c]) => ({ apiName, count: c }));
    }
    return out as U;
  });
}

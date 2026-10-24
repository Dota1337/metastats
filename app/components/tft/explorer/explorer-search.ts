// Suchzeile des Data Explorers (Plan 19.10.2026, Teil C1): eine Eingabe fuer
// Units, Items und Synergien. „und" / „oder" verknuepfen die Bausteine —
// „und" legt sie in die Hauptliste, „oder" fasst sie mit dem vorigen Baustein
// in einem Kasten zusammen (Kasten = eins davon). Reine Funktionen, damit
// Zerlegen, Treffer und Einfuegen getestet werden koennen.
import {
  EXPLORER_LIMITS, filterCount, groupSize,
  type ExplorerQuery, type FilterGroup, type ItemFilter, type TraitFilter, type UnitFilter,
} from '../../../lib/tft-explorer-query';
import type { ItemBucket } from '../../../lib/tft-item-bucket';
import type { ExplorerOptions, ItemOption, TraitOption, UnitOption } from './explorer-options';

export type PickKind = 'units' | 'items' | 'traits';
export type Pick =
  | { kind: 'units'; f: UnitFilter }
  | { kind: 'items'; f: ItemFilter }
  | { kind: 'traits'; f: TraitFilter };
export type Op = 'and' | 'or';
/** Wo der zuletzt eingefuegte Baustein liegt: Hauptliste oder Kasten g. */
export interface LastRef { kind: PickKind; id: string; where: 'main' | number }

// Reihenfolge der Item-Arten in der Trefferliste (ExplorerSearchBox).
export const ITEM_ORDER = ['standard', 'emblem', 'artifact', 'radiant'] as const;
// Item-Sorten als Knoepfe/Reiter (Unit-Fenster, Drop-down der Suchzeile),
// Reihenfolge wie vom User genannt (Plan 24.10.2026).
export const PICK_KINDS: ItemBucket[] = ['standard', 'artifact', 'emblem', 'radiant'];

const LIMIT: Record<PickKind, number> = { units: EXPLORER_LIMITS.units, items: EXPLORER_LIMITS.items, traits: EXPLORER_LIMITS.traits };

// Verbindungswoerter je Sprache; Satzzeichen gelten immer.
const AND_BASE = ['und', 'and', '&', '+'];
const OR_BASE = ['oder', 'or', '|'];
const AND_LANG: Record<string, string[]> = { ko: ['그리고'], zh: ['且', '和'], es: ['y'], fr: ['et'] };
const OR_LANG: Record<string, string[]> = { ko: ['또는'], zh: ['或'], es: ['o'], fr: ['ou'] };

/** Kleinschreibung, ohne Akzente, Apostrophe und Punkte — „Kog'Maw" = „kogmaw". */
export const normText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’`.\-]/g, '').replace(/\s+/g, ' ').trim();

export interface PhraseTerm { op: Op | null; text: string }

/** „Lux und Jinx oder Vex" → [Lux], [und Jinx], [oder Vex]. */
export function splitPhrase(text: string, lang = 'de'): PhraseTerm[] {
  const and = new Set([...AND_BASE, ...(AND_LANG[lang] ?? [])]);
  const or = new Set([...OR_BASE, ...(OR_LANG[lang] ?? [])]);
  const tokens = text.replace(/[&|+]|且|或/g, ' $& ').split(/\s+/).filter(Boolean);
  const out: PhraseTerm[] = [];
  let op: Op | null = null;
  let words: string[] = [];
  const flush = () => {
    if (words.length) out.push({ op, text: words.join(' ') });
    words = [];
  };
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (and.has(low) || or.has(low)) {
      flush();
      op = or.has(low) ? 'or' : 'and';
      continue;
    }
    words.push(tok);
  }
  flush();
  return out;
}

/** Text nach dem letzten Verbindungswort — der Begriff, der gerade getippt wird. */
export function currentTerm(text: string, lang = 'de'): string {
  const terms = splitPhrase(`${text} x`, lang);
  const last = terms[terms.length - 1]?.text ?? '';
  return last.slice(0, -1).trim();
}

/** Hat die Eingabe mehr als einen Baustein oder beginnt sie mit einem Verbindungswort? */
export const isPhrase = (terms: PhraseTerm[]) => terms.length > 1 || (terms.length === 1 && terms[0].op != null);

// Zusaetze am Begriff: Sterne („3*", „3★", „★★", „2 Sterne") und eine Zahl
// (Trait-Stufe in Units, Item-Anzahl).
const STAR_RE = /(?:^|\s)([1-4])\s*(?:\*|★|sterne?|stars?|성|星)(?=\s|$)/i;
const STAR_RUN_RE = /(?:^|\s)(★{1,4})(?=\s|$)/;
const NUM_RE = /(?:^|\s)(\d{1,2})(?=\s|$)/;

export function termParts(raw: string): { needle: string; stars: number | null; num: number | null } {
  let s = ` ${raw} `;
  let stars: number | null = null;
  let num: number | null = null;
  const m = s.match(STAR_RE) ?? null;
  if (m) { stars = Number(m[1]); s = s.replace(STAR_RE, ' '); } else {
    const r = s.match(STAR_RUN_RE);
    if (r) { stars = r[1].length; s = s.replace(STAR_RUN_RE, ' '); }
  }
  const n = s.match(NUM_RE);
  if (n) { num = Number(n[1]); s = s.replace(NUM_RE, ' '); }
  return { needle: normText(s), stars, num };
}

/** 4 = gleich, 3 = beginnt so, 2 = ein Wort beginnt so, 1 = enthaelt, 0 = nichts. */
export function matchScore(name: string, needle: string): number {
  if (!needle) return 0;
  const n = normText(name);
  if (n === needle) return 4;
  if (n.startsWith(needle)) return 3;
  if (n.split(' ').some(w => w.startsWith(needle))) return 2;
  return n.includes(needle) ? 1 : 0;
}

export interface SearchResults { units: UnitOption[]; items: ItemOption[]; traits: TraitOption[] }

/** Treffer je Art, beste zuerst, gleich gute nach Name. */
export function searchOptions(raw: string, o: ExplorerOptions, max = { units: 8, items: 8, traits: 6 }): SearchResults {
  const { needle } = termParts(raw);
  const rank = <T extends { name: string }>(list: T[], n: number) => list
    .map(x => ({ x, s: matchScore(x.name, needle) }))
    .filter(e => e.s > 0)
    .sort((a, b) => b.s - a.s || a.x.name.localeCompare(b.x.name))
    .slice(0, n)
    .map(e => e.x);
  return { units: rank(o.units, max.units), items: rank(o.items, max.items), traits: rank(o.traits, max.traits) };
}

/** Sterne aus der Schnellwahl: 1★/2★ genau, 3★ und 4★ mindestens. */
export function unitWithStars(id: string, stars: number | null): UnitFilter {
  if (!stars) return { id };
  return stars <= 2 ? { id, s: stars, sx: stars } : { id, s: stars };
}

/** Trait-Stufe aus einer Unit-Zahl: genaue Stufe, sonst die hoechste darunter. */
export function traitLevelFor(mins: number[], units: number | null): number | undefined {
  if (units == null || !mins.length) return undefined;
  let lvl = 0;
  mins.forEach((m, i) => { if (m <= units) lvl = i + 1; });
  return lvl || undefined;
}

/** Bester Baustein fuer einen Begriff: hoechster Treffer, bei Gleichstand in
 *  der Reihenfolge der Trefferliste (Units, Synergien, Items nach Art, Name). */
export function bestPick(raw: string, o: ExplorerOptions): Pick | null {
  const { needle, stars, num } = termParts(raw);
  if (!needle) return null;
  type C = { kind: PickKind; id: string; name: string; s: number; ord: number };
  const cands: C[] = [
    ...o.units.map(x => ({ kind: 'units' as const, id: x.id, name: x.name, s: matchScore(x.name, needle), ord: 0 })),
    ...o.traits.map(x => ({ kind: 'traits' as const, id: x.id, name: x.name, s: matchScore(x.name, needle), ord: 1 })),
    ...o.items.map(x => ({ kind: 'items' as const, id: x.id, name: x.name, s: matchScore(x.name, needle), ord: 2 + ITEM_ORDER.indexOf(x.bucket === 'other' ? 'standard' : x.bucket) / 10 })),
  ].filter(c => c.s > 0);
  if (!cands.length) return null;
  cands.sort((a, b) => b.s - a.s || a.ord - b.ord || a.name.localeCompare(b.name));
  const c = cands[0];
  if (c.kind === 'units') return { kind: 'units', f: unitWithStars(c.id, stars) };
  if (c.kind === 'traits') {
    const l = traitLevelFor(o.traitById.get(c.id)?.mins ?? [], num);
    return { kind: 'traits', f: l ? { id: c.id, l } : { id: c.id } };
  }
  return { kind: 'items', f: num && num >= 2 && num <= 3 ? { id: c.id, n: num } : { id: c.id } };
}

export interface ApplyResult { query: ExplorerQuery; last: LastRef | null; added: boolean }

type Box = { units: UnitFilter[]; items: ItemFilter[]; traits: TraitFilter[] };
const listOf = (q: Box, kind: PickKind) =>
  q[kind] as Array<UnitFilter | ItemFilter | TraitFilter>;
const hasMods = (f: object) => Object.keys(f).some(k => k !== 'id');

/**
 * Fuegt einen Baustein ein. „und" (oder ohne vorigen Baustein): Hauptliste —
 * steht er dort schon, uebernimmt er nur neue Zusaetze (z. B. 3★). „oder":
 * in den Kasten des vorigen Bausteins; lag der in der Hauptliste, ziehen beide
 * in einen neuen Kasten. Grenzen wie EXPLORER_LIMITS; was nicht passt, wird
 * nicht eingefuegt (added = false).
 */
export function applyPick(q: ExplorerQuery, pick: Pick, op: Op, last: LastRef | null): ApplyResult {
  const { kind, f } = pick;
  const total = filterCount(q);
  const toMain = (): ApplyResult => {
    const cur = listOf(q, kind);
    const i = cur.findIndex(x => x.id === f.id);
    if (i >= 0) {
      if (!hasMods(f)) return { query: q, last: { kind, id: f.id, where: 'main' }, added: false };
      const next = cur.map((x, j) => (j === i ? f : x));
      return { query: { ...q, [kind]: next }, last: { kind, id: f.id, where: 'main' }, added: true };
    }
    if (total >= EXPLORER_LIMITS.total || cur.length >= LIMIT[kind]) return { query: q, last, added: false };
    return { query: { ...q, [kind]: [...cur, f] }, last: { kind, id: f.id, where: 'main' }, added: true };
  };
  if (op === 'and' || !last) return toMain();

  if (typeof last.where === 'number') {
    const g = last.where;
    const gr = q.groups[g];
    if (!gr || gr.m !== 'any') return toMain();
    if (listOf(gr, kind).some(x => x.id === f.id)) return { query: q, last: { kind, id: f.id, where: g }, added: false };
    if (total >= EXPLORER_LIMITS.total || groupSize(gr) >= EXPLORER_LIMITS.groupMembers) return { query: q, last, added: false };
    const groups = q.groups.map((x, j) => (j === g ? { ...x, [kind]: [...listOf(x, kind), f] } : x));
    return { query: { ...q, groups }, last: { kind, id: f.id, where: g }, added: true };
  }

  // Voriger Baustein in der Hauptliste: beide ziehen in einen neuen Kasten.
  const prev = listOf(q, last.kind).find(x => x.id === last.id);
  if (!prev || prev.x) return toMain();
  if (last.kind === kind && last.id === f.id) return { query: q, last, added: false };
  if (total >= EXPLORER_LIMITS.total || q.groups.length >= EXPLORER_LIMITS.groups) return { query: q, last, added: false };
  const box: FilterGroup = { m: 'any', units: [], items: [], traits: [] };
  (box[last.kind] as Array<UnitFilter | ItemFilter | TraitFilter>).push(prev);
  (box[kind] as Array<UnitFilter | ItemFilter | TraitFilter>).push(f);
  const g = q.groups.length;
  return {
    query: { ...q, [last.kind]: listOf(q, last.kind).filter(x => x.id !== last.id), groups: [...q.groups, box] },
    last: { kind, id: f.id, where: g },
    added: true,
  };
}

/** Ganze Eingabe übernehmen: jeder Begriff mit seinem Verbindungswort; ein
 *  Begriff ohne Wort am Anfang haengt mit `op` an den vorigen Baustein. */
export function applyPhrase(q: ExplorerQuery, terms: PhraseTerm[], o: ExplorerOptions, op: Op, last: LastRef | null):
  ApplyResult & { missed: string[] } {
  let cur: ApplyResult = { query: q, last, added: false };
  const missed: string[] = [];
  terms.forEach((term, i) => {
    const pick = bestPick(term.text, o);
    if (!pick) { missed.push(term.text); return; }
    const r = applyPick(cur.query, pick, term.op ?? (i === 0 ? op : 'and'), cur.last);
    cur = { query: r.query, last: r.last, added: cur.added || r.added };
  });
  return { ...cur, missed };
}

// ── Drop-down der Suchzeile (Plan 24.10.2026): Reiter mit Bilder-Raster ──

/** Schluessel eines Bausteins in chosenIds. */
export const pickKey = (kind: PickKind, id: string) => `${kind}:${id}`;

/** Gewaehlte Bausteine (Hauptliste und Kaesten); out = „ohne" bzw. „keins davon" aus alten Links. */
export function chosenIds(q: ExplorerQuery): { on: Set<string>; out: Set<string> } {
  const on = new Set<string>();
  const out = new Set<string>();
  const add = (b: Box, none: boolean) => (['units', 'items', 'traits'] as const).forEach(kind =>
    listOf(b, kind).forEach(f => (none || f.x ? out : on).add(pickKey(kind, f.id))));
  add(q, false);
  q.groups.forEach(g => add(g, g.m === 'none'));
  return { on, out };
}

/**
 * Nimmt einen Baustein ueberall heraus (Hauptliste und Kaesten); leer
 * gewordene Kaesten fallen weg wie in moveFilter. `last` wird neu
 * nummeriert oder verworfen, wenn es auf den Baustein zeigte.
 */
export function removeEverywhere(q: ExplorerQuery, kind: PickKind, id: string, last: LastRef | null):
  { query: ExplorerQuery; last: LastRef | null } {
  const drop = <T extends Box>(b: T): T => ({ ...b, [kind]: listOf(b, kind).filter(f => f.id !== id) });
  const groups: FilterGroup[] = [];
  const renum = new Map<number, number>();
  q.groups.forEach((g, i) => {
    const n = drop(g);
    if (groupSize(n) > 0) { renum.set(i, groups.length); groups.push(n); }
  });
  let ref = last;
  if (ref && ref.kind === kind && ref.id === id) ref = null;
  else if (ref && typeof ref.where === 'number') {
    const w = renum.get(ref.where);
    ref = w == null ? null : { ...ref, where: w };
  }
  return { query: { ...drop(q), groups }, last: ref };
}

// Platzhalter fuer die Probe: kommt in keiner echten Kennung vor (ID_RE).
const PROBE_ID = '\u0000';
/** Passt noch ein (neuer) Baustein dieser Art? Probe ueber applyPick, damit die Grenzen an einer Stelle bleiben. */
export const canAdd = (q: ExplorerQuery, kind: PickKind, op: Op, last: LastRef | null): boolean =>
  applyPick(q, { kind, f: { id: PROBE_ID } } as Pick, op, last).added;

/** Units fuers Raster: je Kostenstufe eine Zeile. Formen „Lux (Coven)" fallen weg, wenn es die Basis „Lux" gibt. */
export function browseUnits(units: UnitOption[]): UnitOption[][] {
  const names = new Set(units.map(u => u.name));
  const byCost = new Map<number, UnitOption[]>();
  for (const u of units) {
    const base = /^(.+?)\s*\([^)]*\)$/.exec(u.name)?.[1];
    if (base && names.has(base)) continue;
    byCost.set(u.cost, [...(byCost.get(u.cost) ?? []), u]);
  }
  return [...byCost.keys()].sort((a, b) => a - b)
    .map(c => byCost.get(c)!.sort((a, b) => a.name.localeCompare(b.name)));
}

/** Synergien fuers Raster: alphabetisch, Einstufen-Synergien (hoechstens 1 Unit) abgesetzt dahinter. */
export function browseTraits(traits: TraitOption[]): TraitOption[][] {
  const single = (x: TraitOption) => Math.max(0, ...x.mins) <= 1;
  const byName = (a: TraitOption, b: TraitOption) => a.name.localeCompare(b.name);
  return [traits.filter(x => !single(x)).sort(byName), traits.filter(single).sort(byName)].filter(r => r.length);
}

export type GridDir = 'left' | 'right' | 'up' | 'down';
/**
 * Pfeiltasten im Raster. `sections` = Laenge je Abschnitt (jeder beginnt eine
 * neue Zeile und bricht nach `cols` um), `idx` = Feld ueber alle Abschnitte,
 * -1 = noch keins markiert. Hoch/runter behaelt die Spalte, soweit die Zeile reicht.
 */
export function gridMove(sections: number[], cols: number, idx: number, dir: GridDir): number {
  const rows: { start: number; len: number }[] = [];
  let start = 0;
  for (const len of sections) {
    for (let o = 0; o < len; o += Math.max(1, cols)) rows.push({ start: start + o, len: Math.min(Math.max(1, cols), len - o) });
    start += len;
  }
  if (!start) return -1;
  if (idx < 0 || idx >= start) return 0;
  if (dir === 'left') return Math.max(0, idx - 1);
  if (dir === 'right') return Math.min(start - 1, idx + 1);
  const r = rows.findIndex(x => idx >= x.start && idx < x.start + x.len);
  const to = rows[r + (dir === 'up' ? -1 : 1)];
  return to ? to.start + Math.min(idx - rows[r].start, to.len - 1) : idx;
}

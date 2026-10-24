// Kurze URL-Form des Data Explorers und ihre Uebersetzung in die Anfrage an
// den Abfrage-Dienst (scripts/explorer-duckdb-server.mjs).
//
// Die Seite und die API-Route benutzen dieselbe Form, damit die URL der Seite
// 1:1 als Cache-Schluessel der API taugt:
//   r=euw1                      Region (fehlt = alle)
//   k=challenger,emerald        Raenge (fehlt = alle, inkl. Boards ohne Rang)
//   p=18.3,18.2                 Patches (fehlt = neuester Patch, p=all = alle im Speicher)
//   lv=8,9                      Spieler-Level am Ende (fehlt = alle)
//   pl=1-4                      Endplatz von–bis (fehlt = 1-8)
//   u=!ID:s2e:n2:iITEM:xITEM    Units; ! = ohne, s2 = mind. 2 Sterne (e = genau,
//                               s1-2 = 1 bis 2), n2 = mind. 2 Items (n0e = genau 0,
//                               n0-1 = hoechstens 1), c2 = mind. 2 Kopien auf dem Brett,
//                               iX = mit Item X (zweimal = zweimal an der Kopie),
//                               xX = ohne Item X, kemblem2 = mind. 2 Embleme an der Kopie
//   i=ITEM:n2,!ITEM             Items irgendwo auf dem Board; n2 = mind. zweimal
//   t=ID:l2e,!ID                Traits; l2 = mind. Stufe 2 (e = genau)
//   g1=any,u.ID:s2,i.X,t.T:l2   Kaesten: any = eins davon, none = keins davon (g1-g3)
//   bc=emb:2-,k5:2-3,tr:0       Brett-Zaehler: 2- = mind. 2, -3 = hoechstens 3,
//                               2-3 = 2 bis 3, 0 = genau 0 (tr:0 = keine Traits)
//   tg=shred,wound              Brett traegt alle genannten Tags
//   tab, f (Traeger im Item- und Builds-Reiter), split=over (Traits), c (1-3 Items je Kombi)
//   st=2,3                      Units-Reiter: Sternstufen vergleichen (API: split=star)
//
// Die Bedeutung der Felder steht im Kopf von scripts/lib/explorer-normalize.mjs;
// der Dienst bringt die Anfrage in dieselbe kanonische Form wie hier.
// Alte Links (?units=&items=&traits=&bucket=&region=) von den Unit-, Item-
// und Trait-Seiten werden beim Lesen uebernommen.

import type { TierBucket } from './tft-tier-bucket';
import { patchFamily } from './snapshot-matrix';

export const EXPLORER_RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD'] as const;
export type ExplorerRank = (typeof EXPLORER_RANKS)[number];

export const EXPLORER_TABS = ['units', 'items', 'builds', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank', 'games'] as const;
export type ExplorerTab = (typeof EXPLORER_TABS)[number];

export const ITEM_KINDS = ['artifact', 'emblem', 'radiant'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

// Brett-Zaehler und Tags wie im Dienst (COUNT_KEYS, COUNT_MAX, TAGS in
// scripts/lib/explorer-counts.mjs; der Test prueft den Gleichlauf). Hier als
// Kopie, weil die Datei auch im Browser laeuft.
export const BOARD_COUNT_KEYS = ['emb', 'rad', 'art', 'norm', 's3', 's4', 'dup', 'k1', 'k2', 'k3', 'k4', 'k5', 'bronze', 'extra', 'tr'] as const;
export type BoardCountKey = (typeof BOARD_COUNT_KEYS)[number];
export const BOARD_COUNT_MAX = 15;
export const BOARD_TAGS = ['shred', 'sunder', 'wound'] as const;
export type BoardTag = (typeof BOARD_TAGS)[number];
/** n..nx auf dem Brett; n ohne nx = mind., nx ohne n = hoechstens. */
export interface BoardCount { k: BoardCountKey; n?: number; nx?: number }

export interface UnitFilter {
  id: string; x?: boolean;
  /** Sterne von s bis sx (je Kopie); s ohne sx = mind., sx ohne s = hoechstens. */
  s?: number; sx?: number;
  /** Itemzahl von n bis nx (je Kopie). */
  n?: number; nx?: number;
  /** Mindestens so viele Kopien der Unit auf dem Brett. */
  c?: number;
  it?: string[]; nit?: string[];
  /** Mindestens n Items der Sorte b an der Kopie. */
  k?: { b: ItemKind; n: number }[];
}
export interface ItemFilter { id: string; x?: boolean; n?: number }
export interface TraitFilter { id: string; x?: boolean; l?: number; le?: boolean }
export interface FilterGroup { m: 'any' | 'none'; units: UnitFilter[]; items: ItemFilter[]; traits: TraitFilter[] }

export interface ExplorerQuery {
  region: string;
  ranks: ExplorerRank[];
  patches: string[];
  levels: number[];
  place: [number, number] | null;
  units: UnitFilter[];
  items: ItemFilter[];
  traits: TraitFilter[];
  groups: FilterGroup[];
  /** Brett-Zaehler (zaehlen nicht zur Filtergrenze). */
  bc: BoardCount[];
  tags: BoardTag[];
  tab: ExplorerTab;
  /** Traeger im Item- und Builds-Reiter. */
  focus: string | null;
  split: 'star' | 'over' | null;
  /** Units-Reiter: gewaehlte Sternstufen (1-4). Nicht leer → split=star an den Dienst. */
  stars: number[];
  combo: 1 | 2 | 3;
}

// Grenzen wie im Dienst (LIMITS in explorer-normalize.mjs).
export const EXPLORER_LIMITS = { units: 9, items: 6, traits: 6, groups: 3, groupMembers: 6, total: 15 } as const;

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REGION_RE = /^[a-z0-9]{2,5}$/;
const PATCH_RE = /^\d{1,2}\.\d{1,2}[a-z]?$/;

// Platzhalter fuer "neuester Patch im Speicher"; der Abfrage-Dienst loest ihn auf.
export const LATEST_PATCH = 'latest';

/**
 * Patches der Explorer-Leiste (User 24.10.2026): die Familie des neuesten
 * Patches komplett plus die ganze vorige Familie — heute 18.5b, 18.5 | 18.4,
 * mit 18.6 dann 18.6 | 18.5b, 18.5. Bewusst anders als die Patch-Auswahl der
 * Listen (StatsFilterBar: Vorpatch nach previousPatchOf, ≥3 Datentage) und der
 * Δ-Vorpatch: der User wollte die vorige Familie ganz. Aeltere Patches erreicht
 * nur ein Link; die Leiste zeigt sie dann als eigenen Knopf.
 * patches: neueste zuerst (meta.patches).
 */
export function barPatches(patches: readonly string[]): string[] {
  const families: string[] = [];
  return patches.filter(p => {
    const f = patchFamily(p);
    if (!families.includes(f)) families.push(f);
    return families.indexOf(f) < 2;
  });
}

export const EMPTY_QUERY: ExplorerQuery = {
  region: 'all', ranks: [], patches: [LATEST_PATCH], levels: [], place: null, units: [], items: [], traits: [], groups: [],
  bc: [], tags: [], tab: 'units', focus: null, split: null, stars: [], combo: 1,
};

type Params = { get(name: string): string | null };

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);
export const groupSize = (g: FilterGroup) => g.units.length + g.items.length + g.traits.length;

/** Wirkt der Traeger in diesem Reiter? Nur dann geht er an den Dienst. */
export const focusApplies = (tab: ExplorerTab) => tab === 'items' || tab === 'builds';

// Traeger folgt der Suche (Plan 24.10.2026, W1). Units der Hauptliste ohne
// „ohne"; Reihenfolge = Einfuege-Reihenfolge des Aufrufers.
const mainUnitIds = (q: ExplorerQuery) => q.units.filter(u => !u.x).map(u => u.id);
const allUnitIds = (q: ExplorerQuery) => new Set([
  ...mainUnitIds(q), ...q.groups.filter(g => g.m === 'any').flatMap(g => g.units.map(u => u.id)),
]);

/**
 * Traeger nach einer Aenderung von prev zu next. `cleared`: der Besucher hat
 * „—" gewaehlt (Seitenzustand, ueberlebt kein Neuladen).
 * - focus selbst geaendert (Auswahlfeld, Zuruecksetzen, Zeilen-Knopf) → bleibt so;
 * - kein Traeger und eine Unit kommt neu in die Hauptliste → die Unit, die
 *   schon ohne Traeger dort stand (alter Link, Unit-Seite), sonst die erste
 *   neue (Einfuege-Reihenfolge = zuerst gesucht); nach „—" immer die neue;
 * - Wechsel auf Items ohne Traeger und ohne „—", auf Builds immer (Builds
 *   brauchen einen) → erste Unit der Hauptliste;
 * - die Traeger-Unit stand in einem Baustein und ist aus allen verschwunden →
 *   erste uebrige Unit der Hauptliste, sonst keiner. In einen oder-Kasten
 *   verschoben zaehlt nicht als verschwunden.
 * Ein Traeger ausserhalb aller Bausteine (im Auswahlfeld gewaehlt) bleibt stehen.
 */
export function followFocus(prev: ExplorerQuery, next: ExplorerQuery, { cleared = false } = {}): ExplorerQuery {
  if (next.focus !== prev.focus) return next;
  const main = mainUnitIds(next);
  if (!next.focus) {
    const before = mainUnitIds(prev);
    const added = main.find(id => !before.includes(id));
    if (added) return { ...next, focus: (!cleared && before.find(id => main.includes(id))) || added };
    const toTab = next.tab !== prev.tab && (next.tab === 'builds' || (next.tab === 'items' && !cleared));
    return toTab && main.length ? { ...next, focus: main[0] } : next;
  }
  if (!allUnitIds(prev).has(next.focus) || allUnitIds(next).has(next.focus)) return next;
  return { ...next, focus: main[0] ?? null, combo: 1 };
}

/** Anzahl aller Bedingungen (Units, Items, Traits, Kasten-Glieder). */
export const filterCount = (q: Pick<ExplorerQuery, 'units' | 'items' | 'traits' | 'groups'>) =>
  q.units.length + q.items.length + q.traits.length + q.groups.reduce((a, g) => a + groupSize(g), 0);

/** Brett-Filter vorhanden? (Level/Platz gehoeren wie der Rang zur Grundmenge.) */
export const hasBoardFilters = (q: Pick<ExplorerQuery, 'units' | 'items' | 'traits' | 'groups'> & Partial<Pick<ExplorerQuery, 'bc' | 'tags'>>) =>
  filterCount(q) > 0 || (q.bc?.length ?? 0) > 0 || (q.tags?.length ?? 0) > 0;

/** Kanonische Brett-Zaehler wie span() im Dienst: Grenzen ohne Wirkung fallen
 *  weg, jeder Zaehler einmal (erster gewinnt), feste Reihenfolge. */
export function canonBoardCounts(list: BoardCount[]): BoardCount[] {
  const seen = new Set<string>();
  const out: BoardCount[] = [];
  for (const e of list) {
    if (!(BOARD_COUNT_KEYS as readonly string[]).includes(e.k) || seen.has(e.k)) continue;
    const ok = (v: number | undefined) => v == null || (Number.isInteger(v) && v >= 0 && v <= BOARD_COUNT_MAX);
    if (!ok(e.n) || !ok(e.nx) || (e.n != null && e.nx != null && e.n > e.nx)) continue;
    const lo = e.n ?? 0;
    const hi = e.nx ?? BOARD_COUNT_MAX;
    const c: BoardCount = { k: e.k };
    if (!(lo === 0 && hi !== lo)) c.n = lo;
    if (hi !== BOARD_COUNT_MAX) c.nx = hi;
    if (c.n == null && c.nx == null) continue;
    seen.add(e.k);
    out.push(c);
  }
  return out.sort((a, b) => BOARD_COUNT_KEYS.indexOf(a.k) - BOARD_COUNT_KEYS.indexOf(b.k));
}

const canonTags = (list: string[]): BoardTag[] =>
  BOARD_TAGS.filter(t => list.includes(t));

// "2-" | "-3" | "2-3" | "2" (genau)
function parseBoardCount(tok: string): BoardCount | null {
  const m = /^([a-z0-9]+):(\d{1,2})?(-)?(\d{1,2})?$/.exec(tok);
  if (!m || (m[2] == null && m[4] == null)) return null;
  const lo = m[2] != null ? Number(m[2]) : undefined;
  const hi = m[4] != null ? Number(m[4]) : undefined;
  if (!m[3]) return lo != null && hi == null ? { k: m[1] as BoardCountKey, n: lo, nx: lo } : null;
  return { k: m[1] as BoardCountKey, n: lo, nx: hi };
}

function boardCountToken(e: BoardCount): string {
  if (e.n != null && e.nx != null) return e.n === e.nx ? `${e.k}:${e.n}` : `${e.k}:${e.n}-${e.nx}`;
  return e.n != null ? `${e.k}:${e.n}-` : `${e.k}:-${e.nx}`;
}

// Spanne lo..hi gueltig? Verkehrte Spanne oder Werte ausserhalb fallen ganz weg.
// Grenzen ohne Wirkung (mind. 1★) bleiben stehen: alte Links bleiben
// zeichengleich und ein Klick auf „1★" springt nicht zurueck auf „egal".
// Der Dienst kuerzt sie selbst (span() in explorer-normalize.mjs).
const okSpan = (lo: number | undefined, hi: number | undefined, min: number, max: number) =>
  (lo == null || (Number.isInteger(lo) && lo >= min && lo <= max))
  && (hi == null || (Number.isInteger(hi) && hi >= min && hi <= max))
  && !(lo != null && hi != null && lo > hi);

/** Kanonische Form einer Unit-Bedingung (gleiche Auswahl = gleiche URL). */
export function canonUnit(u: UnitFilter): UnitFilter {
  const out: UnitFilter = { id: u.id };
  if (u.x) out.x = true;
  if (okSpan(u.s, u.sx, 1, 4)) {
    if (u.s != null) out.s = u.s;
    if (u.sx != null) out.sx = u.sx;
  }
  // „mind. 0 Items" schrieb schon der alte Stand nicht in die Adresse.
  if (okSpan(u.n, u.nx, 0, 3)) {
    if (u.n != null && (u.n > 0 || u.nx != null)) out.n = u.n;
    if (u.nx != null) out.nx = u.nx;
  }
  if (u.c === 2 || u.c === 3) out.c = u.c;
  // Items in Klick-Reihenfolge wie bisher (alte Links bleiben zeichengleich).
  const it = (u.it ?? []).slice(0, 3);
  if (it.length) out.it = it;
  const nit = (u.nit ?? []).slice(0, 3);
  if (nit.length) out.nit = nit;
  const k = ITEM_KINDS.flatMap(b => {
    const e = (u.k ?? []).find(x => x.b === b);
    return e && e.n >= 1 && e.n <= 3 ? [{ b, n: e.n }] : [];
  });
  if (k.length) out.k = k;
  return out;
}

export function canonItem(i: ItemFilter): ItemFilter {
  const out: ItemFilter = { id: i.id };
  if (i.x) out.x = true;
  if (i.n != null && i.n >= 2 && i.n <= 3) out.n = i.n;
  return out;
}

export function canonTrait(t: TraitFilter): TraitFilter {
  const out: TraitFilter = { id: t.id };
  if (t.x) out.x = true;
  if (t.l != null && t.l >= 1 && t.l <= 6) { out.l = t.l; if (t.le) out.le = true; }
  return out;
}

// "2" | "2e" | "1-3" → [lo, hi]
function parseSpan(rest: string): [number, number | undefined] | null {
  const m = /^(\d)(?:(e)|-(\d))?$/.exec(rest);
  if (!m) return null;
  const lo = Number(m[1]);
  return [lo, m[2] ? lo : m[3] != null ? Number(m[3]) : undefined];
}

function parseUnit(tok: string): UnitFilter | null {
  const x = tok.startsWith('!');
  const [id, ...mods] = (x ? tok.slice(1) : tok).split(':');
  if (!ID_RE.test(id)) return null;
  const u: UnitFilter = { id };
  if (x) u.x = true;
  for (const m of mods) {
    const head = m[0];
    const rest = m.slice(1);
    if (head === 's') {
      const sp = parseSpan(rest);
      if (sp) { u.s = sp[0]; u.sx = sp[1]; }
    } else if (head === 'n') {
      const sp = parseSpan(rest);
      if (sp) { u.n = sp[0]; u.nx = sp[1]; }
    } else if (head === 'c') {
      const c = Number(rest);
      if (c === 2 || c === 3) u.c = c;
    } else if (head === 'k') {
      const km = /^(artifact|emblem|radiant)([1-3])$/.exec(rest);
      if (km && !(u.k ?? []).some(e => e.b === km[1])) u.k = [...(u.k ?? []), { b: km[1] as ItemKind, n: Number(km[2]) }];
    } else if (head === 'i' && ID_RE.test(rest)) {
      u.it = [...(u.it ?? []), rest].slice(0, 3);
    } else if (head === 'x' && ID_RE.test(rest)) {
      u.nit = [...(u.nit ?? []), rest].slice(0, 3);
    }
  }
  return canonUnit(u);
}

function parseItem(tok: string): ItemFilter | null {
  const x = tok.startsWith('!');
  const [id, ...mods] = (x ? tok.slice(1) : tok).split(':');
  if (!ID_RE.test(id)) return null;
  const i: ItemFilter = { id };
  if (x) i.x = true;
  for (const m of mods) {
    const nm = /^n([23])$/.exec(m);
    if (nm) i.n = Number(nm[1]);
  }
  return canonItem(i);
}

function parseTrait(tok: string): TraitFilter | null {
  const x = tok.startsWith('!');
  const [id, mod] = (x ? tok.slice(1) : tok).split(':');
  if (!ID_RE.test(id)) return null;
  const t: TraitFilter = { id };
  if (x) t.x = true;
  if (mod?.startsWith('l')) {
    const exact = mod.endsWith('e');
    const n = Number(exact ? mod.slice(1, -1) : mod.slice(1));
    if (Number.isInteger(n) && n >= 1 && n <= 6) { t.l = n; if (exact) t.le = true; }
  }
  return t;
}

// Kasten: erstes Glied any|none, dann u.<Unit>, i.<Item>, t.<Trait> ohne „!".
function parseGroup(raw: string | null): FilterGroup | null {
  const [m, ...members] = list(raw);
  if (m !== 'any' && m !== 'none') return null;
  const g: FilterGroup = { m, units: [], items: [], traits: [] };
  // Je Art jede ID nur einmal (die Oberflaeche aendert Glieder ueber die ID).
  const seen = new Set<string>();
  const once = (kind: string, id: string) => !seen.has(`${kind}${id}`) && (seen.add(`${kind}${id}`), true);
  for (const tok of members) {
    if (groupSize(g) >= EXPLORER_LIMITS.groupMembers) break;
    const kind = tok.slice(0, 2);
    const body = tok.slice(2);
    if (body.startsWith('!')) continue;
    if (kind === 'u.') { const u = parseUnit(body); if (u && once(kind, u.id)) g.units.push(u); }
    else if (kind === 'i.') { const i = parseItem(body); if (i && once(kind, i.id)) g.items.push(i); }
    else if (kind === 't.') { const t = parseTrait(body); if (t && once(kind, t.id)) g.traits.push(t); }
  }
  return groupSize(g) ? g : null;
}

const uniqBy = <T extends { id: string }>(arr: (T | null)[]) => {
  const seen = new Set<string>();
  return arr.filter((a): a is T => !!a && !seen.has(a.id) && (seen.add(a.id), true));
};

// Rang-Stufen der Explorer-Leiste (Plan 19.10.2026, B1): X+ = Rang X bis
// Challenger. Eine Tabelle fuer beide Richtungen (Stufe → Raenge, Raenge →
// Stufe), damit Knopf, alte Links und Vorwaermen nicht auseinanderlaufen.
export type ExplorerRankStage = Exclude<TierBucket, 'all' | 'platinum_plus'>;
export const EXPLORER_RANK_STAGES: readonly ExplorerRankStage[] = [
  'challenger', 'grandmaster_plus', 'master_plus', 'diamond_plus', 'emerald_plus',
];

/** Raenge einer Stufe, von oben (EXPLORER_RANKS ist absteigend sortiert). */
export const stageRanks = (stage: ExplorerRankStage): ExplorerRank[] =>
  EXPLORER_RANKS.slice(0, EXPLORER_RANK_STAGES.indexOf(stage) + 1);

/** Welche Stufe ist gewaehlt? 'all' ohne Rang, null bei einer Auswahl, die keine Stufe ist (alter Link, Reiter Rang). */
export function rankStageOf(ranks: readonly ExplorerRank[]): ExplorerRankStage | 'all' | null {
  if (!ranks.length) return 'all';
  const set = new Set(ranks);
  return EXPLORER_RANK_STAGES.find(s => {
    const r = stageRanks(s);
    return r.length === set.size && r.every(x => set.has(x));
  }) ?? null;
}

// Alte Rang-Stufen (TierFilter) auf die Raenge im Speicher abbilden. Unter
// Smaragd gibt es im Speicher nichts, daher "emerald_plus oder tiefer" = alle fuenf.
export function legacyBucketToRanks(bucket: string | null): ExplorerRank[] {
  if (bucket === 'platinum_plus') return stageRanks('emerald_plus');
  return (EXPLORER_RANK_STAGES as readonly string[]).includes(bucket ?? '') ? stageRanks(bucket as ExplorerRankStage) : [];
}

export function parseExplorerParams(sp: Params): ExplorerQuery {
  const q: ExplorerQuery = { ...EMPTY_QUERY };
  const r = sp.get('r') ?? sp.get('region');
  if (r && REGION_RE.test(r.toLowerCase())) q.region = r.toLowerCase();

  // Alte Links mit k=unknown: der Rang faellt still weg.
  const k = list(sp.get('k')).map(x => x.toUpperCase());
  q.ranks = k.length
    ? [...new Set(k.filter((x): x is ExplorerRank => (EXPLORER_RANKS as readonly string[]).includes(x)))].sort()
    : legacyBucketToRanks(sp.get('bucket'));

  const p = sp.get('p');
  if (p === 'all') q.patches = [];
  else {
    const ps = [...new Set(list(p).filter(x => PATCH_RE.test(x)))].sort().slice(0, 12);
    q.patches = ps.length ? ps : [LATEST_PATCH];
  }

  // Alle zehn Level = keine Einschraenkung (wie im Dienst).
  const lv = [...new Set(list(sp.get('lv')).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 10))].sort((a, b) => a - b);
  q.levels = lv.length === 10 ? [] : lv;
  const pl = /^([1-8])(?:-([1-8]))?$/.exec(sp.get('pl') ?? '');
  if (pl) {
    const lo = Number(pl[1]);
    const hi = pl[2] ? Number(pl[2]) : lo;
    q.place = lo <= hi && !(lo === 1 && hi === 8) ? [lo, hi] : null;
  }

  q.units = uniqBy([...list(sp.get('u')), ...list(sp.get('units'))].map(parseUnit)).slice(0, EXPLORER_LIMITS.units);
  q.items = uniqBy([...list(sp.get('i')), ...list(sp.get('items'))].map(parseItem)).slice(0, EXPLORER_LIMITS.items);
  q.traits = uniqBy([...list(sp.get('t')), ...list(sp.get('traits'))].map(parseTrait)).slice(0, EXPLORER_LIMITS.traits);

  // Kaesten nur, soweit die Gesamtgrenze reicht.
  let left = EXPLORER_LIMITS.total - filterCount({ ...q, groups: [] });
  q.groups = [];
  for (let n = 1; n <= EXPLORER_LIMITS.groups; n++) {
    const g = parseGroup(sp.get(`g${n}`));
    if (!g || left <= 0) continue;
    while (groupSize(g) > left) {
      if (g.traits.length) g.traits.pop(); else if (g.items.length) g.items.pop(); else g.units.pop();
    }
    left -= groupSize(g);
    q.groups.push(g);
  }

  q.bc = canonBoardCounts(list(sp.get('bc')).map(parseBoardCount).filter((e): e is BoardCount => !!e));
  q.tags = canonTags(list(sp.get('tg')));

  const tab = sp.get('tab');
  if (tab && (EXPLORER_TABS as readonly string[]).includes(tab)) q.tab = tab as ExplorerTab;
  const f = sp.get('f');
  if (f && ID_RE.test(f)) q.focus = f;
  const split = sp.get('split');
  if (split === 'star' || split === 'over') q.split = split;
  const st = [...new Set(list(sp.get('st')).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 4))].sort();
  // split=star ohne st (alte Links, API-Form): alle Stufen nebeneinander.
  if (q.tab === 'units' && (st.length || q.split === 'star')) {
    q.stars = st.length ? st : [1, 2, 3, 4];
    q.split = 'star';
  } else if (q.split === 'star') q.split = null;
  const c = Number(sp.get('c'));
  if (c === 2 || c === 3) q.combo = c;
  return q;
}

function spanToken(head: string, lo: number | undefined, hi: number | undefined, min: number): string {
  if (lo == null && hi == null) return '';
  if (hi == null) return `:${head}${lo}`;
  if (lo === hi) return `:${head}${lo}e`;
  return `:${head}${lo ?? min}-${hi}`;
}

function unitToken(raw: UnitFilter): string {
  const u = canonUnit(raw);
  let s = `${u.x ? '!' : ''}${u.id}`;
  s += spanToken('s', u.s, u.sx, 1);
  s += spanToken('n', u.n, u.nx, 0);
  if (u.c) s += `:c${u.c}`;
  for (const it of u.it ?? []) s += `:i${it}`;
  for (const it of u.nit ?? []) s += `:x${it}`;
  for (const e of u.k ?? []) s += `:k${e.b}${e.n}`;
  return s;
}

function itemToken(raw: ItemFilter): string {
  const i = canonItem(raw);
  return `${i.x ? '!' : ''}${i.id}${i.n ? `:n${i.n}` : ''}`;
}

function traitToken(raw: TraitFilter): string {
  const t = canonTrait(raw);
  return `${t.x ? '!' : ''}${t.id}${t.l ? `:l${t.l}${t.le ? 'e' : ''}` : ''}`;
}

function groupToken(g: FilterGroup): string {
  const members = [
    ...g.units.map(u => `u.${unitToken({ ...u, x: false })}`),
    ...g.items.map(i => `i.${itemToken({ ...i, x: false })}`),
    ...g.traits.map(t => `t.${traitToken({ ...t, x: false })}`),
  ];
  return [g.m, ...[...new Set(members)].sort()].join(',');
}

// Feste Reihenfolge und Sortierung → gleiche Auswahl, gleiche URL, gleicher
// Cache-Eintrag bei Vercel.
export function serializeExplorerQuery(q: ExplorerQuery, { forApi = false } = {}): string {
  const sp = new URLSearchParams();
  if (q.region !== 'all') sp.set('r', q.region);
  if (q.ranks.length) sp.set('k', [...q.ranks].sort().map(r => r.toLowerCase()).join(','));
  if (q.patches.length === 0) sp.set('p', 'all');
  else if (q.patches[0] !== LATEST_PATCH) sp.set('p', [...q.patches].sort().join(','));
  const lv = [...new Set(q.levels)].sort((a, b) => a - b);
  if (lv.length && lv.length < 10) sp.set('lv', lv.join(','));
  if (q.place && !(q.place[0] === 1 && q.place[1] === 8)) {
    sp.set('pl', q.place[0] === q.place[1] ? String(q.place[0]) : `${q.place[0]}-${q.place[1]}`);
  }
  if (q.units.length) sp.set('u', q.units.map(unitToken).sort().join(','));
  if (q.items.length) sp.set('i', q.items.map(itemToken).sort().join(','));
  if (q.traits.length) sp.set('t', q.traits.map(traitToken).sort().join(','));
  // Kaesten in Anlege-Reihenfolge (die Oberflaeche merkt sich den Kasten ueber
  // seine Nummer); Glieder darin sortiert.
  q.groups.filter(g => groupSize(g) > 0).map(groupToken).forEach((g, n) => sp.set(`g${n + 1}`, g));
  const bc = canonBoardCounts(q.bc ?? []);
  if (bc.length) sp.set('bc', bc.map(boardCountToken).join(','));
  const tg = canonTags(q.tags ?? []);
  if (tg.length) sp.set('tg', tg.join(','));
  if (forApi || q.tab !== 'units') sp.set('tab', q.tab);
  // Traeger wirkt nur im Item- und Builds-Reiter, Kombi-Groesse nur bei Items,
  // Aufteilung nur bei Units/Traits — sonst weglassen, damit sie den Cache
  // nicht zersplittern. Die Seiten-Adresse behaelt den Traeger auf jedem
  // Reiter (die Suche setzt ihn auch im Units-Reiter, W1); die Route leitet
  // eine API-Adresse mit f auf anderen Reitern per 308 um.
  if (q.focus && (!forApi || focusApplies(q.tab))) sp.set('f', q.focus);
  if (q.tab === 'items' && q.focus && q.combo !== 1) sp.set('c', String(q.combo));
  if (q.tab === 'units' && q.stars.length) {
    if (forApi) sp.set('split', 'star');
    else sp.set('st', [...q.stars].sort().join(','));
  }
  if (q.split === 'over' && q.tab === 'traits') sp.set('split', 'over');
  return sp.toString();
}

// Nur die Felder, die der Dienst kennt (unbekannte beantwortet er mit 400).
const unitBody = (u: UnitFilter) => {
  const c = canonUnit(u);
  return { id: c.id, x: !!c.x, s: c.s ?? null, sx: c.sx ?? null, n: c.n ?? null, nx: c.nx ?? null, c: c.c ?? null, it: c.it ?? [], nit: c.nit ?? [], k: c.k ?? [] };
};
const itemBody = (i: ItemFilter) => { const c = canonItem(i); return { id: c.id, x: !!c.x, n: c.n ?? null }; };
const traitBody = (t: TraitFilter) => { const c = canonTrait(t); return { id: c.id, x: !!c.x, l: c.l ?? null, le: !!c.le }; };

// Anfrage-Koerper fuer den Abfrage-Dienst.
export function toServiceBody(q: ExplorerQuery) {
  return {
    region: q.region,
    ranks: q.ranks,
    patches: q.patches,
    levels: q.levels,
    place: q.place,
    units: q.units.map(unitBody),
    items: q.items.map(itemBody),
    traits: q.traits.map(traitBody),
    groups: q.groups.map(g => ({
      m: g.m,
      units: g.units.map(u => ({ ...unitBody(u), x: false })),
      items: g.items.map(i => ({ ...itemBody(i), x: false })),
      traits: g.traits.map(t => ({ ...traitBody(t), x: false })),
    })),
    bc: canonBoardCounts(q.bc ?? []).map(e => ({ k: e.k, n: e.n ?? null, nx: e.nx ?? null })),
    tags: canonTags(q.tags ?? []),
    tab: q.tab,
    focus: focusApplies(q.tab) ? q.focus : null,
    split: q.tab === 'units' && q.stars.length ? 'star' : q.tab === 'traits' && q.split === 'over' ? 'over' : null,
    combo: q.tab === 'items' && q.focus ? q.combo : 1,
  };
}

// „Beste Traeger von {Item}" (Plan 24.10.2026): eigener Reiter nur der API —
// nie in der Reiterleiste oder der Seiten-Adresse. Der Dienst beantwortet ihn
// nur fuer die Standardansicht aus vorgewaermten Ansichten; die Anfrage hat
// genau die Form von carriersBody in scripts/lib/explorer-carriers.mjs (Test).
export const CARRIERS_TAB = 'carriers';
export const isExplorerId = (s: string) => ID_RE.test(s);
/** Feste API-Adresse; die Route nimmt keine andere Form an. */
export const carriersApiQs = (itemId: string) => new URLSearchParams([['i', itemId], ['tab', CARRIERS_TAB], ['f', itemId]]).toString();
export const carriersServiceBody = (itemId: string) => ({
  ...toServiceBody({ ...EMPTY_QUERY, items: [{ id: itemId }] }), tab: CARRIERS_TAB, focus: itemId,
});

/**
 * Item der Zeile „Beste Traeger": nur in der Standardansicht — genau ein Item
 * ohne „ohne" und Anzahl, sonst keine Brett-Filter, alle Regionen und Raenge,
 * neuester Patch (auch als Nummer gewaehlt: latestPatch aus meta). Sonst null.
 */
export function carriersItemOf(q: ExplorerQuery, latestPatch?: string | null): string | null {
  const latest = q.patches.length === 1 && (q.patches[0] === LATEST_PATCH || (!!latestPatch && q.patches[0] === latestPatch));
  if (!latest || q.region !== 'all' || q.ranks.length || q.levels.length || q.place) return null;
  if (q.units.length || q.traits.length || q.groups.length || (q.bc ?? []).length || (q.tags ?? []).length) return null;
  if (q.items.length !== 1) return null;
  const i = canonItem(q.items[0]);
  return !i.x && !i.n ? i.id : null;
}

// ─── Antwort-Typen ─────────────────────────────────────────────────────────

export interface ExplorerSummary {
  games: number; matches: number; avg: number | null; top4: number | null; top1: number | null;
  half: number | null; hist: number[];
}

export interface ExplorerRow {
  key: string; sub: number | null; sub2: number | null;
  games: number; matches: number; avg: number; top4: number; top1: number; half: number;
  dOut: number | null; dOutHalf: number | null; top4Out?: number;
  dBase: number | null; dBaseHalf: number | null; top4Base?: number;
  /** Nur Units-Reiter ohne Stern-Aufteilung: Anteil der Boards mit 3★.
   *  Mit Aufteilung ist sub die Sternstufe, sub=null die Unit gesamt. */
  star3?: number | null;
}

export interface ExplorerMeta {
  builtAt: string; setNumber: number; days: number; minDay: string; maxDay: string;
  boards: number; matches: number;
  patches: { patch: string; boards: number; d_from: string; d_to: string }[];
  regions: { region: string; boards: number }[];
  ranks: { rank: string; boards: number }[];
}

export interface ExplorerResponse {
  meta: ExplorerMeta;
  // Die aufgeloeste Anfrage (u. a. "neuester Patch" als echte Nummer).
  query: { patches: string[] };
  summary: ExplorerSummary;
  base: ExplorerSummary;
  headDelta: { dOut: number | null; dOutHalf: number | null; dBase: number | null; dBaseHalf: number | null } | null;
  rows: ExplorerRow[] | null;
  refGames: number | null;
  /** Nur Spiele-Reiter: die neuesten Bretter der Auswahl. */
  games?: ExplorerGame[];
}

/** Reiter carriers: Units, die das Item selbst tragen; refGames = Bretter mit dem Item. */
export interface ExplorerCarrier { key: string; games: number; matches: number; avg: number; top4: number; top1: number; half: number }
export interface ExplorerCarriersResponse { meta: ExplorerMeta; rows: ExplorerCarrier[]; refGames: number }

export interface ExplorerGame {
  /** Spielende, Sekunden seit 1970 (UTC). */
  ts: number;
  placement: number; level: number; round: number;
  patch: string | null; region: string; rank: string | null;
  /** Riot-ID und Profil-Link; null, wenn der Name unbekannt ist. */
  player: { name: string; tag: string; href: string } | null;
  units: { id: string; s: number; it: string[] }[];
  traits: { id: string; l: number; n: number }[];
}

// Blass darstellen: zu wenige Partien oder zu breiter Vertrauensbereich
// (Werte aus dem data-skeptic-Verdict im Plan).
export const MIN_MATCHES_SOLID = 100;
export const MAX_HALF_SOLID = 0.25;
// Der Delta-Bereich ist immer mindestens so breit wie der des Ø-Platzes und
// zaehlt mit, wo die Delta-Spalte sichtbar ist.
export const isWeakRow = (r: { matches: number; half: number | null }, deltaHalf?: number | null) =>
  r.matches < MIN_MATCHES_SOLID || r.half == null || r.half > MAX_HALF_SOLID
  || (deltaHalf != null && deltaHalf > MAX_HALF_SOLID);

/** Top 4 / Sieg sind nur aussagekraeftig, wenn die Platzspanne beide Seiten enthaelt. */
export const showTop4 = (place: [number, number] | null) => !place || (place[0] <= 4 && place[1] >= 5);
export const showTop1 = (place: [number, number] | null) => !place || (place[0] === 1 && place[1] >= 2);

// Letzte Runde (1..N) → "Stufe-Runde" wie im Spiel: Stufe 1 hat 4 Runden,
// danach 7 je Stufe.
export function roundLabel(r: number): string {
  if (r <= 4) return `1-${r}`;
  return `${Math.floor((r - 5) / 7) + 2}-${((r - 5) % 7) + 1}`;
}

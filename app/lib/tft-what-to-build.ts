// Logik der Seite „What to build" (Plan 01.11.2026): Satz der Suchleiste
// erkennen, Abfragen je Box, Zeilen aufbereiten, Urteil, teilbare Adresse.
// Reine Funktionen, damit jede Regel einen Test hat; die Oberflaeche liegt in
// app/components/tft/what-to-build/.
//
// Zahlen kommen aus dem Data Explorer. Gezeigt wird „Bretter mit A + B + C",
// nie „als drittes gebaut": Riot liefert keine Bau-Reihenfolge.

import { browseUnits, matchScore, normText, OR_WORDS_BASE, OR_WORDS_LANG, AND_WORDS_BASE, AND_WORDS_LANG } from '../components/tft/explorer/explorer-search';
import type { ExplorerOptions } from '../components/tft/explorer/explorer-options';
import {
  EMPTY_QUERY, LATEST_PATCH, isExplorerId, parseExplorerParams, stageRanks,
  type ExplorerQuery, type ExplorerRank, type ExplorerRow, type TraitFilter,
} from './tft-explorer-query';
import type { ItemBucket } from './tft-item-bucket';

export { TARGET_STAR_MIN_GAMES, targetStarOf } from './tft-what-to-build-star.mjs';

export const MAX_BOXES = 6;
export const MAX_FIXED = 2;

// ─── Boxen und Adresse ─────────────────────────────────────────────────────

export type StarChoice = 'auto' | 'all' | 2 | 3;
export type Combo = 1 | 2 | 3;
/** Reiter einer Box. */
export type BuildKind = Exclude<ItemBucket, 'other'>;

export interface BuildBox {
  unit: string;
  /** Items je Zeile, feste Items mitgezaehlt. */
  combo: Combo;
  /** Feste Items, sortiert: gleiche Auswahl = gleiche Abfrage (Edge-Cache). */
  fixed: string[];
  /** Verglichene Zeilen als restKey (Items der Zeile ohne die festen); hoechstens 2. */
  compare: string[];
  star: StarChoice;
  trait: string | null;
  kind: BuildKind;
}

export interface BuildScope { region: string; ranks: ExplorerRank[]; patches: string[] }

export const emptyBox = (unit: string): BuildBox =>
  ({ unit, combo: 1, fixed: [], compare: [], star: 'auto', trait: null, kind: 'standard' });

/** Standard der Seite: wie die Unit-Seite Master+, alle Regionen, neuester Patch. */
export const DEFAULT_SCOPE: BuildScope = { region: 'all', ranks: stageRanks('master_plus'), patches: [LATEST_PATCH] };

const KINDS: BuildKind[] = ['standard', 'artifact', 'emblem', 'radiant'];

/** Eine Zeile braucht mindestens ein Item mehr, als fest stehen. */
export const minCombo = (fixedCount: number): Combo => (Math.min(3, fixedCount + 1) as Combo);

// Diebeshandschuhe belegen alle drei Plaetze, die Items daneben wuerfelt das Spiel:
// nie fest (auch nicht aus einem alten Link), sonst bliebe die Box leer.
const GLOVES = /ThiefsGloves/i;

export function normalizeBox(b: BuildBox): BuildBox {
  const fixed = b.fixed.filter(id => !GLOVES.test(id)).slice(0, MAX_FIXED).sort();
  const combo = Math.max(b.combo, minCombo(fixed.length)) as Combo;
  const restSize = combo - fixed.length;
  const compare = [...new Set(b.compare)].filter(k => k.split('|').length === restSize).slice(0, 2);
  return { ...b, fixed, combo, compare };
}

function boxToken(raw: BuildBox): string {
  const b = normalizeBox(raw);
  let s = b.unit;
  if (b.combo !== 1) s += `:c${b.combo}`;
  if (b.star === 'all') s += ':sa';
  else if (b.star !== 'auto') s += `:s${b.star}`;
  if (b.trait) s += `:t${b.trait}`;
  for (const it of b.fixed) s += `:i${it}`;
  for (const k of b.compare) s += `:v${k}`;
  if (b.kind !== 'standard') s += `:k${b.kind}`;
  return s;
}

function parseBoxToken(tok: string): BuildBox | null {
  const [unit, ...mods] = tok.split(':');
  if (!isExplorerId(unit)) return null;
  const b = emptyBox(unit);
  for (const m of mods) {
    const head = m[0];
    const rest = m.slice(1);
    if (head === 'c' && (rest === '2' || rest === '3')) b.combo = Number(rest) as Combo;
    else if (head === 's') {
      if (rest === 'a') b.star = 'all';
      else if (rest === '2' || rest === '3') b.star = Number(rest) as 2 | 3;
    } else if (head === 't' && isExplorerId(rest)) b.trait = rest;
    else if (head === 'i' && isExplorerId(rest)) b.fixed.push(rest);
    else if (head === 'v' && rest.split('|').every(isExplorerId)) b.compare.push(rest);
    else if (head === 'k' && (KINDS as string[]).includes(rest)) b.kind = rest as BuildKind;
  }
  return normalizeBox(b);
}

type Params = { get(name: string): string | null };

/** Boxen und Filter aus der Adresse; doppelte oder ungueltige Boxen fallen still weg. */
export function parseBuildParams(sp: Params): { boxes: BuildBox[]; scope: BuildScope } {
  const boxes: BuildBox[] = [];
  for (let n = 1; n <= MAX_BOXES; n++) {
    const raw = sp.get(`b${n}`);
    const b = raw ? parseBoxToken(raw) : null;
    if (b && !boxes.some(x => x.unit === b.unit)) boxes.push(b);
  }
  const q = parseExplorerParams(sp);
  const k = sp.get('k');
  return {
    boxes,
    scope: {
      region: q.region,
      ranks: k == null ? DEFAULT_SCOPE.ranks : k === 'all' ? [] : q.ranks,
      // Nur ein Patch: „alle Patches" mit Filter dauert 18–24 s und wird nicht angeboten.
      patches: q.patches.length === 1 ? q.patches : [LATEST_PATCH],
    },
  };
}

const sameRanks = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x));

export function serializeBuildParams(boxes: BuildBox[], scope: BuildScope): string {
  const sp = new URLSearchParams();
  if (scope.region !== 'all') sp.set('r', scope.region);
  if (!sameRanks(scope.ranks, DEFAULT_SCOPE.ranks)) {
    sp.set('k', scope.ranks.length ? [...scope.ranks].sort().map(r => r.toLowerCase()).join(',') : 'all');
  }
  if (scope.patches[0] && scope.patches[0] !== LATEST_PATCH) sp.set('p', scope.patches[0]);
  boxes.slice(0, MAX_BOXES).forEach((b, i) => sp.set(`b${i + 1}`, boxToken(b)));
  return sp.toString();
}

// ─── Abfragen ──────────────────────────────────────────────────────────────

/** Sterne der Unit: dieselbe Abfrage wie die Unit-Seite, vorgewaermt. */
export function starsQuery(unit: string, scope: BuildScope): ExplorerQuery {
  return { ...EMPTY_QUERY, ...scope, units: [{ id: unit }], tab: 'units', stars: [1, 2, 3] };
}

/** Stufe 2 der Synergie, wo es sie gibt: Stufe 1 trifft auch Bretter, die sie nur nebenbei haben. */
export function traitFilterFor(id: string, mins: readonly number[]): TraitFilter {
  return mins.length >= 2 ? { id, l: 2 } : { id };
}

export function effectiveStar(b: BuildBox, target: number | null): number | null {
  if (b.star === 'auto') return target;
  return b.star === 'all' ? null : b.star;
}

const unitFilter = (unit: string, star: number | null, it: string[], nit: string[] = []) => ({
  id: unit,
  ...(star ? { s: star, sx: star } : {}),
  n: 3, nx: 3,
  ...(it.length ? { it } : {}),
  ...(nit.length ? { nit } : {}),
});

/** Item-Zeilen einer Box: nur Bretter mit genau 3 Items an der Unit. */
export function itemsQuery(raw: BuildBox, scope: BuildScope, star: number | null, trait: TraitFilter | null): ExplorerQuery {
  const b = normalizeBox(raw);
  return {
    ...EMPTY_QUERY, ...scope,
    units: [unitFilter(b.unit, star, b.fixed)],
    traits: trait ? [trait] : [],
    tab: 'items', focus: b.unit, combo: b.combo,
  };
}

/**
 * Stimmen die Zeilen zweier Kandidaten von getrennten Brettern? Bei Trios ja, ein
 * Brett hat genau ein Trio. Bei Einzel-Zeilen nein: IE und Deathblade stehen oft an
 * derselben Kopie, deshalb rechnet das Urteil dort mit eigenen Abfragen (splitQueries).
 */
export const rowsAreDisjoint = (b: BuildBox) => b.combo === 3;

/** Getrennte Seiten eines Vergleichs einzelner Items: A ohne B gegen B ohne A. */
export function splitQueries(raw: BuildBox, scope: BuildScope, star: number | null, trait: TraitFilter | null, a: string, c: string): [ExplorerQuery, ExplorerQuery] {
  const b = normalizeBox(raw);
  const side = (mine: string, other: string): ExplorerQuery => ({
    ...EMPTY_QUERY, ...scope,
    // Das andere Item nur ausschliessen, wenn es nicht selbst fest steht.
    units: [unitFilter(b.unit, star, [...b.fixed, mine].sort(), b.fixed.includes(other) ? [] : [other])],
    traits: trait ? [trait] : [],
    tab: 'level',
  });
  return [side(a, c), side(c, a)];
}

// ─── Zeilen ────────────────────────────────────────────────────────────────

export interface BoxRow {
  /** Items der Zeile ohne die festen, sortiert und mit | verbunden. */
  restKey: string;
  rest: string[];
  /** Item doppelt an der Kopie (feste mitgezaehlt) — „2×". */
  doubled: string[];
  games: number; matches: number; avg: number | null; half: number | null; top4: number | null; top1: number | null;
  kind: BuildKind;
  /** Unter der Mindestmenge der Box: bleibt waehlbar, zaehlt aber nicht als Aussage. */
  thin: boolean;
  /** Keine Zeile vom Dienst (unter 5 Spielen oder ausserhalb der 500 Zeilen). */
  noData: boolean;
}

/** Items der Zeile ohne die festen; null = die Zeile enthaelt ein festes Item nicht. */
export function restOf(key: string, fixed: readonly string[]): string[] | null {
  const parts = key.split('|');
  for (const f of fixed) {
    const i = parts.indexOf(f);
    if (i < 0) return null;
    parts.splice(i, 1);
  }
  return parts;
}

// Kein wählbares Item der Liste: Taktiker-Items wirken aufs ganze Brett, Augment-
// und Phantom-Items waeren eine Augment-Statistik (feedback_no_augment_stats).
const NEVER_LISTED = /Tactician|Augment|Phantom/i;

/** Hoechstzahl Zeilen je Antwort (ROW_LIMIT im Dienst, Test haelt beide gleich). */
export const EXPLORER_ROW_CAP = 500;
/** Darunter ist die Spanne um den Schnitt keine brauchbare Angabe. */
export const MIN_GAMES_FOR_RANGE = 30;

export interface ItemListRules {
  /** „Unique - only 1 per champion": nie zweimal an einer Unit. */
  unique: ReadonlySet<string>;
  /** „Single Use": Traenke, die Grundform steht ebenfalls in keiner Liste. */
  hidden: ReadonlySet<string>;
}

/** Regeln aus den Item-Texten; null, solange sie fehlen. */
export function itemListRules(texts: { items: Record<string, { unique?: boolean; i18n: { en?: { desc?: string } } }> } | null): ItemListRules | null {
  if (!texts) return null;
  const entries = Object.entries(texts.items);
  return {
    unique: new Set(entries.filter(([, e]) => e.unique).map(([id]) => id)),
    hidden: new Set(entries.filter(([, e]) => /Single Use/i.test(e.i18n.en?.desc ?? '')).map(([id]) => id)),
  };
}

const kindOfRest = (rest: string[], kindOf: (id: string) => ItemBucket): BuildKind | null => {
  const kinds = rest.map(kindOf);
  if (kinds.includes('other')) return null;
  return KINDS.slice(1).find(k => kinds.includes(k)) ?? 'standard';
};

/** Mindestspiele einer Zeile: 30, in grossen Boxen 1 % der Bretter. */
export const minRowGames = (boxGames: number) => Math.max(30, Math.ceil(boxGames * 0.01));

export function boxRows(
  rows: readonly ExplorerRow[] | null | undefined,
  raw: BuildBox,
  opts: {
    boxGames: number;
    kindOf: (id: string) => ItemBucket;
    known: (id: string) => boolean;
    fits: (id: string, carried: readonly string[]) => boolean;
    /** Alle waehlbaren Items: ist genau ein Platz frei, steht jedes davon in der Liste. */
    allItems?: readonly { id: string; name: string }[];
    rules?: ItemListRules | null;
  },
): BoxRow[] {
  const b = normalizeBox(raw);
  const restSize = b.combo - b.fixed.length;
  const min = minRowGames(opts.boxGames);
  const gloves = b.fixed.length > 0 || b.combo > 1;
  const hidden = (id: string) => NEVER_LISTED.test(id) || !opts.known(id) || !!opts.rules?.hidden.has(id);
  const fits = (id: string, carried: readonly string[]) =>
    opts.fits(id, carried) && !(opts.rules?.unique.has(id) && carried.includes(id));
  const out: BoxRow[] = [];
  for (const r of rows ?? []) {
    const rest = restOf(r.key, b.fixed);
    if (!rest || rest.length !== restSize) continue;
    const ids = [...b.fixed, ...rest];
    if (ids.some(hidden)) continue;
    if (gloves && ids.some(id => GLOVES.test(id))) continue;
    if (!rest.every((id, i) => fits(id, [...b.fixed, ...rest.slice(0, i)]))) continue;
    const kind = kindOfRest(rest, opts.kindOf);
    if (!kind) continue;
    out.push({
      restKey: [...rest].sort().join('|'), rest,
      doubled: [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))],
      games: r.games, matches: r.matches, avg: r.avg, half: r.half, top4: r.top4, top1: r.top1, kind,
      thin: r.games < min, noData: false,
    });
  }

  // Ein Platz frei: auch Items ohne Zeile sind waehlbar, sonst koennte man sie nie
  // festsetzen. Bei zwei freien Plaetzen waeren es 666 Paare, fast alle ohne Daten.
  if (restSize === 1 && opts.allItems) {
    const seen = new Set(out.map(r => r.restKey));
    for (const { id } of opts.allItems) {
      if (seen.has(id) || hidden(id) || (gloves && GLOVES.test(id))) continue;
      const again = b.fixed.includes(id);
      // Ohne Texte ist „unique" unbekannt: keine erfundene Doppelzeile.
      if ((again && !opts.rules) || !fits(id, b.fixed)) continue;
      const kind = kindOfRest([id], opts.kindOf);
      if (!kind) continue;
      out.push({
        restKey: id, rest: [id], doubled: again ? [id] : [],
        games: 0, matches: 0, avg: null, half: null, top4: null, top1: null, kind,
        thin: true, noData: true,
      });
    }
  }

  // Erst was aussagekraeftig ist, nach Schnitt. Seltene nach Spielen, damit kein Item
  // mit 5 Spielen und Glueckswert oben steht. Ohne Daten nach Name.
  const names = new Map((opts.allItems ?? []).map(i => [i.id, i.name]));
  const rank = (r: BoxRow) => (r.noData ? 2 : r.thin ? 1 : 0);
  return out.sort((x, y) => rank(x) - rank(y)
    || (rank(x) === 0 ? (x.avg ?? 0) - (y.avg ?? 0) : 0)
    || y.games - x.games
    || (names.get(x.restKey) ?? x.restKey).localeCompare(names.get(y.restKey) ?? y.restKey));
}

/** Kann die Zeile (noch) festgesetzt werden? Nur wenn danach etwas zu vergleichen bleibt. */
export const canFix = (fixedCount: number, rest: readonly string[]) =>
  fixedCount + rest.length <= MAX_FIXED && !rest.some(id => GLOVES.test(id));

// ─── Urteil ────────────────────────────────────────────────────────────────

export const VERDICT_MIN_GAMES = 100;
// Gleiche Grenze wie die Item-Farben der Unit-Liste (ITEM_COLOR_DELTA, UnitsClient).
export const VERDICT_MIN_DIFF = 0.15;

export type Verdict =
  | { state: 'few' }
  | { state: 'tie' }
  | { state: 'better'; winner: 0 | 1; diff: number };

export interface VerdictSide { games: number; avg: number; half: number }

/**
 * Urteil fuer genau ein Paar. Gerechnet am angezeigten Wert (2 Stellen), sonst steht
 * auf der Seite 3,67 gegen 3,82 und daneben „kein Unterschied", weil es roh 0,149 sind.
 */
export function verdictOf(a: VerdictSide, b: VerdictSide): Verdict {
  if (a.games < VERDICT_MIN_GAMES || b.games < VERDICT_MIN_GAMES) return { state: 'few' };
  const hundredths = Math.round(a.avg * 100) - Math.round(b.avg * 100);
  const diff = Math.abs(hundredths) / 100;
  if (Math.abs(hundredths) < Math.round(VERDICT_MIN_DIFF * 100)) return { state: 'tie' };
  if (diff <= Math.sqrt(a.half * a.half + b.half * b.half)) return { state: 'tie' };
  return { state: 'better', winner: hundredths < 0 ? 0 : 1, diff };
}

// ─── Suchleiste ────────────────────────────────────────────────────────────

// Kurzformen zeigen auf englische Item-Namen, nicht auf Kennungen: die wechseln mit
// dem Set. Mehrere Namen = mehrdeutig, die Seite fragt nach statt zu raten.
// Bewusst nicht „as" (englisches Wort im Satz) und nichts Einbuchstabiges.
const ITEM_ALIASES: Record<string, string[]> = {
  ie: ['Infinity Edge'], db: ['Deathblade'], jg: ['Jeweled Gauntlet'],
  gs: ['Giant Slayer', 'Gargoyle Stoneplate'], bt: ['Bloodthirster'], lw: ['Last Whisper'],
  hoj: ['Hand of Justice'], eon: ['Edge of Night'], qss: ['Quicksilver'], qs: ['Quicksilver'],
  gunblade: ['Hextech Gunblade'], gb: ['Hextech Gunblade'], hgb: ['Hextech Gunblade'],
  rageblade: ["Guinsoo's Rageblade"], guinsoo: ["Guinsoo's Rageblade"], guinsoos: ["Guinsoo's Rageblade"], guinso: ["Guinsoo's Rageblade"], guinsos: ["Guinsoo's Rageblade"],
  rb: ["Guinsoo's Rageblade", 'Red Buff'], kraken: ["Kraken's Fury"], krakens: ["Kraken's Fury"], runaan: ["Kraken's Fury"], runaans: ["Kraken's Fury"],
  rabadon: ["Rabadon's Deathcap"], rabadons: ["Rabadon's Deathcap"], rab: ["Rabadon's Deathcap"], deathcap: ["Rabadon's Deathcap"], cap: ["Rabadon's Deathcap"],
  archangel: ["Archangel's Staff"], archangels: ["Archangel's Staff"], aa: ["Archangel's Staff"],
  shojin: ['Spear of Shojin'], sos: ['Spear of Shojin'], nashor: ["Nashor's Tooth"], nashors: ["Nashor's Tooth"], nash: ["Nashor's Tooth"],
  morello: ['Morellonomicon'], blue: ['Blue Buff'], bb: ['Blue Buff'], red: ['Red Buff'],
  ionic: ['Ionic Spark'], sunfire: ['Sunfire Cape'], warmog: ["Warmog's Armor"], warmogs: ["Warmog's Armor"],
  titans: ["Titan's Resolve"], titan: ["Titan's Resolve"], tr: ["Titan's Resolve"],
  gargoyle: ['Gargoyle Stoneplate'], garg: ['Gargoyle Stoneplate'], bramble: ['Bramble Vest'],
  dclaw: ["Dragon's Claw"], claw: ["Dragon's Claw"], steadfast: ['Steadfast Heart'], sfh: ['Steadfast Heart'],
  crownguard: ['Crownguard'], cg: ['Crownguard'], steraks: ["Sterak's Gage"], sterak: ["Sterak's Gage"], flail: ["Striker's Flail"],
  visage: ['Spirit Visage'], redemption: ['Spirit Visage'], vow: ["Protector's Vow"], shroud: ['Evenshroud'],
  adaptive: ['Adaptive Helm'], thief: ["Thief's Gloves"], tg: ["Thief's Gloves"],
};

export interface NameSources {
  /** Item-Namen je Sprache, ohne Englisch (kommt aus dem Bundle). */
  itemNames?: (id: string) => Partial<Record<string, string>> | undefined;
  unitNames?: (id: string) => Partial<Record<string, string>> | undefined;
}

export interface QuestionDict {
  unitsByName: Map<string, string[]>;
  itemsByName: Map<string, string[]>;
  /** Namen fuer die Vorsilben-Suche: je Eintrag Name und Kennung. */
  prefix: { unit: boolean; id: string; name: string; lang: string }[];
  /** Namen ohne Leerzeichen-Trennung im Satz (zh, ko), laengste zuerst. */
  cjk: string[];
}

const CJK = /[぀-ヿ㐀-鿿가-힯]/;

const addName = (m: Map<string, string[]>, name: string, id: string) => {
  const k = normText(name);
  if (!k) return;
  const cur = m.get(k);
  if (!cur) m.set(k, [id]);
  else if (!cur.includes(id)) cur.push(id);
};

export function buildQuestionDict(o: ExplorerOptions, src: NameSources = {}): QuestionDict {
  const unitsByName = new Map<string, string[]>();
  const itemsByName = new Map<string, string[]>();
  const prefix: QuestionDict['prefix'] = [];
  const cjk = new Set<string>();
  const add = (unit: boolean, id: string, name: string | undefined, lang: string) => {
    if (!name) return;
    addName(unit ? unitsByName : itemsByName, name, id);
    prefix.push({ unit, id, name, lang });
    if (CJK.test(name)) cjk.add(name);
  };
  for (const u of browseUnits(o.units).flat()) {
    add(true, u.id, u.name, 'en');
    for (const [lang, n] of Object.entries(src.unitNames?.(u.id) ?? {})) add(true, u.id, n, lang);
  }
  for (const it of o.items) {
    if (NEVER_LISTED.test(it.id)) continue;
    add(false, it.id, it.name, 'en');
    for (const [lang, n] of Object.entries(src.itemNames?.(it.id) ?? {})) add(false, it.id, n, lang);
  }
  const idOf = new Map(o.items.map(i => [normText(i.name), i.id]));
  for (const [alias, names] of Object.entries(ITEM_ALIASES)) {
    const ids = names.map(n => idOf.get(normText(n))).filter((x): x is string => !!x);
    for (const id of ids) addName(itemsByName, alias, id);
  }
  return { unitsByName, itemsByName, prefix, cjk: [...cjk].sort((a, b) => b.length - a.length) };
}

export interface ParsedQuestion {
  units: string[];
  fixed: string[];
  compare: string[];
  /** Begriffe mit mehreren passenden Items; die Seite zeigt die Wahl. */
  ambiguous: { term: string; ids: string[] }[];
}

const TOKEN_SPLIT = /[\s;:!?()[\]/"„“”«»¿¡；：？！（）。]+/;
const OR_EXTRA = ['vs', 'versus', 'gegen'];
const MAX_NAME_WORDS = 5;

function tokenize(text: string, dict: QuestionDict, lang: string): string[] {
  // Namen ohne Leerzeichen im Satz freistellen, bevor 和/或 trennen: ein solches
  // Zeichen darf auch in einem Namen stehen.
  let s = text;
  for (const n of dict.cjk) s = s.split(n).join(` ${n} `);
  const known = new Set(dict.cjk);
  return s.split(TOKEN_SPLIT).filter(Boolean).flatMap(t => {
    if (known.has(t)) return [t];
    const withOps = lang === 'zh' ? t.replace(/和|且|或/g, ' $& ') : t;
    // Komma als eigenes Zeichen: „Kraken, Kraken" sind zwei Exemplare, „Guinsos Rageblade" eins.
    return withOps.replace(/[，、]/g, ',').replace(/[&|+,]/g, ' $& ').split(/\s+/).filter(Boolean);
  });
}

// Anfang eines Namens: mindestens 4 Zeichen (CJK 2), nur Sprache der Seite und
// Englisch — sonst trifft ein Alltagswort einen Namen einer fremden Sprache. Nur die
// beste Trefferstufe zaehlt: „Rabad" meint Rabadon's Deathcap, nicht „Radiant Rabadon's …".
function prefixHits(token: string, dict: QuestionDict, lang: string): { units: string[]; items: string[] } {
  if (token.length < (CJK.test(token) ? 2 : 4)) return { units: [], items: [] };
  const best = { units: 2, items: 2 };
  const units = new Set<string>();
  const items = new Set<string>();
  for (const p of dict.prefix) {
    if (p.lang !== 'en' && p.lang !== lang) continue;
    const score = matchScore(p.name, token);
    const kind = p.unit ? 'units' : 'items';
    const set = p.unit ? units : items;
    if (score < best[kind]) continue;
    if (score > best[kind]) { best[kind] = score; set.clear(); }
    set.add(p.id);
  }
  return { units: [...units], items: [...items] };
}

/**
 * Erkennt Unit, feste Items und Vergleich in einem Satz. Unbekannte Woerter fallen
 * weg. „oder/vs" verbindet Items zu einem Vergleich, alles andere steht fest an
 * derselben Kopie. Beispiel: „Draven: Guinsoo und Kraken, IE oder Deathblade?".
 * choices: bereits entschiedene mehrdeutige Begriffe (Begriff → Item).
 */
export function parseBuildQuestion(text: string, dict: QuestionDict, lang = 'de', choices: Record<string, string> = {}): ParsedQuestion {
  const or = new Set([...OR_WORDS_BASE, ...OR_EXTRA, ...(OR_WORDS_LANG[lang] ?? [])].map(normOp));
  const and = new Set([...AND_WORDS_BASE, ',', ...(AND_WORDS_LANG[lang] ?? [])].map(normOp));
  const tokens = tokenize(text, dict, lang);
  const norm = tokens.map(normOp);
  const isOp = (i: number) => or.has(norm[i]) || and.has(norm[i]);

  const units: string[] = [];
  const picks: { id: string; chain: boolean }[] = [];
  const ambiguous: ParsedQuestion['ambiguous'] = [];
  let pendingOr = false;
  // Ende des letzten Item-Namens: zwei erkannte Woerter direkt hintereinander
  // („Guinsos Rageblade") sind ein Exemplar, nicht zwei.
  let lastEnd = -1;
  let start = 0;
  let hit = false;

  const addItem = (id: string) => {
    hit = true;
    if (start === lastEnd && picks[picks.length - 1]?.id === id) return;
    if (pendingOr && picks.length) picks[picks.length - 1].chain = true;
    picks.push({ id, chain: pendingOr });
    pendingOr = false;
  };
  const resolve = (term: string, ids: string[]) => {
    if (ids.length === 1) { addItem(ids[0]); return; }
    const chosen = choices[term];
    if (chosen && ids.includes(chosen)) { addItem(chosen); return; }
    ambiguous.push({ term, ids });
    pendingOr = false;
  };

  for (let i = 0; i < tokens.length; i++) {
    if (isOp(i)) {
      // Das Wort direkt vor dem naechsten Item entscheidet.
      pendingOr = or.has(norm[i]);
      continue;
    }
    start = i;
    hit = false;
    let matched = false;
    // Laengster Name zuerst: „Infinity Edge" schlaegt „Edge".
    for (let n = Math.min(MAX_NAME_WORDS, tokens.length - i); n >= 1 && !matched; n--) {
      let spansOp = false;
      for (let j = i; j < i + n; j++) if (isOp(j)) spansOp = true;
      if (spansOp) continue;
      const phrase = norm.slice(i, i + n).join(' ');
      const uids = dict.unitsByName.get(phrase);
      const iids = dict.itemsByName.get(phrase);
      if (uids?.length) { if (!units.includes(uids[0])) units.push(uids[0]); matched = true; }
      else if (iids?.length) { resolve(phrase, iids); matched = true; }
      if (matched) i += n - 1;
    }
    if (!matched) {
      const hits = prefixHits(norm[i], dict, lang);
      if (hits.items.length) resolve(norm[i], hits.items);
      else if (hits.units.length === 1 && !units.includes(hits.units[0])) units.push(hits.units[0]);
    }
    if (hit) lastEnd = i + 1;
  }

  const compareIds = [...new Set(picks.filter(p => p.chain).map(p => p.id))].slice(0, 2);
  let fixed = picks.filter(p => !p.chain).map(p => p.id);
  let compare = compareIds;
  // Drei Items ohne „oder": das dritte ist die Zeile, die man sehen will.
  if (!compare.length && fixed.length > MAX_FIXED) compare = fixed.slice(MAX_FIXED, MAX_FIXED + 1);
  fixed = fixed.slice(0, MAX_FIXED);
  return { units, fixed, compare, ambiguous };
}

function normOp(s: string): string { return normText(s); }

/** Items aus der Suchleiste in eine Box uebernehmen. */
export function boxFromQuestion(unit: string, q: Pick<ParsedQuestion, 'fixed' | 'compare'>, kindOf: (id: string) => ItemBucket): BuildBox {
  const first = kindOf(q.compare[0] ?? '');
  const kind: BuildKind = q.compare.length && first !== 'other' ? first : 'standard';
  return normalizeBox({ ...emptyBox(unit), fixed: q.fixed, compare: q.compare, combo: minCombo(q.fixed.length), kind });
}

/** Satz in die Boxen einsetzen: gleiche Unit wird ersetzt, sonst neue Box. */
export function applyQuestion(boxes: BuildBox[], q: ParsedQuestion, kindOf: (id: string) => ItemBucket): BuildBox[] {
  let next = [...boxes];
  q.units.forEach((unit, i) => {
    const box = i === 0 ? boxFromQuestion(unit, q, kindOf) : emptyBox(unit);
    const at = next.findIndex(b => b.unit === unit);
    if (at >= 0) next[at] = i === 0 ? box : next[at];
    else if (next.length < MAX_BOXES) next = [...next, box];
    else if (i === 0) next[next.length - 1] = box;
  });
  return next;
}

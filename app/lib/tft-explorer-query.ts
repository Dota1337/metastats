// Kurze URL-Form des Data Explorers und ihre Uebersetzung in die Anfrage an
// den Abfrage-Dienst (scripts/explorer-duckdb-server.mjs).
//
// Die Seite und die API-Route benutzen dieselbe Form, damit die URL der Seite
// 1:1 als Cache-Schluessel der API taugt:
//   r=euw1                      Region (fehlt = alle)
//   k=challenger,unknown        Raenge (fehlt = alle)
//   p=18.3,18.2                 Patches (fehlt = neuester Patch, p=all = alle im Speicher)
//   u=!ID:s2e:n2:iITEM:xITEM    Units; ! = ohne, s2 = mind. 2 Sterne (e = genau),
//                               n2 = mind. 2 Items, iX = mit Item X, xX = ohne Item X
//   i=ITEM,!ITEM                Items irgendwo auf dem Board
//   t=ID:l2e,!ID                Traits; l2 = mind. Stufe 2 (e = genau)
//   tab, f (Traeger im Item-Reiter), split (star|over), c (1-3 Items je Kombi)
//
// Alte Links (?units=&items=&traits=&bucket=&region=) von den Unit-, Item-
// und Trait-Seiten werden beim Lesen uebernommen (legacyToQuery).

export const EXPLORER_RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'unknown'] as const;
export type ExplorerRank = (typeof EXPLORER_RANKS)[number];

export const EXPLORER_TABS = ['units', 'items', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank'] as const;
export type ExplorerTab = (typeof EXPLORER_TABS)[number];

export interface UnitFilter { id: string; x?: boolean; s?: number; se?: boolean; n?: number; it?: string[]; nit?: string[] }
export interface ItemFilter { id: string; x?: boolean }
export interface TraitFilter { id: string; x?: boolean; l?: number; le?: boolean }

export interface ExplorerQuery {
  region: string;
  ranks: ExplorerRank[];
  patches: string[];
  units: UnitFilter[];
  items: ItemFilter[];
  traits: TraitFilter[];
  tab: ExplorerTab;
  focus: string | null;
  split: 'star' | 'over' | null;
  combo: 1 | 2 | 3;
}

const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REGION_RE = /^[a-z0-9]{2,5}$/;
const PATCH_RE = /^\d{1,2}\.\d{1,2}[a-z]?$/;

// Platzhalter fuer "neuester Patch im Speicher"; der Abfrage-Dienst loest ihn auf.
export const LATEST_PATCH = 'latest';

export const EMPTY_QUERY: ExplorerQuery = {
  region: 'all', ranks: [], patches: [LATEST_PATCH], units: [], items: [], traits: [],
  tab: 'units', focus: null, split: null, combo: 1,
};

type Params = { get(name: string): string | null };

const list = (v: string | null) => (v ? v.split(',').map(s => s.trim()).filter(Boolean) : []);

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
      const exact = rest.endsWith('e');
      const n = Number(exact ? rest.slice(0, -1) : rest);
      if (Number.isInteger(n) && n >= 1 && n <= 4) { u.s = n; if (exact) u.se = true; }
    } else if (head === 'n') {
      const n = Number(rest);
      if (Number.isInteger(n) && n >= 0 && n <= 3) u.n = n;
    } else if (head === 'i' && ID_RE.test(rest)) {
      u.it = [...(u.it ?? []), rest].slice(0, 3);
    } else if (head === 'x' && ID_RE.test(rest)) {
      u.nit = [...(u.nit ?? []), rest].slice(0, 3);
    }
  }
  return u;
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

const uniqBy = <T extends { id: string }>(arr: (T | null)[]) => {
  const seen = new Set<string>();
  return arr.filter((a): a is T => !!a && !seen.has(a.id) && (seen.add(a.id), true));
};

// Alte Rang-Stufen (TierFilter) auf die Raenge im Speicher abbilden. Unter
// Diamant gibt es im Speicher nichts, daher "diamond_plus oder tiefer" = alle vier.
function legacyBucketToRanks(bucket: string | null): ExplorerRank[] {
  switch (bucket) {
    case 'challenger': return ['CHALLENGER'];
    case 'grandmaster_plus': return ['CHALLENGER', 'GRANDMASTER'];
    case 'master_plus': return ['CHALLENGER', 'GRANDMASTER', 'MASTER'];
    case 'diamond_plus': case 'emerald_plus': case 'platinum_plus':
      return ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'];
    default: return [];
  }
}

export function parseExplorerParams(sp: Params): ExplorerQuery {
  const q: ExplorerQuery = { ...EMPTY_QUERY };
  const r = sp.get('r') ?? sp.get('region');
  if (r && REGION_RE.test(r.toLowerCase())) q.region = r.toLowerCase();

  const k = list(sp.get('k')).map(x => (x === 'unknown' ? x : x.toUpperCase()));
  q.ranks = k.length
    ? [...new Set(k.filter((x): x is ExplorerRank => (EXPLORER_RANKS as readonly string[]).includes(x)))].sort()
    : legacyBucketToRanks(sp.get('bucket'));

  const p = sp.get('p');
  if (p === 'all') q.patches = [];
  else {
    const ps = [...new Set(list(p).filter(x => PATCH_RE.test(x)))].sort().slice(0, 12);
    q.patches = ps.length ? ps : [LATEST_PATCH];
  }

  q.units = uniqBy([...list(sp.get('u')), ...list(sp.get('units'))].map(parseUnit)).slice(0, 9);
  q.items = uniqBy([...list(sp.get('i')), ...list(sp.get('items'))].map(tok => {
    const x = tok.startsWith('!');
    const id = x ? tok.slice(1) : tok;
    return ID_RE.test(id) ? (x ? { id, x: true } : { id }) : null;
  })).slice(0, 6);
  q.traits = uniqBy([...list(sp.get('t')), ...list(sp.get('traits'))].map(parseTrait)).slice(0, 6);

  const tab = sp.get('tab');
  if (tab && (EXPLORER_TABS as readonly string[]).includes(tab)) q.tab = tab as ExplorerTab;
  const f = sp.get('f');
  if (f && ID_RE.test(f)) q.focus = f;
  const split = sp.get('split');
  if (split === 'star' || split === 'over') q.split = split;
  const c = Number(sp.get('c'));
  if (c === 2 || c === 3) q.combo = c;
  return q;
}

function unitToken(u: UnitFilter): string {
  let s = `${u.x ? '!' : ''}${u.id}`;
  if (u.s) s += `:s${u.s}${u.se ? 'e' : ''}`;
  if (u.n) s += `:n${u.n}`;
  for (const it of u.it ?? []) s += `:i${it}`;
  for (const it of u.nit ?? []) s += `:x${it}`;
  return s;
}

function traitToken(t: TraitFilter): string {
  return `${t.x ? '!' : ''}${t.id}${t.l ? `:l${t.l}${t.le ? 'e' : ''}` : ''}`;
}

// Feste Reihenfolge und Sortierung → gleiche Auswahl, gleiche URL, gleicher
// Cache-Eintrag bei Vercel.
export function serializeExplorerQuery(q: ExplorerQuery, { forApi = false } = {}): string {
  const sp = new URLSearchParams();
  if (q.region !== 'all') sp.set('r', q.region);
  if (q.ranks.length) sp.set('k', [...q.ranks].sort().map(r => r.toLowerCase()).join(','));
  if (q.patches.length === 0) sp.set('p', 'all');
  else if (q.patches[0] !== LATEST_PATCH) sp.set('p', [...q.patches].sort().join(','));
  if (q.units.length) sp.set('u', q.units.map(unitToken).sort().join(','));
  if (q.items.length) sp.set('i', q.items.map(i => `${i.x ? '!' : ''}${i.id}`).sort().join(','));
  if (q.traits.length) sp.set('t', q.traits.map(traitToken).sort().join(','));
  if (forApi || q.tab !== 'units') sp.set('tab', q.tab);
  // Traeger und Kombi-Groesse wirken nur im Item-Reiter, Aufteilung nur bei
  // Units/Traits — sonst weglassen, damit sie den Cache nicht zersplittern.
  if (q.tab === 'items' && q.focus) {
    sp.set('f', q.focus);
    if (q.combo !== 1) sp.set('c', String(q.combo));
  }
  if (q.split === 'star' && q.tab === 'units') sp.set('split', 'star');
  if (q.split === 'over' && q.tab === 'traits') sp.set('split', 'over');
  return sp.toString();
}

// Anfrage-Koerper fuer den Abfrage-Dienst.
export function toServiceBody(q: ExplorerQuery) {
  return {
    region: q.region,
    ranks: q.ranks,
    patches: q.patches,
    units: q.units,
    items: q.items,
    traits: q.traits,
    tab: q.tab,
    focus: q.tab === 'items' ? q.focus : null,
    split: (q.tab === 'units' && q.split === 'star') || (q.tab === 'traits' && q.split === 'over') ? q.split : null,
    combo: q.tab === 'items' && q.focus ? q.combo : 1,
  };
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
}

// Blass darstellen: zu wenige Partien oder zu breiter Vertrauensbereich
// (Werte aus dem data-skeptic-Verdict im Plan).
export const MIN_MATCHES_SOLID = 100;
export const MAX_HALF_SOLID = 0.25;
export const isWeakRow = (r: { matches: number; half: number | null }) =>
  r.matches < MIN_MATCHES_SOLID || r.half == null || r.half > MAX_HALF_SOLID;

// Letzte Runde (1..N) → "Stufe-Runde" wie im Spiel: Stufe 1 hat 4 Runden,
// danach 7 je Stufe.
export function roundLabel(r: number): string {
  if (r <= 4) return `1-${r}`;
  return `${Math.floor((r - 5) / 7) + 2}-${((r - 5) % 7) + 1}`;
}

// Eingaben des Explorer-Dienstes pruefen und in eine kanonische Form bringen:
// gleiche Anfrage → gleiches Objekt → gleicher Cache-Schluessel. Aus dem Dienst
// (scripts/explorer-duckdb-server.mjs) hierher gezogen, damit Dienst, Tests und
// der Abgleich scripts/oneoff/explorer-query-equality.mjs dieselbe Form nutzen
// (der Dienst lauscht beim Import, er ist dafuer nicht importierbar).
//
// Filter-Bedeutung (MetaTFT-Explorer als Vorbild, gemessen 17.10.2026):
//   Unit: Bedingungen an Stern, Itemzahl, Items und Itemsorte gelten fuer
//     DIESELBE Kopie (eine Kopie erfuellt alle); c = mindestens so viele Kopien
//     der Unit auf dem Brett, unabhaengig davon.
//     s..sx Sternspanne, n..nx Itemzahl-Spanne, it = Items an der Kopie (dasselbe
//     Item darf mehrfach stehen = mehrfach an der Kopie), nit = nicht an der
//     Kopie, k = [{ b: Sorte, n }] mindestens n Items der Sorte an der Kopie.
//   Item: irgendwo auf dem Brett; n = mindestens so oft auf dem Brett.
//   levels / place: Spieler-Level und Endplatz gehoeren zur Grundmenge (wie der
//     Rang): sie sind Ergebnis-Groessen, keine Brett-Bedingung.
//   groups: Kaesten „eins davon" (m = any, ODER) / „keins davon" (m = none),
//     eine Ebene, Glieder ohne eigenes „ohne".

export function bad(msg) { const e = new Error(msg); e.status = 400; return e; }

export const ID_RE = /^[A-Za-z0-9_]{1,64}$/;
const REGION_RE = /^[a-z0-9]{2,5}$/;
const PATCH_RE = /^\d{1,2}\.\d{1,2}[a-z]?$/;
// 'unknown' nur noch fuer alte Links; die Oberflaeche bietet es nicht mehr an.
export const RANKS = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND', 'EMERALD', 'unknown'];
export const TABS = ['summary', 'units', 'items', 'traits', 'comps', 'level', 'round', 'gold', 'region', 'rank'];
export const ITEM_KINDS = ['artifact', 'emblem', 'radiant'];
export const LIMITS = { units: 9, items: 6, traits: 6, groups: 3, groupMembers: 6, total: 15 };

const TOP_KEYS = new Set(['region', 'ranks', 'patches', 'levels', 'place', 'units', 'items', 'traits', 'groups', 'tab', 'focus', 'split', 'combo']);
const UNIT_KEYS = new Set(['id', 'x', 's', 'se', 'sx', 'n', 'nx', 'c', 'it', 'nit', 'k']);
const ITEM_KEYS = new Set(['id', 'x', 'n']);
const TRAIT_KEYS = new Set(['id', 'x', 'l', 'le']);
const GROUP_KEYS = new Set(['m', 'units', 'items', 'traits']);

const onlyKeys = (o, allowed, what) => {
  if (o == null || typeof o !== 'object' || Array.isArray(o)) throw bad(`invalid_${what}`);
  for (const k of Object.keys(o)) if (!allowed.has(k)) throw bad(`unknown_field_${what}`);
};
const id = (v, what) => { if (typeof v !== 'string' || !ID_RE.test(v)) throw bad(`invalid_${what}`); return v; };
const arr = (v, what, max) => {
  if (v == null) return [];
  if (!Array.isArray(v) || v.length > max) throw bad(`invalid_${what}`);
  return v;
};
const ids = (v, what, max) => [...new Set(arr(v, what, max).map(x => id(x, what)))].sort();
const int = (v, lo, hi, what) => {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`invalid_${what}`);
  return n;
};
const bool = (v) => v === true;
const byJson = (a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b));

// Spanne lo..hi in [min, max]: fehlt lo bei gesetztem hi, gilt min; Grenzen,
// die nichts einschraenken, fallen weg (null).
function span(lo, hi, min, max, what) {
  if (lo == null && hi == null) return [null, null];
  const a = lo ?? min;
  const b = hi ?? max;
  if (a > b) throw bad(`invalid_${what}`);
  return [a === min && b !== a ? null : a, b === max ? null : b];
}

function unit(u, { inGroup = false } = {}) {
  onlyKeys(u, UNIT_KEYS, 'unit');
  if (inGroup && u.x === true) throw bad('invalid_group_unit');
  let s = int(u.s, 1, 4, 'star');
  let sx = int(u.sx, 1, 4, 'star');
  if (bool(u.se) && s != null) sx = s;          // alte Form: s2 + se = genau 2
  [s, sx] = span(s, sx, 1, 4, 'star');
  const [n, nx] = span(int(u.n, 0, 3, 'item_count'), int(u.nx, 0, 3, 'item_count'), 0, 3, 'item_count');
  const c = int(u.c, 1, 3, 'copies');
  const it = arr(u.it, 'item', 3).map(x => id(x, 'item')).sort();
  const nit = ids(u.nit, 'item', 3);
  const kRaw = arr(u.k, 'item_kind', ITEM_KINDS.length);
  const k = kRaw.map(e => {
    onlyKeys(e, new Set(['b', 'n']), 'item_kind');
    if (!ITEM_KINDS.includes(e.b)) throw bad('invalid_item_kind');
    return { b: e.b, n: int(e.n, 1, 3, 'item_kind') ?? 1 };
  }).sort((a, b) => ITEM_KINDS.indexOf(a.b) - ITEM_KINDS.indexOf(b.b));
  if (new Set(k.map(e => e.b)).size !== k.length) throw bad('invalid_item_kind');
  return {
    id: id(u.id, 'unit'), x: inGroup ? false : bool(u.x), s, sx, n, nx, c: c != null && c >= 2 ? c : null, it, nit, k,
  };
}

function item(i, { inGroup = false } = {}) {
  onlyKeys(i, ITEM_KEYS, 'item');
  if (inGroup && i.x === true) throw bad('invalid_group_item');
  // 2–3: so weit reichen die Masken (mask_uk.m2/m3) und die Oberflaeche.
  const n = int(i.n, 1, 3, 'item_count');
  return { id: id(i.id, 'item'), x: inGroup ? false : bool(i.x), n: n != null && n >= 2 ? n : null };
}

function trait(t, { inGroup = false } = {}) {
  onlyKeys(t, TRAIT_KEYS, 'trait');
  if (inGroup && t.x === true) throw bad('invalid_group_trait');
  return { id: id(t.id, 'trait'), x: inGroup ? false : bool(t.x), l: int(t.l, 1, 6, 'trait_level'), le: bool(t.le) };
}

function group(g) {
  onlyKeys(g, GROUP_KEYS, 'group');
  if (g.m !== 'any' && g.m !== 'none') throw bad('invalid_group');
  const units = arr(g.units, 'group', LIMITS.groupMembers).map(u => unit(u, { inGroup: true })).sort(byJson);
  const items = arr(g.items, 'group', LIMITS.groupMembers).map(i => item(i, { inGroup: true })).sort(byJson);
  const traits = arr(g.traits, 'group', LIMITS.groupMembers).map(t => trait(t, { inGroup: true })).sort(byJson);
  if (units.length + items.length + traits.length > LIMITS.groupMembers) throw bad('too_many_group_members');
  return { m: g.m, units, items, traits };
}

export function normalizeQuery(q) {
  if (!q || typeof q !== 'object' || Array.isArray(q)) throw bad('invalid_body');
  for (const k of Object.keys(q)) if (!TOP_KEYS.has(k)) throw bad('unknown_field');
  const region = q.region == null || q.region === 'all' ? 'all'
    : (typeof q.region === 'string' && REGION_RE.test(q.region) ? q.region : (() => { throw bad('invalid_region'); })());
  const ranks = q.ranks == null ? [] : (Array.isArray(q.ranks) && q.ranks.every(r => RANKS.includes(r))
    ? [...new Set(q.ranks)].sort() : (() => { throw bad('invalid_ranks'); })());
  // ['latest'] = neuester Patch im Speicher; wird im Handler aufgeloest.
  const patches = q.patches == null ? [] : Array.isArray(q.patches) && q.patches.length === 1 && q.patches[0] === 'latest' ? ['latest']
    : (Array.isArray(q.patches) && q.patches.length <= 12 && q.patches.every(p => typeof p === 'string' && PATCH_RE.test(p))
    ? [...new Set(q.patches)].sort() : (() => { throw bad('invalid_patches'); })());
  // Alle zehn Level = keine Einschraenkung.
  const lv = [...new Set(arr(q.levels, 'levels', 10).map(v => int(v, 1, 10, 'levels')))].sort((a, b) => a - b);
  const levels = lv.length === 10 ? [] : lv;
  let place = null;
  if (q.place != null) {
    if (!Array.isArray(q.place) || q.place.length !== 2) throw bad('invalid_place');
    const lo = int(q.place[0], 1, 8, 'place');
    const hi = int(q.place[1], 1, 8, 'place');
    if (lo == null || hi == null || lo > hi) throw bad('invalid_place');
    place = lo === 1 && hi === 8 ? null : [lo, hi];
  }
  if (Array.isArray(q.units) && q.units.length > LIMITS.units) throw bad('too_many_units');
  const units = arr(q.units, 'unit', LIMITS.units).map(u => unit(u)).sort(byJson);
  if (Array.isArray(q.items) && q.items.length > LIMITS.items) throw bad('too_many_items');
  const items = arr(q.items, 'item', LIMITS.items).map(i => item(i)).sort(byJson);
  if (Array.isArray(q.traits) && q.traits.length > LIMITS.traits) throw bad('too_many_traits');
  const traits = arr(q.traits, 'trait', LIMITS.traits).map(t => trait(t)).sort(byJson);
  if (Array.isArray(q.groups) && q.groups.length > LIMITS.groups) throw bad('too_many_groups');
  const groups = arr(q.groups, 'group', LIMITS.groups).map(group)
    .filter(g => g.units.length + g.items.length + g.traits.length > 0).sort(byJson);
  const total = units.length + items.length + traits.length
    + groups.reduce((a, g) => a + g.units.length + g.items.length + g.traits.length, 0);
  if (total > LIMITS.total) throw bad('too_many_filters');
  const tab = q.tab == null ? 'summary' : (TABS.includes(q.tab) ? q.tab : (() => { throw bad('invalid_tab'); })());
  const focus = q.focus == null ? null : id(q.focus, 'focus');
  const split = q.split === 'star' || q.split === 'over' ? q.split : null;
  const combo = int(q.combo, 1, 3, 'combo') ?? 1;
  return { region, ranks, patches, levels, place, units, items, traits, groups, tab, focus, split, combo };
}

// Brett-Filter (Units/Items/Traits/Kaesten): Kopf zeigt die Abweichung zur
// Grundmenge. Ueberall dieselbe Pruefung — eine vergessene Stelle beantwortet
// sonst einen Filter still aus den ungefilterten Teilsummen.
export const hasBoardFilters = (q) =>
  q.units.length + q.items.length + q.traits.length + (q.groups?.length ?? 0) > 0;

// Nicht aus den Tages-Teilsummen beantwortbar: Brett-Filter oder eine
// Grundmenge enger als Region/Patch (Rang, Level, Platz).
export const needsLive = (q) =>
  hasBoardFilters(q) || q.ranks.length > 0 || (q.levels?.length ?? 0) > 0 || q.place != null;

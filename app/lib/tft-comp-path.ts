// Lesbare Comp-Adressen (SEO Weg C, L2): `/tft/comps/lunar-aphelios` statt
// `/tft/comps/DA_18_Lunar%404_DA_18_Aphelios`. Der Name steht fuer eine
// Familien-Kennung `<trait>__<carry>` (User-Override C: Level, Sterne, Augment
// und zweiter Carry gehoeren zur Familie) und wird rein aus den Anzeigenamen
// des Bundles gebildet — kein Netz, keine Datenbank. Eine Quelle fuer Links,
// Weiterleitung (middleware.ts), 404-Pruefung, Seite, Titel und Vorschaubild.
//
// Regeln:
//  - Schreibweise: ohne Akzente, klein, `'` und `.` gestrichen, sonst `-`
//    (Kha'Zix → khazix). Trait vorn, Carry hinten.
//  - Zwei Traits mit gleichem Namen in einem Set: keiner bekommt einen Namen.
//  - Zwei Units mit gleichem Namen (Akali, Master Yi in Set 18): die mit dem
//    Mehrheits-Praefix der Units gewinnt (DA_ vor TFT18_), sonst alphabetisch.
//  - Rundlauf: lesbar wird eine Kennung nur, wenn ihr Name wieder genau auf
//    ihre Familie fuehrt. Verlierer bleiben technisch — nie eine falsche Comp.
//  - Links und Weiterleitung nur fuer das laufende Set; aufgeloest werden alle
//    Sets der Tabelle (laufendes zuerst), damit alte Adressen nach dem
//    Set-Wechsel nicht brechen (dann noindex, seo/names.ts).
//
// Blatt-Modul: laeuft in Middleware (Edge), Server und Browser. Nie das Bundle
// (tft-assets-*.json, 2 MB) oder known-ids importieren.
//
// Nach einer ausgelieferten 308 (ab 29.10.2026) duerfen lesbare Namen nie
// wieder auf Kennungen zurueckleiten und die Aufloesung nie entfernt werden:
// Browser und die Companion-App (0.8.3 baut Kennungs-Links) verlassen sich darauf.
import names from './tft-comp-names.generated.json';
import { parseClusterKey, parseFamilyKey } from './tft-cluster';

export interface CompNameTable {
  currentSet: number | null;
  sets: Record<string, { traits: Record<string, string>; units: Record<string, string> }>;
}

const TABLE = names as CompNameTable;

/** Notschalter: `NEXT_PUBLIC_COMP_READABLE=0` → Links, canonical, Sitemap und
 *  Weiterleitung wieder technisch. Die Aufloesung lesbarer Namen bleibt an. */
export function compReadableEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMP_READABLE !== '0';
}

/** Lesbare Form eines Anzeigenamens. */
export function compSlugName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

interface SetIndex {
  set: number;
  traitBySlug: Map<string, string>;
  unitBySlug: Map<string, string>;
  slugOfTrait: Map<string, string>;
  slugOfUnit: Map<string, string>;
}

function groupBySlug(map: Record<string, string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const [id, name] of Object.entries(map)) {
    const s = compSlugName(name);
    if (!s) continue;
    const list = out.get(s);
    if (list) list.push(id); else out.set(s, [id]);
  }
  return out;
}

const prefixOf = (id: string) => id.split('_')[0];

function buildIndex(set: number, raw: CompNameTable['sets'][string]): SetIndex {
  const idx: SetIndex = {
    set, traitBySlug: new Map(), unitBySlug: new Map(), slugOfTrait: new Map(), slugOfUnit: new Map(),
  };
  for (const [s, ids] of groupBySlug(raw.traits || {})) {
    if (ids.length !== 1) continue;
    idx.traitBySlug.set(s, ids[0]);
    idx.slugOfTrait.set(ids[0], s);
  }
  const prefixCount = new Map<string, number>();
  for (const id of Object.keys(raw.units || {})) prefixCount.set(prefixOf(id), (prefixCount.get(prefixOf(id)) ?? 0) + 1);
  const rank = (id: string) => prefixCount.get(prefixOf(id)) ?? 0;
  for (const [s, ids] of groupBySlug(raw.units || {})) {
    const winner = [...ids].sort((a, b) => rank(b) - rank(a) || (a < b ? -1 : a > b ? 1 : 0))[0];
    idx.unitBySlug.set(s, winner);
    idx.slugOfUnit.set(winner, s);
  }
  return idx;
}

const indexCache = new WeakMap<CompNameTable, SetIndex[]>();

/** Indizes, laufendes Set zuerst, danach die uebrigen neueste zuerst. */
function indexes(table: CompNameTable): SetIndex[] {
  let list = indexCache.get(table);
  if (!list) {
    list = Object.entries(table.sets || {})
      .map(([set, raw]) => buildIndex(Number(set), raw))
      .sort((a, b) => Number(b.set === table.currentSet) - Number(a.set === table.currentSet) || b.set - a.set);
    indexCache.set(table, list);
  }
  return list;
}

/** true = Tabelle leer (Erzeuger lief nicht): dann alles durchlassen. */
export function compNamesEmpty(table: CompNameTable = TABLE): boolean {
  return indexes(table).length === 0;
}

const READABLE_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

export interface ReadableHit { familyKey: string; set: number; current: boolean }

/** Lesbarer Name → Familien-Kennung, oder null. */
export function resolveReadable(name: string, table: CompNameTable = TABLE): ReadableHit | null {
  if (!READABLE_SHAPE.test(name)) return null;
  for (const idx of indexes(table)) {
    // Trait-Namen koennen selbst Bindestriche haben (riftbeast-…): jede Trennung probieren.
    for (let i = name.indexOf('-'); i > 0; i = name.indexOf('-', i + 1)) {
      const trait = idx.traitBySlug.get(name.slice(0, i));
      const carry = trait ? idx.unitBySlug.get(name.slice(i + 1)) : undefined;
      if (trait && carry) return { familyKey: `${trait}__${carry}`, set: idx.set, current: idx.set === table.currentSet };
    }
  }
  return null;
}

/** Familien-Kennung einer Cluster- oder Familien-Kennung, sonst null. */
export function familyKeyOf(key: string): string | null {
  const parts = parseClusterKey(key);
  if (parts) return `${parts.trait}__${parts.carry}`;
  return parseFamilyKey(key) ? key : null;
}

/** Lesbarer Name einer Kennung des laufenden Sets, nur mit bestandenem Rundlauf. */
export function readableForKey(key: string, table: CompNameTable = TABLE): string | null {
  const fk = familyKeyOf(key);
  const fam = fk ? parseFamilyKey(fk) : null;
  const idx = indexes(table)[0];
  if (!fam || !idx || idx.set !== table.currentSet) return null;
  const t = idx.slugOfTrait.get(fam.trait);
  const u = idx.slugOfUnit.get(fam.carry);
  if (!t || !u) return null;
  const name = `${t}-${u}`;
  const back = resolveReadable(name, table);
  return back && back.current && back.familyKey === fk ? name : null;
}

/** Adresse der Detailseite ohne Sprach-Vorsatz und ohne Abfrage. */
export function compPath(key: string, table: CompNameTable = TABLE): string {
  const name = compReadableEnabled() ? readableForKey(key, table) : null;
  // eslint-disable-next-line no-restricted-syntax -- die eine Stelle, die Comp-Adressen baut
  return `/tft/comps/${name ?? encodeURIComponent(key)}`;
}

function lowerReadable(segment: string, table: CompNameTable): string | null {
  if (!/[A-Z]/.test(segment) || /[@_]/.test(segment)) return null;
  const lower = segment.toLowerCase();
  return resolveReadable(lower, table) ? lower : null;
}

/** Interne Kennung hinter dem (dekodierten) Pfadteil der Detailseite. */
export function compRouteKey(segment: string, table: CompNameTable = TABLE): string {
  const hit = resolveReadable(segment, table) ?? resolveReadable(lowerReadable(segment, table) ?? '', table);
  return hit?.familyKey ?? segment;
}

/** true = lesbarer Name, den die Tabelle kennt (oder Tabelle leer). Fuer die 404-Pruefung. */
export function isKnownReadable(segment: string, table: CompNameTable = TABLE): boolean {
  if (!READABLE_SHAPE.test(segment) && !lowerReadable(segment, table)) return false;
  return compNamesEmpty(table) || !!resolveReadable(segment, table) || !!lowerReadable(segment, table);
}

/**
 * Was die Detailseite abfragt — EINE Auslese fuer Startdaten (Server) und
 * Seite (Browser), sonst passen deren Schluessel nie. `?variant=exact` = genaue
 * Ansicht der Kennung der Adresse (bei Familien-Kennung: die meistgespielte
 * Variante); `?variant=<Kennung derselben Familie>` = genaue Ansicht dieser
 * Variante (so kommen alte Adressen mit ?variant=exact an).
 */
export function compDetailTarget(routeKey: string, variant: string | null | undefined): { apiSlug: string; mode: 'family' | 'exact' } {
  if (variant === 'exact') return { apiSlug: routeKey, mode: 'exact' };
  if (variant && variant.includes('@')) {
    const fk = familyKeyOf(variant);
    if (fk && fk === familyKeyOf(routeKey)) return { apiSlug: variant, mode: 'exact' };
  }
  return { apiSlug: routeKey, mode: 'family' };
}

// 307 die ersten zwei Wochen (User-Entscheid 15.10.2026), danach 308. Ab der
// Zeitumstellung (25.10.) gilt MEZ.
export const COMP_PERMANENT_FROM = Date.parse('2026-10-29T00:00:00+01:00');

export interface CompRedirect { pathname: string; search: string; status: 307 | 308 }

function decodeSegment(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

/**
 * Entscheidung der Middleware fuer `/tft/comps/<Pfadteil>` (Pfad ohne
 * Sprach-Vorsatz): Kennung des laufenden Sets → lesbarer Name, Grossschreibung
 * → Kleinschreibung. null = durchlassen. Das Ziel enthaelt nie `@`/`_` und wird
 * deshalb nie erneut umgeleitet.
 */
export function compRedirect(
  pathname: string,
  params: URLSearchParams,
  opts: { now: number; status?: string; enabled?: boolean },
  table: CompNameTable = TABLE,
): CompRedirect | null {
  if (opts.enabled === false) return null;
  const m = /^\/tft\/comps\/([^/]+)$/.exec(pathname);
  const segment = m ? decodeSegment(m[1]) : null;
  if (!segment) return null;
  const next = new URLSearchParams(params);
  let target: string | null;
  if (segment.includes('@') || parseFamilyKey(segment)) {
    target = readableForKey(segment, table);
    // Alte genaue Ansicht: die Kennung wandert in den Parameter.
    if (target && segment.includes('@') && next.get('variant') === 'exact') next.set('variant', segment);
  } else {
    target = lowerReadable(segment, table);
  }
  if (!target) return null;
  const status = opts.status === '307' || opts.status === '308'
    ? (Number(opts.status) as 307 | 308)
    : opts.now >= COMP_PERMANENT_FROM ? 308 : 307;
  const q = next.toString();
  // eslint-disable-next-line no-restricted-syntax -- Ziel der Weiterleitung, schon lesbar
  return { pathname: `/tft/comps/${target}`, search: q ? `?${q}` : '', status };
}

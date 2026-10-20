// Comp-Katalog fuer eine Abfrage der Seite (User 19./20.10.2026: Comp-Liste mit
// dem Durchschnitt ALLER Spieler einer Comp). Laedt die Kataloge der Patches im
// Fenster (Migration 0099) und ordnet jeder klassischen Familie
// `<trait>__<carry>` ihre Comp zu. EINE Stelle fuer alle Comp-Routen — Liste,
// Detail, Varianten, Duelle —, damit sie dieselbe Zuordnung sehen.
//
// Tageszeilen bleiben, wie der Sammler sie schrieb. Fuer Tage mit klassischer
// Einteilung ist die Zuordnung ein reines Nachschlagen (Mitglieder und fest
// zugeordnete Familien des Katalogs); Zeilen, deren Familie keine Comp hat,
// erscheinen nicht. Ab dem Sammler mit Katalog (Phase 2) tragen die Zeilen den
// Comp-Namen schon als Familie, das Nachschlagen liefert ihn unveraendert.
//
// Fenster ueber eine Patch-Grenze (?patch=current filtert nicht nach Patch,
// tft-supabase-reader.ts): alle Kataloge im Fenster, der neuere gewinnt —
// gleiche Comps tragen dank Namensuebernahme (carryNames) denselben Namen.
//
// Versionen (0101): der Tagestreiber schreibt Kataloge „gueltig ab Tag D“. Je
// Patch im Fenster gilt die neueste Version mit Tag ≤ Fensterende (genauer
// Patch, sonst Grund-Patch 18.5b → 18.5, sonst neuester Katalog des Sets) —
// get_tft_comp_catalog_window. Fensterende = filters.endDay, sonst das
// Besucher-Ende (resolveDataEnd), sonst heute.
//
// Notschalter COMP_CATALOG_READ=0 → kein Katalog, alles klassisch wie vorher.
// Ohne Katalog fuer das Fenster (Set ohne Kataloge, RPC-Fehler) ebenfalls
// klassisch; `catalogId` in den Antworten verraet, welcher Stand gilt.
import { callRpc, resolveDataEnd, type ResolvedFilters } from './tft-supabase-reader';
import { compTraitFamilyKey, parseFamilyKey } from './tft-cluster';
import { mergedAliasMap, type CatalogComp, type Catalog } from './tft-comp-catalog.mjs';

export interface CompCatalogView {
  /** Kennung des Stands (Kataloge im Fenster), fuer Vorrat und Antworten. */
  id: string;
  /** Klassische Familie → Comp-Name. */
  lookup: Map<string, string>;
  /** Comp-Name → Katalog-Eintrag (neuester Katalog im Fenster gewinnt). */
  comps: Map<string, CatalogComp>;
}

interface CatalogRow {
  patch: string;
  catalog_id: number | string | null;
  catalog_patch: string | null;
  scope: string | null;
  scope_key: string | null;
  rules_version: number | null;
  hash: string | null;
  comps: CatalogComp[] | null;
}

const TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; view: Promise<CompCatalogView | null> }>();

export function compCatalogReadEnabled(): boolean {
  return process.env.COMP_CATALOG_READ !== '0';
}

// 18.4 < 18.5 < 18.5b < 18.10 — aelteste zuerst, der neuere gewinnt.
export function comparePatchLabels(a: string, b: string): number {
  const pa = /^(\d+)\.(\d+)([a-z]?)$/.exec(a);
  const pb = /^(\d+)\.(\d+)([a-z]?)$/.exec(b);
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0;
  return Number(pa[1]) - Number(pb[1]) || Number(pa[2]) - Number(pb[2]) || (pa[3] < pb[3] ? -1 : pa[3] > pb[3] ? 1 : 0);
}

async function loadView(set: number, start: string, end: string, patches: string[] | null): Promise<CompCatalogView | null> {
  const rows = await callRpc<CatalogRow[]>('get_tft_comp_catalog_window',
    { p_set: set, p_start: start, p_end: end, p_patches: patches }, 8000);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Ohne Katalog steht ein Patch nur, wenn das Set gar keinen hat → klassisch.
  if (rows.some(r => r.catalog_id == null)) return null;
  const sorted = [...rows].sort((a, b) => comparePatchLabels(a.patch, b.patch));
  // 18.5 und 18.5b koennen dieselbe Version nutzen: einmal zusammenlegen.
  const seen = new Set<string>();
  const catalogs: Catalog[] = [];
  for (const r of sorted) {
    const id = String(r.catalog_id);
    if (seen.has(id)) continue;
    seen.add(id);
    catalogs.push({ version: r.rules_version ?? 0, comps: r.comps || [] });
  }
  const comps = new Map<string, CatalogComp>();
  for (const cat of catalogs) for (const c of cat.comps) comps.set(c.key, c);
  return {
    id: sorted.map(r => `${r.patch}:${r.hash}`).join(','),
    lookup: mergedAliasMap(catalogs),
    comps,
  };
}

/**
 * Kataloge fuer Set + Fenster, 10 min je Instanz gemerkt (leere Sicht und
 * Fehler 60 s). `fresh`: Publisher-Anfragen laden neu, damit der Vorrat nie
 * einen Stand von vor dem Lauf einbaeckt.
 */
function compCatalogFor(set: number, start: string, end: string, patches: string[] | null, fresh: boolean): Promise<CompCatalogView | null> {
  const key = `${set}|${start}|${end}|${patches ? patches.join(',') : '*'}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (!fresh && hit && now - hit.at < TTL_MS) return hit.view;
  const view = loadView(set, start, end, patches).then(v => {
    // Leere Sicht nur kurz merken: die erste Version eines neuen Patches kommt
    // nach dem Lauf dazu.
    if (!v) cache.set(key, { at: now - TTL_MS + NEGATIVE_TTL_MS, view: Promise.resolve(null) });
    return v;
  }, err => {
    console.error('[comp-catalog] Laden fehlgeschlagen, klassisch:', (err as Error)?.message ?? err);
    // Fehler kurz merken, damit nicht jede Anfrage erneut wartet.
    cache.set(key, { at: now - TTL_MS + NEGATIVE_TTL_MS, view: Promise.resolve(null) });
    return null;
  });
  cache.set(key, { at: now, view });
  if (cache.size > 64) {
    for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  }
  return view;
}

function isoAddDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Katalog-Sicht fuer die gefilterte Abfrage (null = klassisch). */
export async function compCatalogForFilters(
  filters: Pick<ResolvedFilters, 'patchFilter' | 'setNumber' | 'startDay' | 'endDay' | 'days'>,
  opts: { fresh?: boolean } = {},
): Promise<CompCatalogView | null> {
  if (!compCatalogReadEnabled() || filters.setNumber == null) return null;
  try {
    const end = filters.endDay ?? (await resolveDataEnd(null)) ?? new Date().toISOString().slice(0, 10);
    const start = filters.startDay ?? isoAddDays(end, -(Math.max(1, filters.days) - 1));
    return await compCatalogFor(filters.setNumber, start, end, filters.patchFilter ? [filters.patchFilter] : null, opts.fresh === true);
  } catch (err) {
    console.error('[comp-catalog] Fenster nicht bestimmbar, klassisch:', (err as Error)?.message ?? err);
    return null;
  }
}

/**
 * Comp einer Kennung in der Standardansicht (laufendes Set, 3 Tage) fuer
 * Seitentitel und canonical: undefined = kein Katalog oder nicht rechtzeitig
 * (dann wie bisher), null = Familie ohne Comp. Wartet hoechstens `timeoutMs`;
 * das Laden laeuft weiter und ist beim naechsten Aufruf gemerkt.
 */
export async function compKeyForDefaultView(key: string, set: number, timeoutMs = 400): Promise<string | null | undefined> {
  if (!compCatalogReadEnabled()) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>(res => { timer = setTimeout(() => res(undefined), timeoutMs); });
  try {
    const view = await Promise.race([
      compCatalogForFilters({ patchFilter: null, setNumber: set, startDay: null, endDay: null, days: 3 }),
      timeout,
    ]);
    return view ? compKeyOf(view, key) : undefined;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Katalog-Angabe fuer den Detail-Vorrat (comp-detail-snapshot.ts) bei Lesern
 * ausserhalb der Route (Startdaten der Seite, Vorschaubild): 'classic' = kein
 * Katalog, 'none' = Slug ohne Comp (die Route antwortet ohne Daten).
 */
export async function detailCatalogFor(
  filters: Pick<ResolvedFilters, 'patchFilter' | 'setNumber' | 'startDay' | 'endDay' | 'days'>,
  slug: string,
): Promise<{ id: string; compKey: string } | 'classic' | 'none'> {
  const view = await compCatalogForFilters(filters);
  if (!view) return 'classic';
  const compKey = compKeyOf(view, slug);
  return compKey ? { id: view.id, compKey } : 'none';
}

/** Comp einer Cluster- oder Familien-Kennung; null = ohne Comp (ausblenden). */
export function compKeyOf(view: CompCatalogView, key: string): string | null {
  const fam = parseFamilyKey(key) ? key : compTraitFamilyKey(key);
  return view.lookup.get(fam) ?? null;
}

/** Alle klassischen Familien, die zu einer der Comps gehoeren. */
export function membersOfComps(view: CompCatalogView, compKeys: Iterable<string>): string[] {
  const want = new Set(compKeys);
  const out: string[] = [];
  for (const [fam, comp] of view.lookup) if (want.has(comp)) out.push(fam);
  return out.sort();
}

/** Traits, unter denen die Zeilen der Comps liegen (fuer p_cluster_traits). */
export function traitsOfFamilies(families: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const f of families) {
    const p = parseFamilyKey(f);
    if (p) out.add(p.trait);
  }
  return [...out].sort();
}

/** Comps mit demselben Trait im Namen (Kandidaten fuer den Zwei-Carry-Merge). */
export function compsWithTrait(view: CompCatalogView, trait: string): string[] {
  const out: string[] = [];
  for (const k of view.comps.keys()) if (parseFamilyKey(k)?.trait === trait) out.push(k);
  return out.sort();
}

/**
 * Comp-Zeilen der Listen-API mit `compKey` versehen (null = ohne Comp). Ohne
 * Katalog (Notschalter, Set ohne Kataloge) wird ein vorhandenes `compKey`
 * entfernt — die Seite gruppiert dann klassisch.
 */
export function applyCompCatalog<T extends { clusterKey?: string | null; slug?: string | null; compKey?: string | null }>(
  comps: T[],
  view: CompCatalogView | null,
): T[] {
  if (!view) {
    return comps.map(c => {
      if (!('compKey' in c)) return c;
      const rest: Partial<T> = { ...c };
      delete rest.compKey;
      return rest as T;
    });
  }
  return comps.map(c => ({ ...c, compKey: compKeyOf(view, c.slug || c.clusterKey || '') }));
}

/**
 * Gespeicherte Listen-Antwort mit dem Katalog ihres eigenen Fensters
 * (payload.filters) — fuer Leser, die den Vorrat ohne die Route lesen
 * (Sitemap, Familien-Liste des Publishers, Startdaten der Seite).
 */
export async function listPayloadWithCatalog<P extends { comps?: unknown; catalogId?: string | null; filters?: unknown }>(
  payload: P,
): Promise<P> {
  const f = (payload.filters ?? {}) as {
    patchFilter?: string | null; set?: number | null; startDay?: string | null; endDay?: string | null; days?: number;
  };
  const view = await compCatalogForFilters({
    patchFilter: f.patchFilter ?? null,
    setNumber: typeof f.set === 'number' ? f.set : null,
    startDay: f.startDay ?? null,
    endDay: f.endDay ?? null,
    days: typeof f.days === 'number' ? f.days : 3,
  });
  return listPayloadForCatalog(payload, view);
}

/** Listen-Antwort (auch aus dem Vorrat) auf die gueltige Katalog-Sicht bringen. */
export function listPayloadForCatalog<P extends { comps?: unknown; catalogId?: string | null }>(
  payload: P,
  view: CompCatalogView | null,
): P {
  const want = view?.id ?? null;
  if (!Array.isArray(payload.comps) || ((payload.catalogId ?? null) === want && 'catalogId' in payload)) return payload;
  return { ...payload, catalogId: want, comps: applyCompCatalog(payload.comps as Array<{ clusterKey?: string | null }>, view) };
}

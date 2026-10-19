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
// Notschalter COMP_CATALOG_READ=0 → kein Katalog, alles klassisch wie vorher.
// Ohne Katalog fuer das Fenster (Set ohne Kataloge, RPC-Fehler) ebenfalls
// klassisch; `catalogId` in den Antworten verraet, welcher Stand gilt.
import { callRpc, getAvailablePatches, type ResolvedFilters } from './tft-supabase-reader';
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
  catalog_id: number | string;
  patch: string;
  scope: string;
  scope_key: string;
  rules_version: number;
  hash: string;
  built_at: string;
  comps: CatalogComp[];
}

const TTL_MS = 10 * 60_000;
const NEGATIVE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; view: Promise<CompCatalogView | null> }>();

export function compCatalogReadEnabled(): boolean {
  return process.env.COMP_CATALOG_READ !== '0';
}

async function loadView(set: number, patches: string[]): Promise<CompCatalogView | null> {
  const rows = await callRpc<CatalogRow[]>('get_tft_comp_catalogs', { p_set: set, p_patches: patches }, 8000);
  if (!Array.isArray(rows) || rows.length === 0) return null;
  // Nur mit einem Katalog fuer JEDEN Patch im Fenster: sonst fielen Familien,
  // die es erst im neuen Patch gibt, als „ohne Comp" aus der Liste (erste Tage
  // nach dem Patchwechsel, bevor dessen Katalog steht). Dann klassisch.
  const have = new Set(rows.map(r => r.patch));
  if (patches.some(p => !have.has(p))) return null;
  // Reihenfolge der Patches = aelteste zuerst (Aufrufer), der neuere gewinnt.
  const order = new Map(patches.map((p, i) => [p, i]));
  const sorted = [...rows].sort((a, b) => (order.get(a.patch) ?? 0) - (order.get(b.patch) ?? 0));
  const catalogs: Catalog[] = sorted.map(r => ({ version: r.rules_version, comps: r.comps || [] }));
  const comps = new Map<string, CatalogComp>();
  for (const cat of catalogs) for (const c of cat.comps) comps.set(c.key, c);
  return {
    id: sorted.map(r => `${r.patch}:${r.hash}`).join(','),
    lookup: mergedAliasMap(catalogs),
    comps,
  };
}

/** Kataloge fuer Set + Patches (aelteste zuerst), 10 min je Instanz gemerkt. */
export function compCatalogFor(set: number | null, patches: string[]): Promise<CompCatalogView | null> {
  if (!compCatalogReadEnabled() || set == null || patches.length === 0) return Promise.resolve(null);
  const key = `${set}|${patches.join(',')}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.view;
  const view = loadView(set, patches).catch(err => {
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

/** Patches, deren Tage im Fenster der Abfrage liegen, aelteste zuerst. */
export async function windowPatches(filters: Pick<ResolvedFilters, 'patchFilter' | 'setNumber' | 'startDay' | 'endDay' | 'days'>): Promise<string[]> {
  if (filters.patchFilter) return [filters.patchFilter];
  const patches = (await getAvailablePatches()).filter(p => filters.setNumber == null || p.set_number === filters.setNumber);
  if (patches.length === 0) return [];
  const latest = patches.reduce((m, p) => (p.last_day > m ? p.last_day : m), patches[0].last_day);
  const end = filters.endDay ?? latest;
  const start = filters.startDay ?? isoAddDays(end, -(Math.max(1, filters.days) - 1));
  return patches
    .filter(p => p.first_day <= end && p.last_day >= start)
    .sort((a, b) => (a.first_day < b.first_day ? -1 : a.first_day > b.first_day ? 1 : 0))
    .map(p => p.patch);
}

function isoAddDays(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Katalog-Sicht fuer die gefilterte Abfrage (null = klassisch). */
export async function compCatalogForFilters(
  filters: Pick<ResolvedFilters, 'patchFilter' | 'setNumber' | 'startDay' | 'endDay' | 'days'>,
): Promise<CompCatalogView | null> {
  if (!compCatalogReadEnabled() || filters.setNumber == null) return null;
  try {
    return await compCatalogFor(filters.setNumber, await windowPatches(filters));
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

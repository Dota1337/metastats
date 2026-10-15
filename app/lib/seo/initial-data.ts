import 'server-only';
// Startdaten fuer die Statistik-Listen (SEO-Plan Schritt 3): die Server-Seite
// liefert die Standardansicht gleich mit Namen und Zahlen aus, statt sie erst
// im Browser nachzuladen — sonst sieht ein Suchmaschinen-Bot eine leere Liste.
//
// Harte Regeln (Pruefrunde 11.10., plan-current.md):
//   - NUR der vorgerechnete Zwischenstand (lookupSnapshot), nie der Live-Weg der
//     API: der umginge deren Edge-Cache, jeder Bot-Aufruf ginge an die DB.
//     Filter bestimmt resolveFilters — dieselbe Funktion wie in den Routen,
//     damit Rang, Patch, Region und Set denselben Snapshot treffen. Ihre zwei
//     DB-Abfragen (Rang, Patchliste) sind je Prozess 6 h zwischengespeichert
//     und stellt jede Stats-API ohnehin.
//   - Notschalter SEO_START_DATA=0: keine Startdaten, die Listen laden wie vor
//     Schritt 3 im Browser.
//   - Hoechstens 1,5 s fuer alles. Danach, bei Fehlern, leerem oder nicht
//     vorgerechnetem Stand: keine Startdaten — die Seite laedt wie bisher im
//     Browser. Nie leere oder erfundene Zahlen.
//   - Startdaten = genau die Antwort, die der Browser von der API bekaeme
//     (gleiche Filter, gleiche Sortierung), sonst springt die Liste nach dem
//     ersten Abruf. Ausnahme Comps: nur die Zeilen der gezeigten Familien und
//     ohne Trend/Mitspiel-Anteil (`partial`, compsStart unten).
import tierCutoffsFile from '../../../public/tft-tier-cutoffs.json' with { type: 'json' };
import { lookupSnapshot } from '../snapshot-lookup';
import type { SnapshotEndpoint } from '../snapshot-matrix';
import { resolveFilters } from '../tft-supabase-reader';
import { filtersFromSearchParams, filtersDataKey, type Filters, type PatchInfo } from '../tft-filters';
import { resolveCutoffs, type TierCutoffs, type TierCutoffsBundle } from '../tft-tier-letter';
import { sortUnitsRareLast } from '../tft-list-sort';
import { parseClusterKey } from '../tft-cluster';
import { shownFamilyRows, type CompApiRow } from '../tft-comp-families';
import type { TftAssetsBundle } from '../tft-cdragon';
import { tftAssets } from '../og/data';
import { withTimeout } from '../og/frame';

const BUDGET_MS = 1500;
const CACHE_TTL_MS = 5 * 60 * 1000;   // wie das Manifest in snapshot-lookup.ts
const CACHE_MAX = 8;

export interface StatsPayload<Row> {
  hasData: boolean;
  filters?: Record<string, unknown>;
  patches: PatchInfo[];
  /** Nur Comps: wirksame Mindestspiele der Antwort (Feld minGames der API). */
  minGames?: number | null;
  rows: Row[];
}

export interface StatsInitial<Row> {
  payload: StatsPayload<Row>;
  // Nur die Eintraege, die die gezeigten Zeilen brauchen, jeweils vollstaendig —
  // das volle Bundle (2,1 MB) laedt der Browser danach wie bisher.
  assets: TftAssetsBundle;
  tierCutoffs: TierCutoffs;
  /** Nur ein Teil der API-Zeilen (Comps: die der gezeigten Familien). Wer mehr
   *  braucht (Suche, Erweitert), laedt die volle Liste nach — nur
   *  useTftCompsData kennt das. */
  partial?: boolean;
  /** Stand des vorgerechneten Zwischenstands (Manifest builtAt). Die
   *  Comps-Liste haengt ihn beim Nachladen an (?sv=), damit keine aeltere
   *  Edge-Kopie der API die Zahlen zurueckspringen laesst. */
  version?: string;
}

export interface StatsStart<Row> {
  /** Start-Filter: Adresse + vom Server bestimmter Standard-Rang. */
  filters: Filters;
  data: StatsInitial<Row> | null;
}

export function toSearchParams(raw: Record<string, string | string[] | undefined>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') sp.set(k, v);
    else if (Array.isArray(v) && v.length) sp.set(k, v[0]);
  }
  return sp;
}

const cache = new Map<string, { ts: number; value: StatsInitial<unknown> }>();

function cacheGet<Row>(key: string): StatsInitial<Row> | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.ts > CACHE_TTL_MS) { cache.delete(key); return null; }
  return hit.value as StatsInitial<Row>;
}

function cacheSet(key: string, value: StatsInitial<unknown>): void {
  cache.delete(key);
  cache.set(key, { ts: Date.now(), value });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

// `withAbility: false` laesst den Faehigkeitstext weg (~330 B je Champion), wenn
// die Seite keine Champion-Tooltips zeigt (tftChampionTooltip). Items stehen in
// der Reihenfolge des Bundles: die Item-Detailseite nimmt die ersten 12 Treffer
// einer Suche ueber alle Items („gleiche Bauteile“).
export function subsetBundle(
  bundle: TftAssetsBundle,
  pick: {
    champions?: Iterable<string>;
    items?: Iterable<string>;
    // Traits mit diesem Anzeigenamen, ALLE Varianten: die Traits-Liste fasst
    // nach Anzeigenamen zusammen und sucht ihr Symbol unter allen Varianten.
    traitNames?: Iterable<string>;
    // Traits nach Kennung (Comps: Familien-Trait aus dem Cluster-Schluessel).
    traitIds?: Iterable<string>;
    withAbility?: boolean;
    /** active.items mitgeben (auf die enthaltenen Items gekuerzt). */
    activeItems?: boolean;
  },
): TftAssetsBundle {
  const champions: TftAssetsBundle['champions'] = {};
  const traits: TftAssetsBundle['traits'] = {};
  const items: TftAssetsBundle['items'] = {};
  for (const id of pick.champions ?? []) {
    const c = bundle.champions?.[id];
    if (!c) continue;
    if (pick.withAbility === false) {
      const rest = { ...c };
      delete rest.ability;
      champions[id] = rest;
    } else {
      champions[id] = c;
    }
    for (const t of c.traits || []) if (bundle.traits?.[t]) traits[t] = bundle.traits[t];
  }
  const itemIds = new Set(pick.items ?? []);
  if (itemIds.size) {
    for (const [id, it] of Object.entries(bundle.items || {})) if (itemIds.has(id)) items[id] = it;
  }
  for (const id of pick.traitIds ?? []) if (bundle.traits?.[id]) traits[id] = bundle.traits[id];
  const names = new Set(pick.traitNames ?? []);
  if (names.size) {
    for (const [id, tr] of Object.entries(bundle.traits || {})) if (names.has(tr.name)) traits[id] = tr;
  }
  return {
    set: bundle.set, setName: bundle.setName, mutator: bundle.mutator, fetchedAt: bundle.fetchedAt,
    iconBase: bundle.iconBase, companionsIconBase: bundle.companionsIconBase,
    champions, traits, items, augments: {},
    ...(pick.activeItems && bundle.active ? { active: { items: (bundle.active.items || []).filter(id => !!items[id]) } } : {}),
  };
}

interface EndpointSpec<Row> {
  endpoint: SnapshotEndpoint;
  /** Feld der API-Antwort mit den Zeilen (units / items / traits). */
  field: string;
  /** Wie die API die Zeilen nach dem Snapshot-Treffer behandelt (Comps: nur
   *  die Zeilen der gezeigten Familien). */
  prepare?: (rows: Row[], bundle: TftAssetsBundle) => Row[] | null;
  assets: (bundle: TftAssetsBundle, rows: Row[]) => TftAssetsBundle;
  /** Ansicht, die die Startdaten nicht abbilden — der Browser laedt wie bisher. */
  skip?: boolean;
  partial?: boolean;
}

async function loadStart<Row>(spec: EndpointSpec<Row>, sp: URLSearchParams): Promise<StatsStart<Row>> {
  const deadline = Date.now() + BUDGET_MS;
  const left = () => Math.max(0, deadline - Date.now());

  // Filter wie die Route (Rang bei bucketAuto vom Server, aufgeloester Patch,
  // Set). Antwortet das nicht rechtzeitig, kennen wir sie nicht sicher → keine
  // Startdaten, der Browser fragt wie bisher mit bucketAuto=1.
  const resolved = process.env.SEO_START_DATA === '0' ? null : await withTimeout(resolveFilters(sp), left());
  const filters = filtersFromSearchParams(sp, resolved?.bucketLabel ?? 'diamond_plus');
  if (!resolved) return { filters, data: null };

  // Trend-Vergleich und ein ausdruecklich gewaehlter Patch: keine Startdaten
  // (bei units laufen beide live, siehe units/route.ts).
  if (resolved.patchFilter != null || filters.velocity > 0 || spec.skip) return { filters, data: null };

  // Mit aufgeloestem Patch und Set: nach einem Patchwechsel neuer Schluessel.
  const key = `${spec.endpoint}|${resolved.patch}|${resolved.setNumber}|${filtersDataKey(filters)}`;
  const cached = cacheGet<Row>(key);
  if (cached) return { filters, data: cached };

  const bundle = tftAssets();
  if (!bundle) return { filters, data: null };

  // Genau der Aufruf der Routen (units/items/traits route.ts, Snapshot-Pfad).
  const hit = await withTimeout(lookupSnapshot(spec.endpoint, {
    patch: resolved.patch, region: resolved.regionLabel, days: resolved.requestedDays,
    bucket: resolved.bucketLabel, minGames: 0, setNumber: resolved.setNumber,
    endDay: resolved.endDay,
  }), left());
  const payload = hit?.payload as (Record<string, unknown> & { hasData?: boolean; patches?: PatchInfo[]; minGames?: unknown }) | undefined;
  const raw = payload?.[spec.field];
  // Gleicher Schutz wie die Route: nie einen leeren Stand ausliefern.
  if (!payload?.hasData || !Array.isArray(raw) || raw.length === 0) return { filters, data: null };

  const rows = spec.prepare ? spec.prepare([...raw] as Row[], bundle) : ([...raw] as Row[]);
  if (!rows || rows.length === 0) return { filters, data: null };
  const value: StatsInitial<Row> = {
    payload: {
      hasData: true,
      filters: payload.filters as Record<string, unknown> | undefined,
      patches: Array.isArray(payload.patches) ? payload.patches : [],
      ...(typeof payload.minGames === 'number' ? { minGames: payload.minGames } : {}),
      rows,
    },
    assets: spec.assets(bundle, rows),
    tierCutoffs: resolveCutoffs(tierCutoffsFile as TierCutoffsBundle, bundle.set),
    ...(spec.partial ? { partial: true } : {}),
    ...(hit?.builtAt ? { version: hit.builtAt } : {}),
  };
  cacheSet(key, value as StatsInitial<unknown>);
  return { filters, data: value };
}

// ---------- Units ----------

export interface UnitListRow {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  pickRate: number | null;
  topItems?: { item: string; games: number }[];
}

export function unitsStart<Row extends UnitListRow>(sp: URLSearchParams): Promise<StatsStart<Row>> {
  return loadStart<Row>({
    endpoint: 'units',
    field: 'units',
    // /api/tft/units sortiert gespeicherte Staende nach (route.ts, Snapshot-Pfad).
    prepare: rows => { sortUnitsRareLast(rows); return rows; },
    assets: (bundle, rows) => subsetBundle(bundle, {
      champions: rows.map(r => r.characterId),
      items: rows.flatMap(r => (r.topItems || []).map(i => i.item)),
      withAbility: false,
    }),
  }, sp);
}

// ---------- Items ----------

export interface ItemListRow {
  apiName: string;
  topUsers?: string[];
}

export function itemsStart<Row extends ItemListRow>(sp: URLSearchParams): Promise<StatsStart<Row>> {
  return loadStart<Row>({
    endpoint: 'items',
    field: 'items',
    // /api/tft/items liefert gespeicherte Staende unveraendert aus.
    assets: (bundle, rows) => subsetBundle(bundle, {
      items: rows.map(r => r.apiName),
      champions: rows.flatMap(r => (r.topUsers || []).slice(0, 8)),
      withAbility: false,
    }),
  }, sp);
}

// ---------- Traits ----------

export interface TraitListRow {
  name: string;
}

export function traitsStart<Row extends TraitListRow>(sp: URLSearchParams): Promise<StatsStart<Row>> {
  return loadStart<Row>({
    endpoint: 'traits',
    field: 'traits',
    // /api/tft/traits liefert gespeicherte Staende unveraendert aus.
    assets: (bundle, rows) => subsetBundle(bundle, {
      traitNames: rows.map(r => bundle.traits?.[r.name]?.name).filter((n): n is string => !!n),
    }),
  }, sp);
}

// ---------- Comps ----------

// Ohne Trendwerte (velocity) und Mitspiel-Anteil je Unit (cooccurrence): die
// Liste zeigt beides in der Standardansicht nicht. Trend-Filter und
// Trend-Sortierung laden die volle Liste (useTftCompsData).
function leanCompRow<Row extends CompApiRow>(row: Row): Row {
  const lean: CompApiRow = {
    ...row,
    typicalUnits: (row.typicalUnits || []).map(u => {
      const unit: typeof u & { cooccurrence?: unknown } = { ...u };
      delete unit.cooccurrence;
      return unit;
    }),
  };
  delete lean.velocity;
  return lean as Row;
}

export function compsStart<Row extends CompApiRow>(sp: URLSearchParams): Promise<StatsStart<Row>> {
  return loadStart<Row>({
    endpoint: 'comps',
    field: 'comps',
    // Erweitert-Filter und Trend-Sortierung rechnen auf der VOLLEN Liste —
    // aus den Zeilen der Standard-Familien kaeme ein anderes Ergebnis. Ein
    // Vergleich aus der Adresse (compareA) laedt sie sofort: Startdaten waeren
    // doppelt uebertragen.
    skip: sp.has('adv') || sp.get('sort') === 'velocity' || sp.has('compareA'),
    partial: true,
    // /api/tft/comps liefert den Stand unveraendert; davon nur die Zeilen der
    // 40 gezeigten Familien (gemessen 14.10.2026: 111 von 293, gleiche Anzeige
    // in 48 Filter-Kombinationen x 5 Sortierungen). shownFamilyRows prueft das
    // bei jedem Aufruf nach; weicht es ab, keine Startdaten.
    prepare: (rows, bundle) => {
      const shown = shownFamilyRows(rows, bundle);
      if (!shown) {
        console.warn('[seo] Comps-Startdaten: Teilmenge zeigt andere Familien als die volle Liste — ohne Startdaten');
        return null;
      }
      return shown.map(leanCompRow);
    },
    assets: (bundle, rows) => {
      const champions = new Set<string>();
      const items = new Set<string>();
      const traitIds = new Set<string>();
      for (const r of rows) {
        const p = parseClusterKey(r.slug || r.clusterKey);
        if (p) {
          traitIds.add(p.trait);
          champions.add(p.carry);
          if (p.secondary) champions.add(p.secondary);
        }
        for (const u of r.typicalUnits || []) {
          champions.add(u.characterId);
          for (const it of u.topItems || []) items.add(it.apiName);
        }
        for (const a of r.typicalAugments || []) items.add(a.apiName);
      }
      return subsetBundle(bundle, { champions, items, traitIds });
    },
  }, sp);
}

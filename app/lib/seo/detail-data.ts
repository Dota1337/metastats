import 'server-only';
// Startdaten der TFT-Detailseiten Unit, Item und Trait (SEO-Plan Schritt 5):
// Name, Zahlen und interne Links stehen gleich im ersten HTML, statt erst nach
// mehreren Abrufen im Browser.
//
// Gleiche Regeln wie initial-data.ts: nur vorgerechnete Staende (lookupSnapshot,
// Item-Bloecke aus dem Vorrat detail-builds), nie die Datenbank; Filter ueber
// resolveFilters wie die Routen; hoechstens 1,5 s; Notschalter SEO_START_DATA=0.
// Jeder Block (Hauptdatensatz, Comps, …) ist einzeln „bekannt“ oder null —
// null heisst: der Browser fragt diesen Block wie bisher selbst ab. Ein Block
// ist immer genau die Antwort der API (bei Listen: dieselben Zeilen, nur die
// Felder, die die Seite liest), sonst springen die Zahlen.
import { lookupSnapshot, type LookupHit } from '../snapshot-lookup';
import type { SnapshotEndpoint } from '../snapshot-matrix';
import { resolveFilters } from '../tft-supabase-reader';
import { normalizeBucket } from '../tft-stats-loader';
import { isExcludedItem, isExcludedUnit } from '../tft-excluded';
import { coreFromListRow, itemDetailBody, unitDetailBody } from '../tft-detail-payload';
import { lookupDetailBuildsStock } from '../tft-detail-builds';
import {
  compsOfTrait, compsWithItem, detailFiltersFrom, detailKey, sharedComponentItems,
  traitFiltersFrom, traitIdsForParam,
} from '../tft-detail-filters';
import { sortUnitsRareLast } from '../tft-list-sort';
import { parseClusterKey } from '../tft-cluster';
import { findArbiterOptions, findTraitItemPool } from '../tft-trait-desc';
import type { TftAssetsBundle } from '../tft-cdragon';
import { tftAssets } from '../og/data';
import { withTimeout } from '../og/frame';
import { subsetBundle } from './initial-data';
import { dataEndOf, familyRowsFor, leanCompRow, unitListFamilies, type CompApiRow } from '../tft-comp-families';

const BUDGET_MS = 1500;
// Vorgerechnete Staende je Filter, nicht je Seite: viele Detailseiten lesen
// denselben Stand (die Comps-Liste hat 1,85 MB). Wie das Manifest in
// snapshot-lookup.ts hoechstens 5 min alt.
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 8;

type Resolved = Awaited<ReturnType<typeof resolveFilters>>;
type Payload = Record<string, unknown>;

const snapCache = new Map<string, { ts: number; value: Promise<Payload | null> }>();

function snapshotPayload(endpoint: SnapshotEndpoint, r: Resolved): Promise<Payload | null> {
  const key = `${endpoint}|${r.patch}|${r.setNumber}|${r.regionLabel}|${r.requestedDays}|${r.bucketLabel}|${r.endDay}`;
  const hit = snapCache.get(key);
  if (hit && Date.now() - hit.ts <= CACHE_TTL_MS) return hit.value;
  // mg0 = der Stand, den die Routen zuerst nehmen (Comps: angepasste Schwelle
  // ohne ?minGames; Units/Items/Traits: immer mg0).
  const value = lookupSnapshot(endpoint, {
    patch: r.patch, region: r.regionLabel, days: r.requestedDays,
    bucket: r.bucketLabel, minGames: 0, setNumber: r.setNumber, endDay: r.endDay,
  }).then((h: LookupHit | null) => (h?.payload as Payload | undefined) ?? null, () => null);
  snapCache.delete(key);
  snapCache.set(key, { ts: Date.now(), value });
  while (snapCache.size > CACHE_MAX) snapCache.delete(snapCache.keys().next().value as string);
  // Fehlschlag nicht 5 min lang merken.
  value.then(v => { if (!v) snapCache.delete(key); });
  return value;
}

/** Zeilen eines Listen-Stands mit demselben Schutz wie die Routen (nie leer). */
function listRows(payload: Payload | null, field: string): Record<string, any>[] | null {
  const rows = payload?.[field];
  return payload?.hasData && Array.isArray(rows) && rows.length > 0 ? rows as Record<string, any>[] : null;
}

/** Restzeit des 1,5-s-Budgets (auch fuer comp-detail-data.ts). */
export function deadline() {
  const end = Date.now() + BUDGET_MS;
  return () => Math.max(0, end - Date.now());
}

export async function resolveFor(params: Record<string, string>, left: () => number): Promise<Resolved | null> {
  if (process.env.SEO_START_DATA === '0') return null;
  const r = await withTimeout(resolveFilters(new URLSearchParams(params)), left());
  // Ein ausdruecklich gewaehlter Patch rechnet live — kommt hier nicht vor
  // (die Seiten fragen ohne ?patch), aber dann lieber keine Startdaten.
  return r && r.patchFilter == null ? r : null;
}

function unitIdsOfComp(clusterKey: string | undefined): { trait?: string; champions: string[] } {
  const p = parseClusterKey(clusterKey || '');
  return p ? { trait: p.trait, champions: [p.carry, ...(p.secondary ? [p.secondary] : [])] } : { champions: [] };
}

// ---------- Unit ----------

export interface CompRef {
  slug: string;
  clusterKey: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
}

export interface UnitDetailInitial {
  key: string;
  /** Antwort von /api/tft/units?id=… */
  detail: { hasData?: boolean; unit?: unknown } | null;
  /** Zeilen von /api/tft/comps, die die Comps-Familien mit dieser Unit bilden
   *  (unitListFamilies), schlank wie in der Liste; dataEnd wie die Antwort. */
  comps: { rows: CompApiRow[]; dataEnd: string | null } | null;
  assets: TftAssetsBundle;
}

export async function unitDetailStart(id: string, sp: URLSearchParams): Promise<UnitDetailInitial | null> {
  const bundle = tftAssets();
  if (!bundle || isExcludedUnit(id)) return null;
  const f = detailFiltersFrom(sp);
  const left = deadline();
  const r = await resolveFor({ region: f.region, bucket: f.bucket, days: String(f.days) }, left);
  if (!r) return null;
  const [unitsSnap, compsSnap, stock] = await Promise.all([
    withTimeout(snapshotPayload('units', r), left()),
    withTimeout(snapshotPayload('comps', r), left()),
    withTimeout(lookupDetailBuildsStock(r), left()),
  ]);

  let detail: UnitDetailInitial['detail'] = null;
  const unitRows = listRows(unitsSnap, 'units');
  if (unitRows) {
    // Item-Bloecke nur aus dem Vorrat der Standardansicht; ohne ihn laedt der
    // Browser sie nach (itemsPending).
    detail = unitDetailBody({
      id, region: f.region.toLowerCase(), bucket: normalizeBucket(f.bucket),
      core: coreFromListRow(unitRows.find(x => x.characterId === id)), coreKnown: true,
      filterSet: r.setNumber, filterPatch: r.patch,
    }, stock ? (stock.units[id] ?? null) : 'pending').body;
  }
  const compRows = listRows(compsSnap, 'comps') as CompApiRow[] | null;
  const famRows = compRows ? familyRowsFor(compRows, list => unitListFamilies(list, bundle, id), leanCompRow) : null;
  const comps = famRows ? { rows: famRows, dataEnd: dataEndOf(compsSnap?.filters) } : null;
  if (!detail && !comps) return null;

  const unit = (detail?.unit ?? null) as Record<string, any> | null;
  const items = new Set<string>();
  const champions = new Set<string>([id]);
  const traitIds = new Set<string>();
  if (unit) {
    for (const it of unit.topItems || []) items.add(it.item);
    for (const s of unit.topItemSets || []) for (const it of s.items || []) items.add(it);
    for (const arr of Object.values(unit.topItemsByTier || {}) as any[]) for (const it of arr || []) items.add(it.item);
    for (const arr of Object.values(unit.topItemSetsByTier || {}) as any[]) for (const s of arr || []) for (const it of s.items || []) items.add(it);
    for (const slots of Object.values(unit.itemSlotsByTier || {}) as any[]) {
      for (const slot of Object.values(slots || {}) as any[]) for (const e of slot?.entries || []) items.add(e.item);
    }
  }
  // Die Comp-Zeilen zeigen Units, ihre Items, Embleme und den Familien-Trait.
  for (const c of comps?.rows || []) {
    const p = unitIdsOfComp(c.clusterKey);
    if (p.trait) traitIds.add(p.trait);
    for (const ch of p.champions) champions.add(ch);
    for (const u of c.typicalUnits || []) {
      champions.add(u.characterId);
      for (const it of u.topItems || []) items.add(it.apiName);
    }
  }
  return {
    key: detailKey(id, f),
    detail,
    comps,
    assets: subsetBundle(bundle, {
      champions, items, traitIds,
      // Die Kopfzeile nennt die Traits ueber den Anzeigenamen (champion.traits).
      traitNames: bundle.champions?.[id]?.traits || [],
      withAbility: false,
    }),
  };
}

// ---------- Item ----------

function compRef(c: Record<string, any>): CompRef {
  return { slug: c.slug, clusterKey: c.clusterKey, games: c.games, avgPlacement: c.avgPlacement, top4Rate: c.top4Rate };
}

export interface ItemCompRef extends CompRef {
  carryItems: { items: string[]; count: number }[];
}

export interface ItemDetailInitial {
  key: string;
  detail: { hasData?: boolean; item?: unknown } | null;
  /** ALLE Comps, deren Carry-Items das Item enthalten (die Seite rechnet daraus Combos). */
  comps: ItemCompRef[] | null;
  assets: TftAssetsBundle;
}

export async function itemDetailStart(id: string, sp: URLSearchParams): Promise<ItemDetailInitial | null> {
  const bundle = tftAssets();
  if (!bundle || isExcludedItem(id)) return null;
  const f = detailFiltersFrom(sp);
  const left = deadline();
  const r = await resolveFor({ region: f.region, bucket: f.bucket, days: String(f.days) }, left);
  if (!r) return null;
  const [itemsSnap, compsSnap, stock] = await Promise.all([
    withTimeout(snapshotPayload('items', r), left()),
    withTimeout(snapshotPayload('comps', r), left()),
    withTimeout(lookupDetailBuildsStock(r), left()),
  ]);

  let detail: ItemDetailInitial['detail'] = null;
  const itemRows = listRows(itemsSnap, 'items');
  if (itemRows) {
    detail = itemDetailBody({
      id, region: f.region.toLowerCase(), bucket: normalizeBucket(f.bucket),
      core: coreFromListRow(itemRows.find(x => x.apiName === id)), coreKnown: true,
      filterSet: r.setNumber, filterPatch: r.patch,
    }, stock ? (stock.items[id] ?? null) : 'pending').body;
  }
  const compRows = listRows(compsSnap, 'comps');
  const comps = compRows
    ? compsWithItem(compRows, id).map(c => ({
        ...compRef(c),
        carryItems: (c.carryItems || []).map((ci: { items?: string[]; count: number }) => ({ items: ci.items || [], count: ci.count })),
      }))
    : null;
  if (!detail && !comps) return null;

  const items = new Set<string>([id]);
  const champions = new Set<string>();
  const traitIds = new Set<string>();
  const meta = bundle.items?.[id];
  const composition = meta?.composition || [];
  for (const c of composition) items.add(c);
  for (const [k] of sharedComponentItems(bundle.items || {}, bundle.active?.items, id, composition)) items.add(k);
  const item = (detail?.item ?? null) as Record<string, any> | null;
  for (const u of item?.topUsers || []) champions.add(u.characterId);
  for (const c of (comps || []).slice(0, 6)) {
    const p = unitIdsOfComp(c.clusterKey);
    if (p.trait) traitIds.add(p.trait);
    for (const ch of p.champions) champions.add(ch);
  }
  for (const c of comps || []) for (const ci of c.carryItems) for (const it of ci.items) items.add(it);
  return {
    key: detailKey(id, f),
    detail,
    comps,
    assets: subsetBundle(bundle, { champions, items, traitIds, withAbility: false, activeItems: true }),
  };
}

// ---------- Trait (E4) ----------

export interface TraitDetailInitial {
  key: string;
  /** Zeilen von /api/tft/traits zu diesen Kennungen. */
  traits: Record<string, unknown>[] | null;
  /** Zeilen von /api/tft/units der Units mit diesem Trait (Reihenfolge der API). */
  units: Record<string, unknown>[] | null;
  /** Die ersten 6 Comps dieses Traits aus /api/tft/comps (exakter Treffer). */
  comps: CompRef[] | null;
  assets: TftAssetsBundle;
}

export async function traitDetailStart(param: string, sp: URLSearchParams): Promise<TraitDetailInitial | null> {
  const bundle = tftAssets();
  if (!bundle) return null;
  const { ids, display } = traitIdsForParam(bundle.traits, param);
  if (!ids.some(k => bundle.traits?.[k])) return null;
  const f = traitFiltersFrom(sp);
  const left = deadline();
  // Die Seite fragt Traits/Units ohne ?days (Standard 3) und Comps mit days=3.
  const r = await resolveFor({ region: f.region, bucket: f.bucket }, left);
  if (!r) return null;
  const [traitsSnap, unitsSnap, compsSnap] = await Promise.all([
    withTimeout(snapshotPayload('traits', r), left()),
    withTimeout(snapshotPayload('units', r), left()),
    withTimeout(snapshotPayload('comps', r), left()),
  ]);
  const idSet = new Set(ids);
  const match = new Set([...ids, display]);

  const traitRows = listRows(traitsSnap, 'traits');
  const traits = traitRows ? traitRows.filter(t => idSet.has(t.name)) : null;
  const unitRowsRaw = listRows(unitsSnap, 'units');
  let units: Record<string, unknown>[] | null = null;
  if (unitRowsRaw) {
    // /api/tft/units sortiert gespeicherte Staende nach (units/route.ts).
    const sorted = [...unitRowsRaw];
    sortUnitsRareLast(sorted);
    units = sorted
      .filter(u => (bundle.champions?.[u.characterId]?.traits || []).some(tr => match.has(tr)))
      .map(u => ({ characterId: u.characterId, games: u.games, avgPlacement: u.avgPlacement, top4Rate: u.top4Rate }));
  }
  const compRows = listRows(compsSnap, 'comps');
  const comps = compRows ? compsOfTrait(compRows, ids).map(compRef) : null;
  if (!traits && !units && !comps) return null;

  const champions = new Set<string>((units || []).map(u => String(u.characterId)));
  for (const c of comps || []) for (const ch of unitIdsOfComp(c.clusterKey).champions) champions.add(ch);
  // Items fuer „moegliche Items“ und den Arbiter-Block: dieselben Funktionen
  // wie die Seite, je Kennung des Anzeigenamens.
  const items = new Set<string>();
  for (const k of ids) for (const e of findTraitItemPool(k, bundle.items)) items.add(e.apiName);
  if (display === 'Arbiter') {
    const { causes, effects } = findArbiterOptions(bundle.items, null);
    for (const e of [...causes, ...effects]) items.add(e.apiName);
  }
  return {
    key: detailKey(param, f),
    traits, units, comps,
    // Alle Kennungen des Anzeigenamens (Kopfzeile, Varianten, Stufen).
    assets: subsetBundle(bundle, { champions, traitNames: [display], traitIds: ids, items, withAbility: false }),
  };
}

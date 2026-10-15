// Item-Bloecke der Unit- und Item-Detailseite aus der Datenbank (0096, F2-D).
// EIN Lader fuer die Detail-Routen (/api/tft/units?id=, /api/tft/items?id=),
// die Vorrats-Route /api/tft/detail-builds und die Startdaten der Seiten
// (seo/detail-data.ts) — sonst zeigen Seite und API verschiedene Zahlen.
//
// Vorrat (User 15.10.2026, „Standardansicht sofort"): der Publisher legt fuer
// die Standardansicht (alle Regionen, 3 Tage, Master+) EINEN Stand mit allen
// Units und Items ab (Matrix-Endpunkt `detail-builds`). Andere Filter rechnen
// live je id.
import { callRpc, rpcWindowArgs, type ResolvedFilters } from './tft-supabase-reader';
import { lookupSnapshot } from './snapshot-lookup';
import type { CarrierRow, UnitBuildsRaw } from './tft-detail-payload';

export interface DetailBuildsStock {
  hasData: boolean;
  filters: Record<string, unknown>;
  units: Record<string, UnitBuildsRaw>;
  items: Record<string, CarrierRow[]>;
}

type Filters = Pick<ResolvedFilters,
  'regions' | 'buckets' | 'days' | 'startDay' | 'endDay' | 'patch' | 'patchFilter' | 'setNumber' | 'regionLabel' | 'bucketLabel' | 'requestedDays'>;

function rpcArgs(f: Filters) {
  return { p_regions: f.regions, p_buckets: f.buckets, ...rpcWindowArgs(f), p_patch: f.patchFilter, p_set: f.setNumber };
}

/** Summen je Unit; `ids` null = alle Units im Fenster. Wirft bei DB-Fehler. */
export async function loadUnitBuilds(f: Filters, ids: string[] | null): Promise<Record<string, UnitBuildsRaw>> {
  const rows = await callRpc<{ character_id: string; builds: UnitBuildsRaw }[]>(
    'get_tft_unit_builds', { p_character_ids: ids, ...rpcArgs(f) });
  return Object.fromEntries(rows.map(r => [r.character_id, r.builds]));
}

/** Traeger je Item; `ids` null = alle Items im Fenster. Wirft bei DB-Fehler. */
export async function loadItemCarriers(f: Filters, ids: string[] | null): Promise<Record<string, CarrierRow[]>> {
  const rows = await callRpc<{ api_name: string; carriers: CarrierRow[] }[]>(
    'get_tft_item_carriers', { p_api_names: ids, ...rpcArgs(f) });
  return Object.fromEntries(rows.map(r => [r.api_name, r.carriers]));
}

// Der Vorrat ist ein Stand fuer alle Detailseiten — einmal je Instanz holen,
// hoechstens 5 min alt (wie das Manifest in snapshot-lookup.ts).
const STOCK_TTL_MS = 5 * 60 * 1000;
const stockCache = new Map<string, { ts: number; value: Promise<DetailBuildsStock | null> }>();

/** Vorrat fuer diese Filter oder null (andere Filter, gewaehlter Patch, kein Stand). */
export function lookupDetailBuildsStock(f: Filters): Promise<DetailBuildsStock | null> {
  if (f.patchFilter != null) return Promise.resolve(null);
  const key = `${f.patch}|${f.setNumber}|${f.regionLabel}|${f.requestedDays}|${f.bucketLabel}|${f.endDay}`;
  const hit = stockCache.get(key);
  if (hit && Date.now() - hit.ts <= STOCK_TTL_MS) return hit.value;
  const value = lookupSnapshot('detail-builds', {
    patch: f.patch, region: f.regionLabel, days: f.requestedDays, bucket: f.bucketLabel,
    minGames: 0, setNumber: f.setNumber, endDay: f.endDay,
  }).then(h => {
    const p = h?.payload as DetailBuildsStock | undefined;
    return p?.hasData && p.units && p.items ? p : null;
  }, () => null);
  stockCache.set(key, { ts: Date.now(), value });
  while (stockCache.size > 8) stockCache.delete(stockCache.keys().next().value as string);
  // Kein Stand wird nicht 5 min lang gemerkt — der Publisher kann ihn gleich ablegen.
  value.then(v => { if (!v) stockCache.delete(key); });
  return value;
}

/** Item-Bloecke einer Unit: Vorrat, sonst live. null = keine Daten. Wirft bei DB-Fehler. */
export async function unitBuildsFor(f: Filters, id: string): Promise<UnitBuildsRaw | null> {
  const stock = await lookupDetailBuildsStock(f);
  if (stock) return stock.units[id] ?? null;
  return (await loadUnitBuilds(f, [id]))[id] ?? null;
}

/** Traeger eines Items: Vorrat, sonst live. null = keine Daten. Wirft bei DB-Fehler. */
export async function itemCarriersFor(f: Filters, id: string): Promise<CarrierRow[] | null> {
  const stock = await lookupDetailBuildsStock(f);
  if (stock) return stock.items[id] ?? null;
  return (await loadItemCarriers(f, [id]))[id] ?? null;
}

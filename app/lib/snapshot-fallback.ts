// Notreserve fuer die Stats-Routen: scheitert die Live-Abfrage (naechtliche
// Vollauslastung der Datenbank, 8-s-Abbruch), liefert die Route den letzten
// gespeicherten Stand derselben Filter statt einer leeren Seite.
//
// Regeln (Plan 2026-10-02):
// - nie fuer den Publisher — sonst schriebe er alte Zahlen als neuen Stand
//   in die Snapshots; der Aufrufer prueft das vor dem Aufruf
// - nur gleicher Patch, gleiche Region, gleicher Zeitraum, gleicher Rang
//   (lookupSnapshot prueft zusaetzlich Patch, Set und Patch-Filter)
// - kurz gecacht (DEGRADED_CACHE_CONTROL), damit nach Erholung sofort wieder
//   frische Zahlen kommen; erkennbar am Header FALLBACK_HEADER
// - Netz (24.10.2026): ohne Patch-Filter und ohne Stand unter dem Patch der
//   Anfrage den Stand unter dem Patch des Manifests — nach einem Patchwechsel,
//   wenn der Daten-Pin nicht greift (Manifest > 50 h alt). Eigener Tag.
import { lookupSnapshot, type LookupOptions } from './snapshot-lookup';
import type { SnapshotEndpoint } from './snapshot-matrix';

export const FALLBACK_HEADER = 'x-metastats-fallback';

export interface FallbackFilters {
  patch: string | null;
  regionLabel: string;
  requestedDays: number;
  bucketLabel: string;
  setNumber: number | null;
  patchFilter?: string | null;
  patchFilterNoop?: boolean;
}

export async function lookupFallbackSnapshot(
  endpoint: SnapshotEndpoint,
  listField: string,
  filters: FallbackFilters,
  lookup: typeof lookupSnapshot = lookupSnapshot,
): Promise<{ payload: Record<string, unknown>; tag: string } | null> {
  const usable = (hit: Awaited<ReturnType<typeof lookupSnapshot>>) => {
    const payload = hit?.payload as Record<string, unknown> | undefined;
    const list = payload?.[listField];
    return hit && payload?.hasData && Array.isArray(list) && list.length > 0 ? payload : null;
  };
  try {
    const opts: LookupOptions = {
      patch: filters.patch,
      region: filters.regionLabel,
      days: filters.requestedDays,
      bucket: filters.bucketLabel,
      minGames: 0,
      setNumber: filters.setNumber,
      patchFilter: filters.patchFilter,
      patchFilterNoop: filters.patchFilterNoop,
    };
    const hit = await lookup(endpoint, opts);
    const payload = usable(hit);
    if (hit && payload) return { payload, tag: `snapshot:${hit.tag}` };
    if (filters.patchFilter != null || filters.patch == null) return null;
    // patch: null → lookupSnapshot nimmt manifest.patches.current.
    const net = await lookup(endpoint, { ...opts, patch: null });
    const netPayload = usable(net);
    return net && netPayload ? { payload: netPayload, tag: `snapshot-manifest:${net.tag}` } : null;
  } catch {
    return null;
  }
}

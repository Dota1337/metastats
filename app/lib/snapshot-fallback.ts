// Notreserve fuer die Stats-Routen: scheitert die Live-Abfrage (naechtliche
// Vollauslastung der Datenbank, 8-s-Abbruch), liefert die Route den letzten
// gespeicherten Stand derselben Filter statt einer leeren Seite.
//
// Regeln (Plan 2026-10-02):
// - nie fuer den Publisher — sonst schriebe er alte Zahlen als neuen Stand
//   in die Snapshots; der Aufrufer prueft das vor dem Aufruf
// - nur gleicher Patch, gleiche Region, gleicher Zeitraum, gleicher Rang
//   (lookupSnapshot prueft zusaetzlich Patch und Set)
// - kurz gecacht (DEGRADED_CACHE_CONTROL), damit nach Erholung sofort wieder
//   frische Zahlen kommen; erkennbar am Header FALLBACK_HEADER
import { lookupSnapshot } from './snapshot-lookup';
import type { SnapshotEndpoint } from './snapshot-matrix';

export const FALLBACK_HEADER = 'x-metastats-fallback';

export interface FallbackFilters {
  patch: string | null;
  regionLabel: string;
  requestedDays: number;
  bucketLabel: string;
  setNumber: number | null;
}

export async function lookupFallbackSnapshot(
  endpoint: SnapshotEndpoint,
  listField: string,
  filters: FallbackFilters,
): Promise<{ payload: Record<string, unknown>; tag: string } | null> {
  try {
    const hit = await lookupSnapshot(endpoint, {
      patch: filters.patch,
      region: filters.regionLabel,
      days: filters.requestedDays,
      bucket: filters.bucketLabel,
      minGames: 0,
      setNumber: filters.setNumber,
    });
    const payload = hit?.payload as Record<string, unknown> | undefined;
    const list = payload?.[listField];
    if (!hit || !payload?.hasData || !Array.isArray(list) || list.length === 0) return null;
    return { payload, tag: `snapshot:${hit.tag}` };
  } catch {
    return null;
  }
}

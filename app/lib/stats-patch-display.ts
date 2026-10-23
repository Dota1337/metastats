// Uebergangszeit nach einem Patchwechsel (User 24.10.2026): die Seite nennt
// schon den neuen Patch, die Zahlen bleiben beim letzten fertigen Stand, bis der
// Publisher abends den neuen ablegt. resolveFilters trennt dafuer `patch`
// (Daten-Patch: Vorrats-Schluessel, Fenster) und `displayPatch` (Beschriftung).
// Gemeinsame Helfer der Statistik-Routen und der Startdaten der Seiten.
import { STATS_CACHE_CONTROL_FRESH } from './api-cache';
import type { LookupOptions } from './snapshot-lookup';
import { inPatchTransition, type PatchInfo, type ResolvedFilters } from './tft-supabase-reader';

type DisplayFilters = Pick<ResolvedFilters, 'patch' | 'displayPatch' | 'patchStartDay'>;

/**
 * Vorrats-Felder einer aufgeloesten Anfrage: Daten-Patch als Schluessel, Endtag
 * fuer den Fenster-Waechter, Patch-Filter fuer den Alias-Waechter.
 */
export function snapshotFilterOpts(f: ResolvedFilters): Omit<LookupOptions, 'minGames'> {
  return {
    patch: f.patch,
    region: f.regionLabel,
    days: f.requestedDays,
    bucket: f.bucketLabel,
    setNumber: f.setNumber,
    endDay: f.endDay,
    patchFilter: f.patchFilter,
    patchFilterNoop: f.patchFilterNoop,
  };
}

/**
 * Antwort fuer den Besucher: die Patchliste der DB statt der beim Ablegen
 * gespeicherten (die Seite nennt den Patch nach patches[0]) und in der
 * Uebergangszeit der angezeigte Patch in filters.patch. Leere Liste (DB weg)
 * → gespeicherte bleibt.
 */
export function withDisplayPatch<T>(payload: T, f: DisplayFilters, patches: readonly PatchInfo[]): T {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const p = payload as Record<string, unknown>;
  const out: Record<string, unknown> = { ...p };
  if (patches.length > 0 && 'patches' in p) out.patches = patches;
  if (inPatchTransition(f) && p.filters && typeof p.filters === 'object') {
    out.filters = { ...(p.filters as Record<string, unknown>), patch: f.displayPatch, patchStartDay: f.patchStartDay };
  }
  return out as T;
}

/**
 * Edge-Cache in der Uebergangszeit kurz (5 min statt 6 h): sonst hielte die
 * Edge die alten Zahlen noch Stunden, nachdem der neue Stand abends da ist.
 */
export function transitionCacheControl(cache: string, f: Pick<ResolvedFilters, 'patch' | 'displayPatch'>): string {
  return inPatchTransition(f) ? STATS_CACHE_CONTROL_FRESH : cache;
}

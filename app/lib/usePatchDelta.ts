'use client';
// Δ-Vergleich „vs Vorpatch" der Statistik-Listen im Browser (tft-patch-delta.ts).
// Eigene Abfrage neben der Liste: die Liste bleibt im Vorrat und steht sofort,
// die Vergleichs-Spalte fuellt sich danach (Box-Dateien, ~0,2 s).
//
//   - Gemerkt wird je Adresse, seitenuebergreifend (Liste ↔ Uebersicht, Zurueck
//     auf einen frueheren Filter): kein zweiter Abruf.
//   - Startdaten der Server-Seite (`initial`, nur die gezeigten Familien) gelten
//     nur fuer diese eine Ansicht und kommen nicht in den gemeinsamen Speicher —
//     sonst fehlten der Liste mit Suche die uebrigen Comps.
//   - Ohne Zahlen (Datei der Box fehlt noch, Fehler, Zeitlimit) zeigen die
//     Zellen „—"; nichts wird geschaetzt.
import { useEffect, useMemo, useState } from 'react';
import {
  buildPatchDeltaIndex,
  patchDeltaPair,
  patchDeltaQuery,
  type PatchDeltaEntity,
  type PatchDeltaIndex,
  type PatchDeltaPair,
  type PatchDeltaResponse,
  type PatchDeltaStart,
} from './tft-patch-delta';
import type { Filters, PatchInfo } from './tft-filters';

const FETCH_TIMEOUT_MS = 15_000;
const CACHE_MAX = 12;
const cache = new Map<string, PatchDeltaResponse>();

function remember(url: string, res: PatchDeltaResponse) {
  cache.delete(url);
  cache.set(url, res);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

export function usePatchDelta({ entity, filters, patches, dataEnd = null, prevOnly = false, enabled, initial = null }: {
  entity: PatchDeltaEntity;
  filters: Filters;
  /** Patch-Liste der Listen-Antwort (neuester zuerst). */
  patches: readonly PatchInfo[];
  /** Letzter voller Tag der Listen-Antwort (filters.dataEnd). */
  dataEnd?: string | null;
  /** Uebersicht der Comps: immer „vs Vorpatch", das Ziel der Filter zaehlt nicht. */
  prevOnly?: boolean;
  /** Spalte bzw. Pfeile sichtbar — sonst kein Abruf. */
  enabled: boolean;
  initial?: PatchDeltaStart | null;
}): { pair: PatchDeltaPair | null; index: PatchDeltaIndex | null; loading: boolean } {
  const pair = useMemo(
    () => patchDeltaPair(patches, filters.patch, { dataEnd, vs: filters.deltaVs, prevOnly }),
    [patches, filters.patch, filters.deltaVs, dataEnd, prevOnly],
  );
  const url = enabled && pair ? patchDeltaQuery(entity, filters.bucket, filters.region, pair) : null;
  // Letzte eigene Antwort; null = abgerufen, aber ohne Zahlen.
  const [fetched, setFetched] = useState<{ url: string; res: PatchDeltaResponse | null } | null>(null);

  const res: PatchDeltaResponse | null | undefined = !url ? undefined
    : fetched?.url === url ? fetched.res
    : cache.get(url) ?? (initial?.url === url ? initial.res : undefined);

  useEffect(() => {
    if (!url || cache.has(url) || initial?.url === url) return;
    let cancelled = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    fetch(url, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((d: PatchDeltaResponse | null) => {
        if (cancelled) return;
        if (d?.hasData) remember(url, d);
        setFetched({ url, res: d?.hasData ? d : null });
      })
      .catch(() => { if (!cancelled) setFetched({ url, res: null }); })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctl.abort(); };
  }, [url, initial?.url]);

  const index = useMemo(
    () => (pair && res ? buildPatchDeltaIndex(entity, pair, res) : null),
    [entity, pair, res],
  );
  return { pair, index, loading: !!url && res === undefined };
}

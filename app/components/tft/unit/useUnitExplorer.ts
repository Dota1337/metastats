'use client';
// Daten der Build- und Item-Tabellen der Unit-Detailseite aus dem Data
// Explorer (Plan 19.10.2026, Variante A1): dieselben Zahlen wie im Explorer,
// ueber dieselbe Adresse (serializeExplorerQuery, forApi) — damit trifft die
// Seite den Cache von Vercel und das Vorwaermen des Dienstes.
//
// Drei Abfragen NACHEINANDER (der Dienst rechnet auf einer Spur): Sterne
// (Verteilung + neuester Patch), Items, Builds. Ein Filterwechsel holt nur,
// was sich aendert; schon geladene Antworten bleiben im Speicher der Seite.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_QUERY, LATEST_PATCH, legacyBucketToRanks, serializeExplorerQuery,
  type ExplorerQuery, type ExplorerResponse, type UnitFilter,
} from '../../../lib/tft-explorer-query';
import type { ExplorerError } from '../../../lib/useTftExplorer';

export interface UnitExplorerFilters {
  /** null = neuester Patch. */
  patch: string | null;
  star: number | null;
  /** Items an der Unit (genau); null = egal. */
  itemCount: number | null;
}

export interface UnitExplorerState {
  stars: ExplorerResponse | null;
  items: ExplorerResponse | null;
  builds: ExplorerResponse | null;
  /** Patch, den "neuester" gerade bedeutet (aus der Antwort). */
  latestPatch: string | null;
  loading: boolean;
  error: ExplorerError | null;
  retry: () => void;
}

export function unitBaseQuery(region: string, bucket: string, patch: string | null): ExplorerQuery {
  const r = (region || '').toLowerCase();
  return {
    ...EMPTY_QUERY,
    region: r && r !== 'all' ? r : 'all',
    ranks: legacyBucketToRanks(bucket),
    patches: [patch || LATEST_PATCH],
  };
}

export function unitFilterOf(id: string, f: Pick<UnitExplorerFilters, 'star' | 'itemCount'>, items?: string[]): UnitFilter {
  return {
    id,
    ...(f.star ? { s: f.star, sx: f.star } : {}),
    ...(f.itemCount ? { n: f.itemCount, nx: f.itemCount } : {}),
    ...(items?.length ? { it: items } : {}),
  };
}

const cache = new Map<string, Promise<ExplorerResponse>>();

function fetchExplorer(q: ExplorerQuery): Promise<ExplorerResponse> {
  const qs = serializeExplorerQuery(q, { forApi: true });
  let p = cache.get(qs);
  if (!p) {
    p = fetch(`/api/tft/explorer?${qs}`).then(async r => {
      const body = await r.json().catch(() => null);
      if (!r.ok || !body) {
        const code: ExplorerError = r.status === 504 ? 'timeout'
          : body?.error === 'busy' ? 'busy'
          : body?.error === 'not_ready' ? 'notReady'
          : r.status === 503 ? 'unavailable' : 'failed';
        throw Object.assign(new Error(code), { code });
      }
      return body as ExplorerResponse;
    });
    // Fehlschlaege nicht merken, sonst bliebe "Erneut versuchen" wirkungslos.
    p.catch(() => cache.delete(qs));
    cache.set(qs, p);
  }
  return p;
}

export function useUnitExplorer(unitId: string, region: string, bucket: string, f: UnitExplorerFilters): UnitExplorerState {
  const [stars, setStars] = useState<ExplorerResponse | null>(null);
  const [items, setItems] = useState<ExplorerResponse | null>(null);
  const [builds, setBuilds] = useState<ExplorerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ExplorerError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef<string | null>(null);

  const queries = useMemo(() => {
    // Gewaehlter Patch = neuester → dieselbe Adresse wie ohne Wahl (ein Cache-Eintrag).
    const patch = f.patch && f.patch !== latest.current ? f.patch : null;
    const base = unitBaseQuery(region, bucket, patch);
    const unit = unitFilterOf(unitId, f);
    return {
      stars: { ...base, units: [{ id: unitId }], tab: 'units', stars: [1, 2, 3] } as ExplorerQuery,
      items: { ...base, units: [unit], tab: 'items', focus: unitId } as ExplorerQuery,
      builds: { ...base, units: [unit], tab: 'builds', focus: unitId } as ExplorerQuery,
    };
  }, [unitId, region, bucket, f.patch, f.star, f.itemCount]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const s = await fetchExplorer(queries.stars);
        if (!alive) return;
        latest.current = s.query?.patches?.[0] ?? latest.current;
        setStars(s);
        const it = await fetchExplorer(queries.items);
        if (!alive) return;
        setItems(it);
        const b = await fetchExplorer(queries.builds);
        if (!alive) return;
        setBuilds(b);
        setLoading(false);
      } catch (err) {
        if (!alive) return;
        setError(((err as { code?: ExplorerError })?.code) || 'failed');
        setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [queries, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);
  return { stars, items, builds, latestPatch: latest.current, loading, error, retry };
}

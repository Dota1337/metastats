'use client';
// Filter, Abruf und URL-Abgleich der Comp-Seiten. Liste (/tft/comps) und
// Uebersicht (/tft/comps/atlas) teilen sich das, damit beide dieselben Comps
// mit denselben Filtern zeigen — 1:1 aus app/tft/comps/page.tsx (2026-09-27).
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  loadInitialFilters,
  adoptServerBucket,
  persistFilters,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../components/tft/StatsFilterBar';
import { loadTftAssets, type TftAssetsBundle } from './tft-cdragon';
import { loadTierCutoffs, type TierCutoffs } from './tft-tier-letter';
import {
  advFromUrlParam,
  advToUrlParam,
  applyAdvancedFilters,
  type AdvancedFilters,
} from '../components/tft/AdvancedCompFilters';
import { buildCompFamilies, currentSetFamilies, topFamilyKeys, type CompApiRow, type CompSortBy } from './tft-comp-families';

export function useTftCompsData() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // useState-Init läuft im SSR-Pass ohne window → loadInitialFilters fällt dort
  // auf URL-only zurück. Damit localStorage NICHT durch den ersten useEffect-
  // Tick mit Defaults überschrieben wird, gibt es einen separaten Init-Effekt
  // unten der nach Client-Mount setFilters() aus localStorage holt — UND ein
  // `hydrated`-Gate, damit der persist-Pfad erst nach diesem Init feuert.
  const [filters, setFilters] = useState<Filters>(() =>
    loadInitialFilters(new URLSearchParams(searchParams.toString())),
  );
  const [hydrated, setHydrated] = useState(false);
  const [adv, setAdv] = useState<AdvancedFilters>(() =>
    advFromUrlParam(searchParams.get('adv')),
  );
  const [sortBy, setSortBy] = useState<CompSortBy>(
    (searchParams.get('sort') as CompSortBy | null) || 'avg',
  );
  // Whether the user manually picked a sort. As long as they haven't, toggling
  // the Δ-filter automatically promotes "Trending" so the column they just
  // enabled actually drives the order — otherwise the new column would render
  // but the rows would stay sorted by avg-placement, which made the feature
  // look broken in earlier sessions.
  const [sortTouched, setSortTouched] = useState<boolean>(() => searchParams.has('sort'));
  const [comps, setComps] = useState<CompApiRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [minGames, setMinGames] = useState<number | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  // Abruf endgueltig gescheitert (nach den Wiederholungen). Bis 2026-10-02 sah
  // ein 502 hier aus wie „keine Comps" — r.ok wurde nie geprueft.
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tierCutoffs, setTierCutoffs] = useState<TierCutoffs | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadTierCutoffs(assets?.set ?? null).then(setTierCutoffs); }, [assets?.set]);

  // Init-Effekt: läuft EINMAL nach Client-Mount. Wenn die URL keine Filter
  // mitbringt, ziehe sie aus localStorage. Erst danach öffnen wir das
  // hydrated-Gate, damit der Haupt-Effekt unten persistieren darf.
  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return; }
    const params = new URLSearchParams(window.location.search);
    const hasUrlFilters = ['patch', 'bucket', 'days', 'region', 'velocity']
      .some(k => params.has(k));
    if (!hasUrlFilters) {
      const stored = loadInitialFilters(params);
      setFilters(stored);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Abbruch im Cleanup: /api/tft/comps liefert bis zu 841 KB und geht bei
    // einem Snapshot-Miss auf die RPC. Zwei schnelle Filter-Wechsel können
    // deshalb out-of-order eintreffen — die alte Liste würde die neue
    // überschreiben, während die Filter-Chips schon das neue Set zeigen.
    const ctl = new AbortController();
    const { signal } = ctl;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLoading(true);
    const qs = filtersToQueryString(filters);
    // Bis zu 3 Versuche, aber nur bei Server- oder Netzfehler (5xx, kein
    // Netz) und nur im sichtbaren Tab; ein 4xx ist endgueltig. Die Streuung
    // verhindert, dass viele Besucher nach einem Aussetzer gleichzeitig
    // nachfragen.
    const attempt = (n: number) => {
      fetch(`/api/tft/comps?${qs}&source=data`, { signal })
        .then(r => {
          if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { retryable: r.status >= 500 });
          return r.json();
        })
        .then(d => {
          if (signal.aborted) return;
          // Rang, den der Server tatsaechlich benutzt hat, in den Filter spiegeln
          // (nur solange der User keinen eigenen gewaehlt hat).
          adoptServerBucket(d.filters?.bucket, filters, setFilters);
          setError(false);
          setHasData(!!d.hasData);
          setComps(d.comps || []);
          setPatches(d.patches || []);
          setMinGames(typeof d.minGames === 'number' ? d.minGames : null);
          setLoading(false);
        })
        .catch((e: { retryable?: boolean }) => {
          if (signal.aborted) return;
          const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
          if (e?.retryable !== false && n < 3 && visible) {
            timer = setTimeout(() => attempt(n + 1), 1000 * n + Math.random() * 1000);
            return;
          }
          // Keine leere Liste vortaeuschen: die Seite zeigt den Fehlerkasten.
          setError(true); setLoading(false);
        });
    };
    attempt(1);
    // Persist NUR nach Hydration — sonst überschreibt der erste Effekt-Tick
    // mit den (URL-only) Defaults die in localStorage gespeicherte Persona,
    // bevor der Init-Effekt sie laden konnte.
    if (hydrated) persistFilters(filters);
    const advParam = advToUrlParam(adv);
    const sortParam = sortTouched && sortBy !== 'avg' ? `&sort=${sortBy}` : '';
    const url = `${pathname}?${qs}${advParam ? `&adv=${advParam}` : ''}${sortParam}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
    return () => { ctl.abort(); if (timer) clearTimeout(timer); };
  }, [filters, adv, sortBy, sortTouched, hydrated, pathname, router, reloadKey]);
  const retry = () => setReloadKey(k => k + 1);

  // Filter-change handler that also auto-flips the sort to "Trending" the
  // first time the user enables Δ — and back to "avg" when they turn it off.
  // Skips if they've explicitly chosen a sort already, so a manual decision
  // is never overridden. Done in the change handler instead of an effect to
  // avoid the setState-within-effect cascade lint flags warn about.
  const handleFiltersChange = (next: Filters) => {
    if (!sortTouched) {
      if (next.velocity > 0 && filters.velocity === 0) setSortBy('velocity');
      else if (next.velocity === 0 && filters.velocity > 0) setSortBy('avg');
    }
    setFilters(next);
  };
  const chooseSort = (s: CompSortBy) => { setSortTouched(true); setSortBy(s); };

  // Carry-Cost-Lookup: cluster_key = "<trait>@<level>_<carryCharacterId>".
  // Bundle-Champions tragen den Cost direkt; null wenn der Carry-Asset fehlt
  // (stale Carry-ID nach Set-Wechsel).
  const carryCostLookup = (clusterKey: string): number | null => {
    if (!assets) return null;
    const m = /^(.+)@\d+_(.+)$/.exec(clusterKey);
    if (!m) return null;
    const ch = assets.champions[m[2]];
    return typeof ch?.cost === 'number' ? ch.cost : null;
  };
  // Apply advanced filters BEFORE sort so the result count + sort target match.
  // Client-side filter on the already-loaded comps — no extra API roundtrip.
  const filteredComps = applyAdvancedFilters(comps, adv, { carryCostLookup });

  const families = useMemo(
    () => buildCompFamilies(filteredComps, sortBy, assets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredComps, sortBy, assets],
  );
  const setFamilies = useMemo(() => currentSetFamilies(families, assets), [families, assets]);
  const topKeys = useMemo(() => topFamilyKeys(setFamilies), [setFamilies]);

  return {
    filters, handleFiltersChange,
    adv, setAdv,
    sortBy, chooseSort,
    comps, filteredComps, hasData, patches, minGames, assets, loading, tierCutoffs,
    error, retry,
    currentPatchLabel: patches[0]?.patch,
    families, currentSetFamilies: setFamilies, topFamilyKeys: topKeys,
  };
}

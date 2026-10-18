'use client';
// Filter, Abruf und URL-Abgleich der Comp-Seiten. Liste (/tft/comps) und
// Uebersicht (/tft/comps/atlas) teilen sich das, damit beide dieselben Comps
// mit denselben Filtern zeigen — 1:1 aus app/tft/comps/page.tsx (2026-09-27).
//
// Startdaten (SEO-Plan Schritt 4, Liste und seit 16.10.2026 Uebersicht): die
// Server-Seite schickt die Zeilen der 40 gezeigten Familien mit
// (app/lib/seo/initial-data.ts, compsStart) — Teildaten. Die volle Liste (bis 1,8 MB) laedt erst, wenn eine
// Ansicht sie braucht: Suche, Erweitert (`wantFull` bzw. `fullForView`).
// Vorpatch-Vergleich (Spalte der Liste, Pfeile der Uebersicht, Trending):
// eigene Abfrage ueber usePatchDelta, die Liste bleibt dieselbe. Sonst gelten die Regeln von useTftStatsList:
//   - Erstes Rendern = Server-HTML (Filter, Zeilen, Assets, Tier-Grenzen als
//     Props), gespeicherte Filter erst im useLayoutEffect; weichen sie ab:
//     Ladeanzeige statt fremder Zahlen (E3).
//   - Kein Abruf, wenn die gezeigten Daten passen — auch nicht nach dem
//     Rang-Abgleich mit dem Server. Geladene Staende bleiben je
//     Daten-Schluessel gemerkt (hoechstens LOADED_MAX).
//   - Adresse per history.replaceState (kein Neurechnen der Server-Seite).
//   - Jeder Versuch bricht nach FETCH_TIMEOUT_MS ab und zaehlt dann als
//     wiederholbarer Fehler — sonst bliebe die Ladeanzeige ewig stehen.
// Ohne initialFilters (heute kein Aufrufer mehr): Filter wie frueher aus
// Adresse bzw. Speicher, Abruf nach dem Mount.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, usePathname } from 'next/navigation';
import {
  loadInitialFilters,
  resolveMountFilters,
  adoptServerBucket,
  rememberAutoBucket,
  persistFilters,
  filtersToQueryString,
  filtersToApiQueryString,
  filtersDataKey,
  hasUrlFilters,
  type Filters,
  type PatchInfo,
} from './tft-filters';
import type { StatsInitial } from './seo/initial-data';
import { releaseStatsPending } from './seo/stats-pending';
import { loadTftAssets, type TftAssetsBundle } from './tft-cdragon';
import { loadTierCutoffs, type TierCutoffs } from './tft-tier-letter';
import {
  advFromUrlParam,
  advToUrlParam,
  applyAdvancedFilters,
  isAdvActive,
  type AdvancedFilters,
} from '../components/tft/AdvancedCompFilters';
import { attachPatchDeltas, buildCompFamilies, currentSetFamilies, dataEndOf, topFamilyKeys, type CompApiRow, type CompSortBy } from './tft-comp-families';
import { usePatchDelta } from './usePatchDelta';
import type { PatchDeltaStart } from './tft-patch-delta';

// Volle Antwort bis 1,8 MB; ein Versuch darf auf langsamen Leitungen dauern.
const FETCH_TIMEOUT_MS = 25_000;
// Gemerkte Staende: eine volle Liste belegt ~2,5 MB Speicher.
const LOADED_MAX = 4;

interface Loaded {
  comps: CompApiRow[];
  patches: PatchInfo[];
  minGames: number | null;
  partial: boolean;
  dataEnd: string | null;
}


export function useTftCompsData({ initialFilters, initial = null, wantFull = false, deltaAlways = false, initialDelta = null }: {
  /** Liste: Filter der Server-Ansicht (Adresse + vom Server bestimmter Rang). */
  initialFilters?: Filters;
  initial?: StatsInitial<CompApiRow> | null;
  /** Die Seite braucht die volle Liste (Suche, Vergleich aus der Adresse). */
  wantFull?: boolean;
  /** Uebersicht: Vorpatch-Vergleich immer (User 18.10.2026), nicht nur mit Δ-Filter. */
  deltaAlways?: boolean;
  /** Vorpatch-Vergleich der Server-Seite (seo/initial-data.ts compDeltaStart). */
  initialDelta?: PatchDeltaStart | null;
} = {}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  // Uebersicht ohne Server-Filter: wie bisher aus der Adresse; gespeicherte
  // Filter holt der Init-Effekt unten.
  const [filters, setFilters] = useState<Filters>(() =>
    initialFilters ?? loadInitialFilters(new URLSearchParams(searchParams.toString())),
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
  const [comps, setComps] = useState<CompApiRow[]>(() => initial?.payload.rows ?? []);
  // Gezeigt werden Teildaten (Startdaten der Liste).
  const [partial, setPartial] = useState<boolean>(() => !!initial?.partial);
  const [hasData, setHasData] = useState<boolean | null>(() => (initial ? true : null));
  const [patches, setPatches] = useState<PatchInfo[]>(() => initial?.payload.patches ?? []);
  const [minGames, setMinGames] = useState<number | null>(() => initial?.payload.minGames ?? null);
  const [dataEnd, setDataEnd] = useState<string | null>(() => dataEndOf(initial?.payload.filters));
  const [assets, setAssets] = useState<TftAssetsBundle | null>(() => initial?.assets ?? null);
  // Ohne Startdaten startet der erste Abruf sofort nach dem Mount.
  const [loading, setLoading] = useState(!initial);
  // Gespeicherte Filter weichen von der Server-Ansicht ab (SEO-Plan E3).
  const [awaitingStored, setAwaitingStored] = useState(false);
  // Abruf endgueltig gescheitert (nach den Wiederholungen). Bis 2026-10-02 sah
  // ein 502 hier aus wie „keine Comps" — r.ok wurde nie geprueft.
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tierCutoffs, setTierCutoffs] = useState<TierCutoffs | null>(() => initial?.tierCutoffs ?? null);
  // Daten-Schluessel und Teildaten-Merkmal der gezeigten Zeilen.
  const shownKey = useRef<string | null>(initial && initialFilters ? filtersDataKey(initialFilters) : null);
  const shownPartial = useRef<boolean>(!!initial?.partial);
  const loaded = useRef(new Map<string, Loaded>());
  // Laufender Abruf (Adresse + Abbruch). Bleibt stehen, wenn ein neuer
  // Effekt-Lauf dieselbe Adresse wollte — die Antwort ist immer die volle Liste.
  const inflight = useRef<{ qs: string; cancel: () => void } | null>(null);
  // Daten-Schluessel und Stand der Startdaten: das Nachladen dazu nennt den
  // Stand (?sv=), damit die volle Liste zum selben Zwischenstand gehoert.
  const startData = useRef(initial && initialFilters
    ? { key: filtersDataKey(initialFilters), version: initial.version ?? null }
    : null);
  // Set, fuer das die Tier-Grenzen schon da sind (vom Server mitgeliefert).
  const cutoffSet = useRef<number | null | undefined>(initial ? initial.assets.set : undefined);

  // Volles Bundle wie bisher; bis dahin reicht der Ausschnitt vom Server, ein
  // Fehlschlag ersetzt ihn nicht.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);
  useEffect(() => {
    const set = assets?.set ?? null;
    if (cutoffSet.current === set) return;
    cutoffSet.current = set;
    loadTierCutoffs(set).then(setTierCutoffs);
  }, [assets?.set]);

  const remember = (key: string, entry: Loaded) => {
    loaded.current.delete(key);
    loaded.current.set(key, entry);
    while (loaded.current.size > LOADED_MAX) loaded.current.delete(loaded.current.keys().next().value as string);
  };

  // Init vor dem ersten Zeichnen, genau einmal. Liste: die Filter, die
  // wirklich gelten (Adresse, sonst Speicher), gegen die der Server-Ansicht —
  // wie useTftStatsList. Uebersicht: gespeicherte Filter, wenn die Adresse
  // keine nennt. Erst danach darf der Haupt-Effekt laden und speichern.
  useLayoutEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (initialFilters) {
      if (initial) {
        remember(filtersDataKey(initialFilters), {
          comps: initial.payload.rows,
          patches: initial.payload.patches,
          minGames: initial.payload.minGames ?? null,
          partial: !!initial.partial,
          dataEnd: dataEndOf(initial.payload.filters),
        });
      }
      const mount = resolveMountFilters(initialFilters, params);
      if (mount.change) setFilters(mount.filters);
      if (mount.change === 'data' && initial) setAwaitingStored(true);
      const served = initial?.payload.filters?.bucket;
      if (initialFilters.bucketAuto && typeof served === 'string') rememberAutoBucket(served);
    } else if (!hasUrlFilters(params)) {
      setFilters(loadInitialFilters(params));
    }
    releaseStatsPending();
    setHydrated(true);
    // Nur beim Mount: spaetere Props (Navigation zurueck) aendern nichts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adresse nachfuehren (teilbare Links). history.replaceState statt
  // router.replace: Next haelt useSearchParams synchron, rechnet die
  // Server-Seite aber nicht neu.
  useEffect(() => {
    if (!hydrated) return;
    const qs = filtersToQueryString(filters);
    const advParam = advToUrlParam(adv);
    const sortParam = sortTouched && sortBy !== 'avg' ? `&sort=${sortBy}` : '';
    const url = `${pathname}?${qs}${advParam ? `&adv=${advParam}` : ''}${sortParam}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, '', url);
    }
    persistFilters(filters);
  }, [filters, adv, sortBy, sortTouched, hydrated, pathname]);

  // Erweitert rechnet auf der vollen Liste; auf Teildaten kaemen andere Comps
  // heraus → Ladeanzeige bis sie da ist. Trending nicht mehr: es sortiert
  // dieselben 40 Familien nur um (Vorpatch-Vergleich, eigene Abfrage).
  const fullForView = isAdvActive(adv);
  const needFull = wantFull || fullForView;
  const fullForViewRef = useRef(fullForView);
  fullForViewRef.current = fullForView;

  // Laufenden Abruf beim Verlassen der Seite abbrechen.
  useEffect(() => () => { inflight.current?.cancel(); inflight.current = null; }, []);

  useEffect(() => {
    if (!hydrated) return;
    const key = filtersDataKey(filters);
    const enough = (isPartial: boolean) => !(isPartial && needFull);
    const stop = () => { inflight.current?.cancel(); inflight.current = null; };
    if (key === shownKey.current && enough(shownPartial.current)) {
      stop();
      setLoading(false);
      setAwaitingStored(false);
      return;
    }
    const known = loaded.current.get(key);
    if (known && enough(known.partial)) {
      stop();
      shownKey.current = key;
      shownPartial.current = known.partial;
      setError(false);
      setHasData(true);
      setComps(known.comps);
      setPatches(known.patches);
      setMinGames(known.minGames);
      setDataEnd(known.dataEnd);
      setPartial(known.partial);
      setLoading(false);
      setAwaitingStored(false);
      return;
    }
    // Zur gezeigten Teilliste die volle nachladen — zum selben Zwischenstand.
    const upgrading = key === shownKey.current;
    const sv = startData.current?.key === key && startData.current.version
      ? `&sv=${encodeURIComponent(startData.current.version)}` : '';
    const qs = `${filtersToApiQueryString(filters)}&source=data${sv}`;
    // Dieselbe Adresse laeuft schon (z. B. Suchfeld fokussiert, waehrend
    // gespeicherte Filter laden): weiterlaufen lassen.
    if (inflight.current?.qs === qs) return;
    stop();

    // Abbruch bei jedem neuen Abruf: /api/tft/comps liefert bis zu 1,8 MB und
    // geht bei einem Snapshot-Miss auf die RPC. Zwei schnelle Filter-Wechsel
    // können deshalb out-of-order eintreffen — die alte Liste würde die neue
    // überschreiben, während die Filter-Chips schon das neue Set zeigen.
    const ctl = new AbortController();
    const { signal } = ctl;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => { ctl.abort(); if (retryTimer) clearTimeout(retryTimer); };
    inflight.current = { qs, cancel };
    setLoading(true);
    // Bis zu 3 Versuche, aber nur bei Server- oder Netzfehler (5xx, kein
    // Netz, Zeitlimit) und nur im sichtbaren Tab; ein 4xx ist endgueltig. Die
    // Streuung verhindert, dass viele Besucher nach einem Aussetzer
    // gleichzeitig nachfragen.
    const attempt = (n: number) => {
      // Eigener Abbruch je Versuch fuers Zeitlimit; der Abbruch von aussen
      // (neuer Abruf, Seite verlassen) reicht durch.
      const tryCtl = new AbortController();
      const passAbort = () => tryCtl.abort();
      signal.addEventListener('abort', passAbort);
      const timeout = setTimeout(() => tryCtl.abort(), FETCH_TIMEOUT_MS);
      fetch(`/api/tft/comps?${qs}`, { signal: tryCtl.signal })
        .then(r => {
          if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { retryable: r.status >= 500 });
          return r.json();
        })
        .then(d => {
          if (signal.aborted) return;
          inflight.current = null;
          // Gezeigt wird der Rang, den der Server benutzt hat — so loest der
          // Abgleich darunter keinen zweiten Abruf aus.
          const servedBucket = typeof d.filters?.bucket === 'string' ? d.filters.bucket : filters.bucket;
          const servedKey = filtersDataKey({ ...filters, bucket: servedBucket });
          const next: Loaded = {
            comps: d.comps || [],
            patches: d.patches || [],
            minGames: typeof d.minGames === 'number' ? d.minGames : null,
            partial: false,
            dataEnd: dataEndOf(d.filters),
          };
          if (d.hasData && next.comps.length) remember(servedKey, next);
          shownKey.current = servedKey;
          shownPartial.current = false;
          // Rang, den der Server tatsaechlich benutzt hat, in den Filter spiegeln
          // (nur solange der User keinen eigenen gewaehlt hat).
          adoptServerBucket(d.filters?.bucket, filters, setFilters);
          setError(false);
          setHasData(!!d.hasData);
          setComps(next.comps);
          setPatches(next.patches);
          setMinGames(next.minGames);
          setDataEnd(next.dataEnd);
          setPartial(false);
          setLoading(false);
          setAwaitingStored(false);
        })
        .catch((e: { retryable?: boolean }) => {
          if (signal.aborted) return;
          const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
          if (e?.retryable !== false && n < 3 && visible) {
            retryTimer = setTimeout(() => attempt(n + 1), 1000 * n + Math.random() * 1000);
            return;
          }
          inflight.current = null;
          setLoading(false);
          setAwaitingStored(false);
          // Nachladen zur gezeigten Teilliste gescheitert: die gezeigten Zahlen
          // stimmen weiter (Suche findet dann nur unter den 40). Nur wenn die
          // Ansicht die volle Liste braucht (Erweitert), Fehlerkasten.
          if (upgrading && !fullForViewRef.current) return;
          // Keine leere Liste vortaeuschen: die Seite zeigt den Fehlerkasten.
          shownKey.current = null;
          setError(true);
        })
        .finally(() => {
          clearTimeout(timeout);
          signal.removeEventListener('abort', passAbort);
        });
    };
    attempt(1);
    // Kein Abbruch im Cleanup: der naechste Lauf entscheidet (stop() oben),
    // ob der laufende Abruf noch gebraucht wird.
    // fullForView eigens: scheiterte das Nachladen fuer die Suche still, bleibt
    // needFull beim Klick auf Erweitert gleich — ohne neuen Versuch stuende die
    // Ladeanzeige dann fuer immer.
  }, [filters, hydrated, needFull, fullForView, reloadKey]);
  const retry = () => setReloadKey(k => k + 1);

  // Filter-change handler that also auto-flips the sort to "Trending" the
  // first time the user enables Δ — and back to "avg" when they turn it off.
  // Skips if they've explicitly chosen a sort already, so a manual decision
  // is never overridden. Done in the change handler instead of an effect to
  // avoid the setState-within-effect cascade lint flags warn about.
  // Ausnahme: ohne Δ gibt es die Trend-Sortierung nicht (die Option fehlt im
  // Auswahlfeld) — dann immer zurueck auf avg.
  const handleFiltersChange = (next: Filters) => {
    if (next.velocity > 0 && filters.velocity === 0 && !sortTouched) setSortBy('velocity');
    else if (next.velocity === 0 && filters.velocity > 0 && (!sortTouched || sortBy === 'velocity')) setSortBy('avg');
    setFilters(next);
  };
  const chooseSort = (s: CompSortBy) => { setSortTouched(true); setSortBy(s); };

  // Apply advanced filters BEFORE sort so the result count + sort target match.
  // Client-side filter on the already-loaded comps — no extra API roundtrip.
  // Memoisiert: sonst baut jedes Rendern die Familien neu (useMemo unten).
  const filteredComps = useMemo(() => {
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
    return applyAdvancedFilters(comps, adv, { carryCostLookup });
  }, [comps, adv, assets]);

  // Vorpatch-Vergleich: Liste nur mit Δ-Filter, Uebersicht immer. Ohne Paar
  // (Set-Start, zu junger Patch) gibt es ihn nicht — auch nicht mit Filter.
  const deltaOn = deltaAlways || filters.velocity > 0;
  const delta = usePatchDelta({ entity: 'comp', filters, patches, enabled: deltaOn, initial: initialDelta });
  const deltaView = useMemo(
    () => (delta.pair && deltaOn ? { pair: delta.pair, loading: delta.loading } : null),
    [delta.pair, delta.loading, deltaOn],
  );

  const builtFamilies = useMemo(
    () => buildCompFamilies(filteredComps, sortBy, assets),
    [filteredComps, sortBy, assets],
  );
  const families = useMemo(
    () => attachPatchDeltas(builtFamilies, deltaOn ? delta.index : null, sortBy === 'velocity'),
    [builtFamilies, deltaOn, delta.index, sortBy],
  );
  const setFamilies = useMemo(() => currentSetFamilies(families, assets), [families, assets]);
  const topKeys = useMemo(() => topFamilyKeys(setFamilies), [setFamilies]);

  return {
    filters, handleFiltersChange,
    adv, setAdv,
    sortBy, chooseSort,
    comps, filteredComps, hasData, patches, minGames, assets, loading, tierCutoffs,
    error, retry, dataEnd,
    // Vergleichs-Spalte bzw. Pfeile (null = aus).
    deltaView,
    // Teildaten: Zaehler ueber alle Comps waeren falsch. Auf Teildaten mit
    // Erweitert zeigt die Seite die Ladeanzeige.
    partial, awaitingStored, awaitingFull: partial && fullForView,
    currentPatchLabel: patches[0]?.patch,
    families, currentSetFamilies: setFamilies, topFamilyKeys: topKeys,
  };
}

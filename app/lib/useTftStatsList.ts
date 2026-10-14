'use client';
// Gemeinsamer Lade-Ablauf der TFT-Statistik-Listen mit Server-Startdaten
// (Units, Items, Traits — SEO-Plan Schritt 3). Vorher stand derselbe Ablauf
// in jeder Seite einzeln; mit Startdaten kamen Regeln dazu, die an allen drei
// Stellen gleich sein muessen:
//
//   - Erstes Rendern = Server-HTML: Filter, Zeilen, Assets und Tier-Grenzen
//     kommen als Props (app/lib/seo/initial-data.ts), nichts aus localStorage
//     oder window — sonst Hydration-Fehler.
//   - Gespeicherte Filter erst im useLayoutEffect (vor dem ersten Zeichnen).
//     Weichen sie ab: Ladeanzeige statt fremder Zahlen (E3), Merkmal des
//     Vorab-Skripts weg (app/lib/seo/stats-pending.ts).
//   - Kein Abruf, wenn die gezeigten Daten schon passen (filtersDataKey) —
//     auch nicht nach dem Rang-Abgleich mit dem Server.
//   - Adresse per history.replaceState: kein Neurechnen der Server-Seite je
//     Filterwechsel.
//   - Schon geladene Staende bleiben je Daten-Schluessel gemerkt (vorbelegt
//     mit den Startdaten): zurueck auf einen frueheren Filter zeigt dieselben
//     Zahlen ohne Abruf. Sonst kaeme die API-Kopie vom Edge, die aelter sein
//     kann als die Startdaten (bis 6 h, api-cache.ts) — die Zahlen sprangen.
//   - Abrufe brechen nach FETCH_TIMEOUT_MS ab, sonst bliebe bei einer
//     haengenden Anfrage die Ladeanzeige fuer immer stehen.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  resolveMountFilters,
  adoptServerBucket,
  rememberAutoBucket,
  persistFilters,
  filtersToQueryString,
  filtersDataKey,
  type Filters,
  type PatchInfo,
} from './tft-filters';
import type { StatsInitial } from './seo/initial-data';
import { releaseStatsPending } from './seo/stats-pending';
import { loadTftAssets, type TftAssetsBundle } from './tft-cdragon';
import { loadTierCutoffs, type TierCutoffs } from './tft-tier-letter';

const FETCH_TIMEOUT_MS = 15_000;

interface Loaded<Row> {
  rows: Row[];
  patches: PatchInfo[];
}

export function useTftStatsList<Row>({ endpoint, field, initialFilters, initial, withTierCutoffs = true }: {
  /** z. B. '/api/tft/units' */
  endpoint: string;
  /** Feld der API-Antwort mit den Zeilen ('units' / 'items' / 'traits'). */
  field: string;
  initialFilters: Filters;
  initial: StatsInitial<Row> | null;
  /** false: die Seite zeigt keine Tier-Buchstaben, Grenzen nicht laden. */
  withTierCutoffs?: boolean;
}) {
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => initial?.payload.rows ?? []);
  const [hasData, setHasData] = useState<boolean | null>(() => (initial ? true : null));
  const [patches, setPatches] = useState<PatchInfo[]>(() => initial?.payload.patches ?? []);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(() => initial?.assets ?? null);
  // Ohne Startdaten startet der erste Abruf sofort nach dem Mount.
  const [loading, setLoading] = useState(!initial);
  // Gespeicherte Filter weichen von der Server-Ansicht ab: Ladeanzeige statt
  // fremder Zahlen, bis die eigenen da sind (SEO-Plan E3).
  const [awaitingStored, setAwaitingStored] = useState(false);
  const [tierCutoffs, setTierCutoffs] = useState<TierCutoffs | null>(() => initial?.tierCutoffs ?? null);
  // Daten-Schluessel der gezeigten Zeilen. Gleich dem der Filter → kein
  // Abruf. Startdaten zaehlen als gezeigt.
  const shownKey = useRef<string | null>(initial ? filtersDataKey(initialFilters) : null);
  // Geladene Staende mit Daten je Daten-Schluessel; Startdaten traegt der
  // Mount-Effekt ein.
  const loaded = useRef(new Map<string, Loaded<Row>>());
  // Set, fuer das die Tier-Grenzen schon da sind (vom Server mitgeliefert).
  const cutoffSet = useRef<number | null | undefined>(initial ? initial.assets.set : undefined);

  // Volles Bundle wie bisher (neue Eintraege nach einem Filterwechsel). Bis
  // dahin reicht der Ausschnitt vom Server; ein Fehlschlag ersetzt ihn nicht.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);
  useEffect(() => {
    if (!withTierCutoffs) return;
    const set = assets?.set ?? null;
    if (cutoffSet.current === set) return;
    cutoffSet.current = set;
    loadTierCutoffs(set).then(setTierCutoffs);
  }, [assets?.set, withTierCutoffs]);

  // Vor dem ersten Zeichnen: die Filter, die wirklich gelten (Adresse, sonst
  // localStorage — resolveMountFilters). Weichen sie von denen der
  // Server-Ansicht ab, laden wir. Danach entscheidet React allein.
  useLayoutEffect(() => {
    if (initial) loaded.current.set(filtersDataKey(initialFilters), { rows: initial.payload.rows, patches: initial.payload.patches });
    const mount = resolveMountFilters(initialFilters, new URLSearchParams(window.location.search));
    if (mount.change) setFilters(mount.filters);
    if (mount.change === 'data') setAwaitingStored(true);
    const served = initial?.payload.filters?.bucket;
    if (initialFilters.bucketAuto && typeof served === 'string') rememberAutoBucket(served);
    releaseStatsPending();
    setHydrated(true);
    // Nur beim Mount: spaetere Props (Navigation zurueck) aendern nichts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const qs = filtersToQueryString(filters);
    // Adresse nachfuehren (teilbare Links). history.replaceState statt
    // router.replace: Next haelt useSearchParams synchron, rechnet die
    // Server-Seite aber nicht neu (das waere je Filterwechsel ein
    // Snapshot-Abruf samt Startdaten, die niemand braucht).
    const url = `${pathname}?${qs}`;
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(null, '', url);
    }
    persistFilters(filters);
    const key = filtersDataKey(filters);
    const known = key === shownKey.current ? null : loaded.current.get(key);
    if (known) {
      shownKey.current = key;
      setHasData(true);
      setRows(known.rows);
      setPatches(known.patches);
    }
    if (known || key === shownKey.current) {
      setLoading(false);
      setAwaitingStored(false);
      return;
    }
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    setLoading(true);
    fetch(`${endpoint}?${qs}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        // Gezeigt wird der Rang, den der Server benutzt hat — so loest der
        // Abgleich darunter keinen zweiten Abruf aus.
        const servedBucket = typeof d.filters?.bucket === 'string' ? d.filters.bucket : filters.bucket;
        const servedKey = filtersDataKey({ ...filters, bucket: servedBucket });
        shownKey.current = servedKey;
        const nextRows: Row[] = d[field] || [];
        const nextPatches: PatchInfo[] = d.patches || [];
        if (d.hasData && nextRows.length) loaded.current.set(servedKey, { rows: nextRows, patches: nextPatches });
        // Rang, den der Server tatsaechlich benutzt hat, in den Filter spiegeln
        // (nur solange der User keinen eigenen gewaehlt hat).
        adoptServerBucket(d.filters?.bucket, filters, setFilters);
        setHasData(!!d.hasData);
        setRows(nextRows);
        setPatches(nextPatches);
        setLoading(false);
        setAwaitingStored(false);
      })
      .catch(() => {
        if (cancelled) return;
        shownKey.current = null;
        setHasData(false);
        setRows([]);
        setLoading(false);
        setAwaitingStored(false);
      })
      .finally(() => clearTimeout(timer));
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort(); };
  }, [filters, hydrated, pathname, endpoint, field]);

  return { filters, setFilters, rows, hasData, patches, loading, awaitingStored, assets, tierCutoffs };
}

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
  filtersToApiQueryString,
  filtersDataKey,
  type Filters,
  type PatchInfo,
} from './tft-filters';
import type { StatsInitial } from './seo/initial-data';
import { releaseStatsPending } from './seo/stats-pending';
import { loadTftAssets, type TftAssetsBundle } from './tft-cdragon';

const FETCH_TIMEOUT_MS = 15_000;

interface Loaded<Row> {
  rows: Row[];
  patches: PatchInfo[];
  dataEnd: string | null;
}

// Letzter voller Tag der Antwort (filters.dataEnd) fuer den Δ-Vergleich —
// gleiche Pruefung wie dataEndOf in tft-comp-families.ts, ohne deren Importe.
function dataEndOf(filters: unknown): string | null {
  const v = (filters as { dataEnd?: unknown } | null | undefined)?.dataEnd;
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function useTftStatsList<Row>({ endpoint, field, initialFilters, initial }: {
  /** z. B. '/api/tft/units' */
  endpoint: string;
  /** Feld der API-Antwort mit den Zeilen ('units' / 'items' / 'traits'). */
  field: string;
  initialFilters: Filters;
  initial: StatsInitial<Row> | null;
}) {
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [hydrated, setHydrated] = useState(false);
  const [rows, setRows] = useState<Row[]>(() => initial?.payload.rows ?? []);
  const [hasData, setHasData] = useState<boolean | null>(() => (initial ? true : null));
  const [patches, setPatches] = useState<PatchInfo[]>(() => initial?.payload.patches ?? []);
  const [dataEnd, setDataEnd] = useState<string | null>(() => dataEndOf(initial?.payload.filters));
  const [assets, setAssets] = useState<TftAssetsBundle | null>(() => initial?.assets ?? null);
  // Ohne Startdaten startet der erste Abruf sofort nach dem Mount.
  const [loading, setLoading] = useState(!initial);
  // Gespeicherte Filter weichen von der Server-Ansicht ab: Ladeanzeige statt
  // fremder Zahlen, bis die eigenen da sind (SEO-Plan E3).
  const [awaitingStored, setAwaitingStored] = useState(false);
  // Daten-Schluessel der gezeigten Zeilen. Gleich dem der Filter → kein
  // Abruf. Startdaten zaehlen als gezeigt.
  const shownKey = useRef<string | null>(initial ? filtersDataKey(initialFilters) : null);
  // Geladene Staende mit Daten je Daten-Schluessel; Startdaten traegt der
  // Mount-Effekt ein.
  const loaded = useRef(new Map<string, Loaded<Row>>());

  // Volles Bundle wie bisher (neue Eintraege nach einem Filterwechsel). Bis
  // dahin reicht der Ausschnitt vom Server; ein Fehlschlag ersetzt ihn nicht.
  useEffect(() => { loadTftAssets().then(b => { if (b) setAssets(b); }); }, []);

  // Vor dem ersten Zeichnen: die Filter, die wirklich gelten (Adresse, sonst
  // localStorage — resolveMountFilters). Weichen sie von denen der
  // Server-Ansicht ab, laden wir. Danach entscheidet React allein.
  useLayoutEffect(() => {
    if (initial) loaded.current.set(filtersDataKey(initialFilters), { rows: initial.payload.rows, patches: initial.payload.patches, dataEnd: dataEndOf(initial.payload.filters) });
    const mount = resolveMountFilters(initialFilters, new URLSearchParams(window.location.search));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Absicht: Adresse und localStorage gibt es erst im Browser, Angleich vor dem ersten Zeichnen
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
      setDataEnd(known.dataEnd);
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
    fetch(`${endpoint}?${filtersToApiQueryString(filters)}`, { signal: ctrl.signal })
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
        const nextDataEnd = dataEndOf(d.filters);
        if (d.hasData && nextRows.length) loaded.current.set(servedKey, { rows: nextRows, patches: nextPatches, dataEnd: nextDataEnd });
        // Rang, den der Server tatsaechlich benutzt hat, in den Filter spiegeln
        // (nur solange der User keinen eigenen gewaehlt hat).
        adoptServerBucket(d.filters?.bucket, filters, setFilters);
        setHasData(!!d.hasData);
        setRows(nextRows);
        setPatches(nextPatches);
        setDataEnd(nextDataEnd);
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

  return { filters, setFilters, rows, hasData, patches, dataEnd, loading, awaitingStored, assets };
}

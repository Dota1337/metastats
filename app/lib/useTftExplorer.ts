'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  followFocus, parseExplorerParams, serializeExplorerQuery,
  type ExplorerQuery, type ExplorerResponse,
} from './tft-explorer-query';

// Zustand des Data Explorers liegt komplett in der URL (teilbar). Filter ersetzen
// den Verlaufseintrag (replace); nur Spruenge in einen anderen Reiter legen einen
// neuen an (push), damit die Zurueck-Taste dorthin zurueckfuehrt. Die Anfrage an /api/tft/explorer benutzt dieselbe Form, damit
// Vercel sie als Cache-Schluessel nimmt.

// notReady: die Datei auf der Box stammt noch vom alten Aufbau und kennt
// Zaehler, Spiele oder Builds noch nicht (Dienst 409).
export type ExplorerError = 'busy' | 'timeout' | 'unavailable' | 'notReady' | 'failed';

export function useTftExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spKey = searchParams.toString();
  const query = useMemo(() => parseExplorerParams(new URLSearchParams(spKey)), [spKey]);

  // Hat diese Sitzung selbst einen Verlaufseintrag angelegt? Dann darf der
  // Zurueck-Button router.back() nehmen, sonst (geteilter Link) nicht.
  const pushed = useRef(false);
  // now: die naechste Anfrage ohne Verzoegerung schicken (Klick auf einen
  // Suchtreffer oder Vorschlag — ein einzelner Klick, kein Durchklicken).
  const nowRef = useRef(false);
  // Hat der Besucher im Auswahlfeld „—" gewaehlt? Dann setzt erst die naechste
  // gesuchte Unit wieder einen Traeger (followFocus), kein Reiterwechsel.
  const focusCleared = useRef(false);
  // Zuletzt gesetzte Anfrage: Klicks im Drop-down-Raster kommen schneller, als
  // die Adresse nachzieht. Eine Funktion als `next` rechnet dann auf ihr statt
  // auf dem alten Stand (sonst ginge der erste Klick verloren), hoechstens 1,5 s.
  const latest = useRef<{ q: ExplorerQuery; qs: string; at: number } | null>(null);

  const setQuery = useCallback((next: ExplorerQuery | ((q: ExplorerQuery) => ExplorerQuery), opts?: { push?: boolean; now?: boolean }) => {
    const l = latest.current;
    const prev = typeof next === 'function' && l && Date.now() - l.at < 1500 && l.qs !== serializeExplorerQuery(query) ? l.q : query;
    const raw = typeof next === 'function' ? next(prev) : next;
    if (raw.focus === null && prev.focus !== null) focusCleared.current = true;
    const q = followFocus(prev, raw, { cleared: focusCleared.current });
    if (q.focus) focusCleared.current = false;
    // Nur wenn sich die Anfrage aendert — sonst bliebe der Merker fuer einen spaeteren Klick stehen.
    if (opts?.now && serializeExplorerQuery(q, { forApi: true }) !== serializeExplorerQuery(prev, { forApi: true })) nowRef.current = true;
    const qs = serializeExplorerQuery(q);
    latest.current = { q, qs, at: Date.now() };
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (opts?.push) { pushed.current = true; router.push(url, { scroll: false }); }
    else router.replace(url, { scroll: false });
  }, [query, router, pathname]);

  const backToUnits = useCallback(() => {
    if (pushed.current) { pushed.current = false; router.back(); return; }
    // Traeger bleibt: die Seiten-Adresse fuehrt ihn auch im Units-Reiter.
    setQuery({ ...query, tab: 'units', combo: 1 });
  }, [query, router, setQuery]);

  const apiQs = serializeExplorerQuery(query, { forApi: true });
  const [data, setData] = useState<ExplorerResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ExplorerError | null>(null);
  const [retry, setRetry] = useState(0);
  const [okQs, setOkQs] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    // Kurze Verzoegerung: mehrere schnelle Klicks loesen eine Anfrage aus.
    const delay = nowRef.current ? 0 : 250;
    nowRef.current = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/tft/explorer?${apiQs}`, { signal: controller.signal })
        .then(async r => {
          const body = await r.json().catch(() => null);
          if (!r.ok || !body) {
            const code: ExplorerError = r.status === 504 ? 'timeout'
              : body?.error === 'busy' ? 'busy'
              : body?.error === 'not_ready' ? 'notReady'
              : r.status === 503 ? 'unavailable' : 'failed';
            throw Object.assign(new Error(code), { code });
          }
          return body as ExplorerResponse;
        })
        .then(body => {
          if (controller.signal.aborted) return;
          setOkQs(apiQs);
          setData(body);
          setLoading(false);
        })
        .catch(err => {
          if (controller.signal.aborted || err?.name === 'AbortError') return;
          setError((err?.code as ExplorerError) || 'failed');
          setLoading(false);
        });
    }, delay);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [apiQs, retry]);

  const reload = useCallback(() => setRetry(n => n + 1), []);
  // Zeigen die Daten noch die vorige Auswahl?
  const stale = loading && okQs !== apiQs;
  // Zu welcher Auswahl gehoeren die geladenen Daten? Die Tabelle zeigt beim
  // Reiterwechsel sonst kurz fremde Zeilen unter dem neuen Kopf.
  const dataQuery = useMemo(() => (okQs == null ? null : parseExplorerParams(new URLSearchParams(okQs))), [okQs]);

  return { query, setQuery, backToUnits, data, dataQuery, loading, stale, error, reload };
}

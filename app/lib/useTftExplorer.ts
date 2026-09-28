'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  parseExplorerParams, serializeExplorerQuery,
  type ExplorerQuery, type ExplorerResponse,
} from './tft-explorer-query';

// Zustand des Data Explorers liegt komplett in der URL (teilbar). Filter ersetzen
// den Verlaufseintrag (replace); nur Spruenge in einen anderen Reiter legen einen
// neuen an (push), damit die Zurueck-Taste dorthin zurueckfuehrt. Die Anfrage an /api/tft/explorer benutzt dieselbe Form, damit
// Vercel sie als Cache-Schluessel nimmt.

export type ExplorerError = 'busy' | 'timeout' | 'unavailable' | 'failed';

export function useTftExplorer() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const spKey = searchParams.toString();
  const query = useMemo(() => parseExplorerParams(new URLSearchParams(spKey)), [spKey]);

  // Hat diese Sitzung selbst einen Verlaufseintrag angelegt? Dann darf der
  // Zurueck-Button router.back() nehmen, sonst (geteilter Link) nicht.
  const pushed = useRef(false);

  const setQuery = useCallback((next: ExplorerQuery | ((q: ExplorerQuery) => ExplorerQuery), opts?: { push?: boolean }) => {
    const q = typeof next === 'function' ? next(query) : next;
    const qs = serializeExplorerQuery(q);
    const url = qs ? `${pathname}?${qs}` : pathname;
    if (opts?.push) { pushed.current = true; router.push(url, { scroll: false }); }
    else router.replace(url, { scroll: false });
  }, [query, router, pathname]);

  const backToUnits = useCallback(() => {
    if (pushed.current) { pushed.current = false; router.back(); return; }
    setQuery({ ...query, tab: 'units', focus: null, combo: 1 });
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
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/tft/explorer?${apiQs}`, { signal: controller.signal })
        .then(async r => {
          const body = await r.json().catch(() => null);
          if (!r.ok || !body) {
            const code: ExplorerError = r.status === 504 ? 'timeout'
              : body?.error === 'busy' ? 'busy'
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
    }, 250);
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

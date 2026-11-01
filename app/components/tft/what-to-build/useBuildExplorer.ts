'use client';
// Abfragen der Seite „What to build": eine Kette fuer alle Boxen, immer nur eine
// Abfrage unterwegs. Der Dienst rechnet auf einer Spur (MAX_RUNNING = 1, Schlange 8),
// und die Route deckelt 30 ungecachte Abfragen je Minute und IP. Eine Abfrage, die
// niemand mehr braucht, wird nicht gestartet; der Fehler einer Box stoppt die anderen nicht.
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { serializeExplorerQuery, type ExplorerQuery, type ExplorerResponse } from '../../../lib/tft-explorer-query';
import type { ExplorerError } from '../../../lib/useTftExplorer';
import { fetchExplorer } from '../unit/useUnitExplorer';

export type QueryResult = { data?: ExplorerResponse; error?: ExplorerError };

export const queryKey = (q: ExplorerQuery) => serializeExplorerQuery(q, { forApi: true });

// Einmal wiederholen, wenn der Dienst voll oder das Limit erreicht ist.
const RETRY_DEFAULT_MS = 5_000;
const RETRY_MAX_MS = 15_000;

async function fetchWithRetry(q: ExplorerQuery): Promise<ExplorerResponse> {
  try {
    return await fetchExplorer(q);
  } catch (err) {
    const e = err as { code?: ExplorerError; status?: number; retryAfter?: number | null };
    if (e.code !== 'busy' && e.status !== 429) throw err;
    const wait = e.retryAfter ? Math.min(e.retryAfter * 1000, RETRY_MAX_MS) : RETRY_DEFAULT_MS;
    await new Promise(r => setTimeout(r, wait));
    try {
      return await fetchExplorer(q);
    } catch (again) {
      const a = again as { code?: ExplorerError; status?: number };
      throw Object.assign(new Error('busy'), { code: a.status === 429 ? 'busy' : a.code });
    }
  }
}

export type QueryResults = Record<string, QueryResult>;

// results liegt bei der Seite: welche Abfragen sie will, haengt vom Ergebnis der
// Stern-Abfrage ab (Standard-Stern).
export function useBuildExplorer(queries: ExplorerQuery[], results: QueryResults, setResults: Dispatch<SetStateAction<QueryResults>>) {
  const [tick, setTick] = useState(0);
  const running = useRef(false);

  const keys = useMemo(() => queries.map(queryKey), [queries]);
  const joined = keys.join('\n');

  useEffect(() => {
    if (running.current) return;
    const at = keys.findIndex(k => !results[k]);
    if (at < 0) return;
    running.current = true;
    const key = keys[at];
    fetchWithRetry(queries[at])
      .then(data => setResults(r => ({ ...r, [key]: { data } })))
      .catch(err => setResults(r => ({ ...r, [key]: { error: (err as { code?: ExplorerError }).code || 'failed' } })))
      .finally(() => { running.current = false; setTick(n => n + 1); });
    // joined steht fuer keys/queries: gleiche Abfragen, gleicher Lauf.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined, results, tick]);

  const get = useCallback((q: ExplorerQuery | null): QueryResult | null => (q ? results[queryKey(q)] ?? null : null), [results]);
  const retry = useCallback((qs: ExplorerQuery[]) => {
    setResults(r => {
      const next = { ...r };
      for (const q of qs) delete next[queryKey(q)];
      return next;
    });
  }, [setResults]);
  return { get, retry };
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import ApiUnavailable from '../components/ApiUnavailable';
import { useI18n } from '../lib/i18n';
import { lolProfileHref, tftRegionLabel, type TftAccountHit } from '../lib/tft-player-search';

// Liste fuer /search. initialHits kommen aus dem Namensverzeichnis (exakter
// Name). Ist die Liste leer, zeigt die Seite Konten, deren Name mit der
// Eingabe beginnt. Faellt die Abfrage aus, steht dort ein Fehlerhinweis mit
// "Erneut versuchen" statt "Keine Spieler gefunden".

type State = 'loading' | 'ready' | 'error';

export default function LolSearchResults({ q, initialHits }: { q: string; initialHits: TftAccountHit[] }) {
  const { t } = useI18n();
  const [hits, setHits] = useState<TftAccountHit[]>(initialHits);
  const needsFetch = initialHits.length === 0 && q.replace(/\s/g, '').length >= 3;
  const [state, setState] = useState<State>(needsFetch ? 'loading' : 'ready');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!needsFetch) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/tft/search-players?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (!r.ok) throw new Error(String(r.status));
        const d: { players?: TftAccountHit[] } = await r.json();
        const list = d.players || [];
        // Genau ein Konto beginnt mit dem Namen: direkt dorthin.
        if (list.length === 1) { window.location.replace(lolProfileHref(list[0])); return; }
        setHits(list);
        setState('ready');
      } catch {
        if (!ctrl.signal.aborted) setState('error');
      }
    })();
    return () => ctrl.abort();
  }, [q, needsFetch, attempt]);

  const retry = useCallback(() => { setState('loading'); setAttempt(a => a + 1); }, []);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="search" />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-lg font-semibold text-white mb-4 break-words">
          {t('nav.search')}{q ? `: „${q}“` : ''}
        </h1>
        {state === 'loading' ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map(i => (
              <li key={i} className="h-14 rounded-lg bg-surface-raised animate-pulse" />
            ))}
          </ul>
        ) : state === 'error' ? (
          <ApiUnavailable badge={false} messageKey="error.temporarilyUnavailable" onRetry={retry} />
        ) : hits.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t('tft.search.noResults').replace('{q}', q)}</p>
        ) : (
          <ul className="space-y-2">
            {hits.map(h => {
              const region = tftRegionLabel(h.region);
              return (
                <li key={`${h.gameName}#${h.tagLine}@${h.region}`}>
                  <a
                    href={lolProfileHref(h)}
                    className="flex items-center justify-between gap-3 min-h-14 px-4 py-3 rounded-lg bg-surface-base border border-border-subtle hover:border-brand transition-colors"
                  >
                    <span className="min-w-0 truncate text-white">
                      {h.gameName}<span className="text-fg-secondary">#{h.tagLine}</span>
                    </span>
                    {region && <span className="shrink-0 px-2 py-0.5 rounded bg-surface-raised text-xs text-white font-medium">{region}</span>}
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Footer />
    </main>
  );
}

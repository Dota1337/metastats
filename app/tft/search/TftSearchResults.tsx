'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import { useI18n } from '../../lib/i18n';
import { tftProfileHref, tftRankLabel, tftRegionLabel, type TftAccountHit } from '../../lib/tft-player-search';

// Liste fuer /tft/search. initialHits kommen aus dem Namensverzeichnis. Ist
// die Liste leer, fragt die Seite Riot ueber die Standard-Tags; findet auch
// das nichts, zeigt sie Konten, deren Name mit der Eingabe beginnt.

export default function TftSearchResults({ q, initialHits }: { q: string; initialHits: TftAccountHit[] }) {
  const { t } = useI18n();
  const [hits, setHits] = useState<TftAccountHit[]>(initialHits);
  const [loading, setLoading] = useState(initialHits.length === 0 && q.length > 0);

  useEffect(() => {
    if (initialHits.length > 0 || !q) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const r = await fetch(`/api/tft/search-riot?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const d: { players?: TftAccountHit[] } = r.ok ? await r.json() : {};
        const riot = d.players || [];
        if (riot.length === 1) { window.location.replace(tftProfileHref(riot[0])); return; }
        if (riot.length > 1) setHits(riot);
        else if (q.replace(/\s/g, '').length >= 3) {
          const p = await fetch(`/api/tft/search-players?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
          const pd: { players?: TftAccountHit[] } = p.ok ? await p.json() : {};
          setHits(pd.players || []);
        }
      } catch {
        if (ctrl.signal.aborted) return;
      }
      setLoading(false);
    })();
    return () => ctrl.abort();
  }, [q, initialHits.length]);

  const tierName = (lower: string) => t(`tier.${lower}` as Parameters<typeof t>[0]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-lg font-semibold text-white mb-4 break-words">
          {t('nav.search')}{q ? `: „${q}“` : ''}
        </h1>
        {loading ? (
          <ul className="space-y-2" aria-busy="true">
            {[0, 1, 2].map(i => (
              <li key={i} className="h-14 rounded-lg bg-surface-raised animate-pulse" />
            ))}
          </ul>
        ) : hits.length === 0 ? (
          <p className="text-sm text-fg-secondary">{t('tft.search.noResults').replace('{q}', q)}</p>
        ) : (
          <ul className="space-y-2">
            {hits.map(h => {
              const rank = tftRankLabel(h, tierName);
              const region = tftRegionLabel(h.region);
              return (
                <li key={h.puuid}>
                  <a
                    href={tftProfileHref(h)}
                    className="flex items-center justify-between gap-3 min-h-14 px-4 py-3 rounded-lg bg-surface-base border border-border-subtle hover:border-brand transition-colors"
                  >
                    <span className="min-w-0 truncate text-white">
                      {h.gameName}<span className="text-fg-secondary">#{h.tagLine}</span>
                    </span>
                    <span className="flex items-center gap-2 shrink-0 text-xs text-fg-secondary">
                      {rank && <span className="hidden sm:inline">{rank}</span>}
                      {region && <span className="px-2 py-0.5 rounded bg-surface-raised text-white font-medium">{region}</span>}
                    </span>
                  </a>
                  {rank && <div className="sm:hidden px-4 pt-1 text-xs text-fg-secondary">{rank}</div>}
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

'use client';
import { useEffect, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import { listBookmarks, removeBookmark, type Bookmark } from '../../lib/bookmarks';
import { useI18n } from '../../lib/i18n';

// Local-only saved view. Reads from window.localStorage on mount and
// re-reads on the `metastats:bookmarks:change` event so toggles elsewhere
// stay in sync without a router round-trip.

export default function SavedPage() {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);

  useEffect(() => {
    setMounted(true);
    const refresh = () => setBookmarks(listBookmarks());
    refresh();
    window.addEventListener('metastats:bookmarks:change', refresh);
    return () => window.removeEventListener('metastats:bookmarks:change', refresh);
  }, []);

  const comps = bookmarks.filter(b => b.type === 'comp');
  const players = bookmarks.filter(b => b.type === 'player');

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="saved" />
      <TftHero pageTitle={t('tft.savedTitle')} />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 pt-2 pb-8">
        {!mounted ? (
          <div className="text-[#7a8aa0] text-center py-12 text-sm">…</div>
        ) : bookmarks.length === 0 ? (
          <div className="text-[#a0b0c5] text-center py-12 text-sm">
            {t('tft.savedEmpty')}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Section
              title={t('nav.comps')}
              empty={t('tft.savedEmptyComps')}
              items={comps}
              hrefOf={b => `/tft/comps/${encodeURIComponent(b.key)}`}
              onRemove={b => removeBookmark(b.type, b.key, b.region)}
            />
            <Section
              title={t('tft.players')}
              empty={t('tft.savedEmptyPlayers')}
              items={players}
              hrefOf={b => `/tft/player/${encodeURIComponent(b.key)}${b.region ? `?region=${b.region}` : ''}`}
              onRemove={b => removeBookmark(b.type, b.key, b.region)}
            />
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function Section({
  title, items, empty, hrefOf, onRemove,
}: {
  title: string;
  items: Bookmark[];
  empty: string;
  hrefOf: (b: Bookmark) => string;
  onRemove: (b: Bookmark) => void;
}) {
  return (
    <div>
      <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-2">{title}</h2>
      {items.length === 0 ? (
        <div className="text-[#7a8aa0] text-xs italic">{empty}</div>
      ) : (
        <div className="space-y-1.5">
          {items.map(b => (
            <div
              key={`${b.type}-${b.region || ''}-${b.key}`}
              className="flex items-center gap-2 bg-[#0d1526] border border-[#1e2a3a] rounded p-2"
            >
              <a
                href={hrefOf(b)}
                className="flex-1 min-w-0 text-white text-sm truncate hover:text-[#7B61FF] transition-colors"
              >
                {b.label}
              </a>
              {b.region && (
                <span className="text-[10px] uppercase text-[#7a8aa0] tabular-nums">{b.region}</span>
              )}
              <button
                onClick={() => onRemove(b)}
                title="Bookmark entfernen"
                className="text-[#5a6a80] hover:text-[#e44040] text-sm transition-colors"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Nav from '../../../components/Nav';
import Footer from '../../../components/Footer';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, tftIconUrl, type TftAssetsBundle } from '../../../lib/tft-cdragon';

interface Placement { cell: number; characterId: string; items?: string[] }
interface CommunityComp {
  id: string;
  slug: string;
  name: string;
  boardConfig: { placements: Placement[]; oppPlacements?: Placement[] };
  traitLabel: string | null;
  carryUnit: string | null;
  authorHandle: string | null;
  upvotes: number;
  views: number;
  createdAt: string;
}

type Sort = 'top' | 'recent';

export default function TftCommunityGalleryPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('top');
  const [comps, setComps] = useState<CommunityComp[]>([]);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [voting, setVoting] = useState<Set<string>>(new Set());

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tft/comps/community?sort=${sort}&limit=40`)
      .then(r => r.ok ? r.json() : { comps: [] })
      .then(d => { if (!cancelled) { setComps(d.comps || []); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sort]);

  async function upvote(id: string) {
    if (voting.has(id)) return;
    setVoting(s => new Set(s).add(id));
    try {
      const r = await fetch(`/api/tft/comps/community/${id}/upvote`, { method: 'POST' });
      const j = await r.json();
      if (j.upvotes != null) {
        setComps(cs => cs.map(c => c.id === id ? { ...c, upvotes: j.upvotes } : c));
      }
    } catch {} finally {
      setVoting(s => { const n = new Set(s); n.delete(id); return n; });
    }
  }

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-baseline justify-between mb-1">
          <h1 className="text-white text-2xl font-medium">{t('tft.community.title')}</h1>
          <a href="/tft/builder" className="text-[#a892ff] text-xs hover:underline">{t('tft.community.buildOwn')} →</a>
        </div>
        <p className="text-fg-secondary text-sm mb-5">{t('tft.community.subtitle')}</p>

        <div className="flex gap-1 mb-4">
          {(['top', 'recent'] as Sort[]).map(s => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 text-xs uppercase tracking-widest rounded border transition-colors ${
                sort === s
                  ? 'bg-accent border-accent text-white'
                  : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
              }`}
            >{t(`tft.community.sort.${s}` as TranslationKey)}</button>
          ))}
        </div>

        {loading && <div className="text-fg-secondary text-center py-8">…</div>}
        {!loading && comps.length === 0 && (
          <div className="text-fg-secondary text-center py-8">
            {t('tft.community.empty')}{' '}
            <a href="/tft/builder" className="text-[#a892ff] hover:underline">{t('tft.community.buildFirst')}</a>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {comps.map(c => {
            const carry = c.carryUnit && assets ? assets.champions[c.carryUnit] : null;
            const carryUrl = tftChampionTileUrl(assets, carry);
            const placements = c.boardConfig?.placements || [];
            return (
              <div key={c.id} className="bg-surface-base border border-border-subtle rounded p-3 hover:border-accent-a30 transition-colors">
                <div className="flex items-start gap-3 mb-2">
                  {carryUrl && c.carryUnit && (
                    <a
                      href={`/tft/units/${encodeURIComponent(c.carryUnit)}`}
                      title={carry?.name || c.carryUnit}
                      className="flex-shrink-0 hover:scale-105 transition-transform"
                    >
                      <img src={carryUrl} alt={carry?.name || ''} className="w-10 h-10 rounded border border-[#c39bff]/60" />
                    </a>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-semibold truncate">{c.name}</div>
                    {c.traitLabel && (
                      <div className="text-[#a892ff] text-xs truncate">{c.traitLabel}</div>
                    )}
                    <div className="text-fg-muted text-[11px]">
                      {c.authorHandle || 'anonymous'} · {timeAgo(c.createdAt)}
                      {c.views > 0 && ` · ${c.views} views`}
                    </div>
                  </div>
                  <button
                    onClick={() => upvote(c.id)}
                    disabled={voting.has(c.id)}
                    className="flex flex-col items-center gap-0.5 px-2.5 py-1.5 bg-surface-raised border border-border-subtle rounded hover:border-[#3ecf8e]/60 transition-colors disabled:opacity-50"
                  >
                    <span className="text-[#3ecf8e] text-sm leading-none">▲</span>
                    <span className="text-white text-[11px] tabular-nums font-medium">{c.upvotes}</span>
                  </button>
                </div>

                {/* Unit row */}
                <div className="flex gap-1 flex-wrap">
                  {placements.slice(0, 10).map((p, i) => {
                    const ch = assets?.champions[p.characterId];
                    const url = tftChampionTileUrl(assets, ch);
                    // Same nested-<a> fix as CompRow/CompCard: outer was an <a>
                    // for the unit, inner <a>s for items — invalid HTML. Outer
                    // is now a div with link semantics; inner item anchors
                    // remain real <a> tags (they stopPropagation).
                    const unitHref = `/tft/units/${encodeURIComponent(p.characterId)}`;
                    return (
                      <div
                        key={i}
                        role="link"
                        tabIndex={0}
                        onClick={(e) => {
                          if (e.defaultPrevented) return;
                          if (e.metaKey || e.ctrlKey) {
                            window.open(unitHref, '_blank', 'noopener');
                            return;
                          }
                          router.push(unitHref);
                        }}
                        onAuxClick={(e) => {
                          if (e.button === 1) {
                            e.preventDefault();
                            window.open(unitHref, '_blank', 'noopener');
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            router.push(unitHref);
                          }
                        }}
                        className="relative w-9 h-9 rounded overflow-hidden border block hover:scale-110 transition-transform cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-a60"
                        style={{ borderColor: ch ? costColorOf(ch.cost) : '#1e2a3a' }}
                        title={ch?.name || p.characterId}
                      >
                        {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
                        {p.items && p.items.length > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 flex gap-px bg-black/60">
                            {p.items.slice(0, 3).map((it, j) => {
                              const item = assets?.items[it];
                              const iurl = tftIconUrl(assets, item?.icon);
                              const itemName = item?.name || it;
                              return iurl ? (
                                <a
                                  key={j}
                                  href={`/tft/items/${encodeURIComponent(it)}`}
                                  onClick={e => e.stopPropagation()}
                                  title={itemName}
                                >
                                  <img src={iurl} alt={itemName} className="w-[11px] h-[11px]" />
                                </a>
                              ) : (
                                <div key={j} className="w-[11px] h-[11px] bg-surface-overlay" />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <Footer />
    </main>
  );
}

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

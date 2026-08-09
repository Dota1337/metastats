'use client';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  loadInitialFilters,
  persistFilters,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { itemBucketOf, ITEM_BUCKETS, type ItemBucket } from '../../lib/tft-item-bucket';
import { loadTierCutoffs, tierLetterOfSync, TIER_COLORS, type TierLetter } from '../../lib/tft-tier-letter';
import TftHero from '../../components/tft/TftHero';

interface ItemRow {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  topUsers: string[];
  velocity?: {
    deltaAvgPlacement?: number;
    deltaTop4Rate?: number;
    deltaPickRate?: number | null;
    prevGames?: number;
    prevAvgPlacement?: number;
    prevTop4Rate?: number;
    isNew?: boolean;
  };
}

export default function TftItemsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() => loadInitialFilters(new URLSearchParams(searchParams.toString())));
  const [hydrated, setHydrated] = useState(false);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);
  // Client-side bucket filter analog to /tft/units cost-filter pattern.
  // null = "Alle" (default). Other items (PsyOps base, AnimaSquad tier) fall
  // into "other" and are only reachable via "Alle".
  const [bucket, setBucket] = useState<ItemBucket | null>(null);
  const [search, setSearch] = useState('');
  const [tierCutoffs, setTierCutoffs] = useState<Awaited<ReturnType<typeof loadTierCutoffs>> | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => { loadTierCutoffs(assets?.set ?? null).then(setTierCutoffs); }, [assets?.set]);

  useEffect(() => {
    if (typeof window === 'undefined') { setHydrated(true); return; }
    const params = new URLSearchParams(window.location.search);
    const hasUrlFilters = ['patch', 'bucket', 'days', 'region', 'velocity']
      .some(k => params.has(k));
    if (!hasUrlFilters) {
      const stored = loadInitialFilters(params);
      setFilters(stored);
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/items?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setHasData(!!d.hasData);
        setItems(d.items || []);
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setHasData(false); setItems([]); setLoading(false); } });
    const url = `${pathname}?${qs}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
    if (hydrated) persistFilters(filters);
    return () => { cancelled = true; };
  }, [filters, hydrated, pathname, router]);

  const currentPatchLabel = patches[0]?.patch;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const inBucket = items.filter(it => {
      if (bucket && itemBucketOf(it.apiName, assets) !== bucket) return false;
      if (q) {
        const name = (assets?.items[it.apiName]?.name || it.apiName.replace(/^TFT\d+_Item_/, '')).toLowerCase();
        if (!name.includes(q) && !it.apiName.toLowerCase().includes(q)) return false;
      }
      return true;
    });
    // Sub-150-game items lose their tier-badge (Items min-games gate) — sorting
    // them to the bottom keeps the noisy 1.4-avg-with-56-games entries from
    // dominating the top of the list. Within each segment, existing avg-place
    // sort stays. tierCutoffs is loaded async, so during the brief window
    // before it lands we keep the original order.
    if (!tierCutoffs) return inBucket;
    const tiered: ItemRow[] = [];
    const untiered: ItemRow[] = [];
    for (const it of inBucket) {
      if (tierLetterOfSync({ avgPlacement: it.avgPlacement, pickRate: it.pickRate, games: it.games }, 'items', tierCutoffs)) {
        tiered.push(it);
      } else {
        untiered.push(it);
      }
    }
    return [...tiered, ...untiered];
  }, [items, bucket, search, assets, tierCutoffs]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="items" />
      <TftHero pageTitle={t('nav.items')} patch={currentPatchLabel} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="mb-3">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t('tft.search.items')}
            className="w-full sm:w-80 bg-surface-raised border border-border-subtle rounded px-3 py-1.5 text-sm text-white placeholder:text-fg-faint outline-none focus:border-[#7B61FF]/60"
          />
        </div>
        <div className="flex flex-wrap gap-1 mb-4">
          <button
            onClick={() => setBucket(null)}
            className={`px-3 py-1 rounded text-xs ${bucket == null ? 'bg-[#7B61FF] text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
          >
            {t('tft.item.bucket.all')}
          </button>
          {ITEM_BUCKETS.map(b => (
            <button
              key={b}
              onClick={() => setBucket(b)}
              className={`px-3 py-1 rounded text-xs ${bucket === b ? 'bg-[#7B61FF] text-white' : 'bg-surface-raised text-fg-secondary hover:text-white'}`}
            >
              {t(`tft.item.bucket.${b}` as any)}
            </button>
          ))}
        </div>

        {loading && hasData === null && (
          <div className="text-fg-muted text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && filtered.length > 0 && (
          <div className="bg-surface-base border border-border-subtle rounded overflow-hidden">
            {/* Grid: icon (3rem) → name (12rem) → TopUsers (1fr, grows to
                fill the row) → 4 stat columns. Name moves from 1fr to a
                fixed 12rem so the TopUsers row gets the slack — that's
                where the cost-bordered champion tiles want to breathe. */}
            <div className={`hidden md:grid ${filters.velocity > 0 ? 'grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 text-[11px] text-fg-secondary font-semibold whitespace-nowrap bg-surface-sunken`}>
              <div></div>
              <div></div>
              <div>{t('nav.items')}</div>
              <div>{t('tft.topUsers')}</div>
              <div className="text-center">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
            </div>
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-fg-muted bg-surface-sunken">
              {t('nav.items')}
            </div>
            {filtered.map(it => {
              const meta = assets?.items[it.apiName];
              const url = tftIconUrl(assets, meta?.icon);
              const letter = tierCutoffs ? tierLetterOfSync({ avgPlacement: it.avgPlacement, pickRate: it.pickRate, games: it.games }, 'items', tierCutoffs) : null;
              return (
                <a
                  key={it.apiName}
                  href={`/tft/items/${encodeURIComponent(it.apiName)}?bucket=${filters.bucket}`}
                  className={`block md:grid ${filters.velocity > 0 ? 'md:grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[2rem_3rem_12rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-3 px-4 py-2.5 md:items-center text-[13px] sm:text-sm hover:bg-white/5 border-t border-border-subtle`}
                >
                  <div className="hidden md:flex justify-center">
                    <TierBadge letter={letter} t={t} />
                  </div>
                  <div className="flex items-center gap-3 md:contents">
                    <div className="md:hidden">
                      <TierBadge letter={letter} t={t} />
                    </div>
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-10 h-10 rounded-md flex-shrink-0 shadow-sm" />
                    ) : (
                      <div className="w-10 h-10 rounded-md bg-surface-overlay flex items-center justify-center text-[9px] text-fg-muted px-0.5 text-center flex-shrink-0">{prettyApi(it.apiName)}</div>
                    )}
                    <div className="text-white font-medium truncate flex-1 md:flex-initial">{meta?.name || prettyApi(it.apiName)}</div>
                  </div>
                  {/* Top users — 8 cost-bordered champion tiles. On mobile
                      the row still scrolls horizontally (overflow-x-auto)
                      because 8×32px doesn't fit on small screens; on
                      desktop the column is wide enough to render them all
                      inline without scrolling. */}
                  <div className="flex items-center gap-1.5 mt-2 md:mt-0 pl-12 md:pl-6 overflow-x-auto md:overflow-visible">
                    {(it.topUsers || []).slice(0, 8).map((cid, i) => {
                      const ch = assets?.champions[cid];
                      const tileUrl = tftChampionTileUrl(assets, ch);
                      const fallbackUrl = tftIconUrl(assets, ch?.icon);
                      const borderColor = costToColor(ch?.cost ?? 1);
                      return (
                        <a
                          key={i}
                          href={`/tft/units/${encodeURIComponent(cid)}?bucket=${filters.bucket}`}
                          onClick={e => e.stopPropagation()}
                          className="w-10 h-10 rounded-md border-2 overflow-hidden flex-shrink-0 hover:scale-110 transition shadow-sm"
                          style={{ borderColor }}
                          title={ch?.name}
                        >
                          {tileUrl ? (
                            <img
                              src={tileUrl}
                              alt={ch?.name || ''}
                              className="w-full h-full object-cover"
                              onError={e => {
                                const img = e.currentTarget;
                                if (fallbackUrl && img.src !== fallbackUrl) img.src = fallbackUrl;
                              }}
                            />
                          ) : (
                            <div className="w-full h-full bg-surface-overlay" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                  {/* Stats: 4-column grid on mobile under the icon/users
                      block; explicit cells on desktop via contents. */}
                  <div className={`grid ${filters.velocity > 0 ? 'grid-cols-6' : 'grid-cols-5'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={it.avgPlacement?.toFixed(2) ?? '—'} accent="white" align="center" />
                    <Cell label={t('tft.pickRate')} value={it.pickRate != null ? `${(it.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top1')} value={it.top1Rate != null ? `${(it.top1Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(it.games)} accent="muted" />
                    {filters.velocity > 0 && (
                      <DeltaCell velocity={it.velocity} label={t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))} />
                    )}
                  </div>
                </a>
              );
            })}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function prettyApi(s: string) { return s.replace(/^TFT\d*_Item_/, '').slice(0, 10); }

function TierBadge({ letter, t }: { letter: TierLetter | null; t: (k: any) => string }) {
  if (!letter) {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-6 rounded text-[10px] font-medium text-fg-faint bg-surface-raised border border-border-subtle"
        title={t('tft.tier.tooltip.empty')}
      >—</span>
    );
  }
  const color = TIER_COLORS[letter];
  return (
    <span
      className="inline-flex items-center justify-center w-7 h-6 rounded text-[11px] font-bold tabular-nums"
      style={{ color, backgroundColor: `${color}1f`, border: `1px solid ${color}50` }}
      title={t(`tft.tier.tooltip.${letter}` as any)}
    >{letter}</span>
  );
}

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}

// Same reflow trick as /tft/units — mobile shows label-above-value pairs
// in a 4-col grid, desktop pulls the value through to the parent grid via
// `display: contents`. Wait — there are 5 desktop columns (avg/pick/top4/
// games hidden on mobile but visible on desktop), but Cell only emits 1
// desktop cell. The extra `<div className="hidden md:block">{games}</div>`
// after the Cells covers the 5th column.
function Cell({ label, value, accent, align = 'right' }: { label: string; value: string; accent?: 'white' | 'muted'; align?: 'right' | 'center' }) {
  const valueClass = accent === 'white' ? 'text-white' : accent === 'muted' ? 'text-fg-muted' : 'text-fg-secondary';
  const alignClass = align === 'center' ? 'text-center' : 'text-right';
  return (
    <>
      <div className="md:hidden">
        <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block ${alignClass} ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}

// Δ-Spalte für den Velocity-Vergleich (W1-A). Negative Δ-avg-place = besser
// geworden = grün; positive = schlechter = rot. "NEW" wenn Item im
// Vergleichsfenster keine Sample-Size hat.
function DeltaCell({ velocity, label }: { velocity?: { deltaAvgPlacement?: number; isNew?: boolean }; label: string }) {
  if (!velocity) {
    return (
      <>
        <div className="md:hidden">
          <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
          <div className="text-fg-faint tabular-nums leading-tight">—</div>
        </div>
        <div className="hidden md:block text-right text-fg-faint tabular-nums">—</div>
      </>
    );
  }
  if (velocity.isNew) {
    return (
      <>
        <div className="md:hidden">
          <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
          <div className="text-[#7B61FF] tabular-nums leading-tight">NEW</div>
        </div>
        <div className="hidden md:block text-right text-[#7B61FF] tabular-nums">NEW</div>
      </>
    );
  }
  const d = velocity.deltaAvgPlacement ?? 0;
  const sign = d < 0 ? '−' : d > 0 ? '+' : '';
  const color = d < -0.02 ? '#3ecf8e' : d > 0.02 ? '#e44040' : '#a0b0c5';
  const display = `${sign}${Math.abs(d).toFixed(2)}`;
  return (
    <>
      <div className="md:hidden">
        <div className="text-fg-muted text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className="tabular-nums leading-tight font-medium" style={{ color }}>{display}</div>
      </div>
      <div className="hidden md:block text-right tabular-nums font-medium" style={{ color }}>{display}</div>
    </>
  );
}

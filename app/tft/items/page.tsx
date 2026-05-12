'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  filtersFromSearchParams,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftIconUrl, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface ItemRow {
  apiName: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  pickRate: number | null;
  topUsers: string[];
}

export default function TftItemsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() => filtersFromSearchParams(new URLSearchParams(searchParams.toString())));
  const [items, setItems] = useState<ItemRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/items?${qs}`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setItems(d.items || []);
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => { setHasData(false); setItems([]); setLoading(false); });
    const url = `${pathname}?${qs}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, pathname, router]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="items" />
      <TftHero pageTitle={t('nav.items')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        {loading && hasData === null && (
          <div className="text-[#4a5a70] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && items.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className="hidden md:grid grid-cols-[3rem_1fr_11rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>{t('nav.items')}</div>
              <div>{t('tft.topUsers')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-[#4a5a70] bg-[#0a0e1a]">
              {t('nav.items')}
            </div>
            {items.map(it => {
              const meta = assets?.items[it.apiName];
              const url = tftIconUrl(assets, meta?.icon);
              return (
                <a
                  key={it.apiName}
                  href={`/tft/items/${encodeURIComponent(it.apiName)}?bucket=${filters.bucket}`}
                  className="block md:grid md:grid-cols-[3rem_1fr_11rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 md:items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  {/* Icon + name row — icon on left, name flows on mobile;
                      on desktop participates in the parent grid via contents. */}
                  <div className="flex items-center gap-3 md:contents">
                    {url ? (
                      <img src={url} alt={meta!.name} className="w-9 h-9 rounded flex-shrink-0" />
                    ) : (
                      <div className="w-9 h-9 rounded bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#4a5a70] px-0.5 text-center flex-shrink-0">{prettyApi(it.apiName)}</div>
                    )}
                    <div className="text-white truncate flex-1 md:flex-initial">{meta?.name || prettyApi(it.apiName)}</div>
                  </div>
                  {/* Top users — scrolls horizontally on mobile so a 5-icon
                      row never blocks the column from rendering at all. */}
                  <div className="flex items-center gap-1.5 mt-2 md:mt-0 pl-12 md:pl-0 overflow-x-auto">
                    {(it.topUsers || []).slice(0, 5).map((cid, i) => {
                      const ch = assets?.champions[cid];
                      const tileUrl = tftChampionTileUrl(assets, ch);
                      const fallbackUrl = tftIconUrl(assets, ch?.icon);
                      const borderColor = costToColor(ch?.cost ?? 1);
                      return (
                        <a
                          key={i}
                          href={`/tft/units/${encodeURIComponent(cid)}?bucket=${filters.bucket}`}
                          onClick={e => e.stopPropagation()}
                          className="w-8 h-8 rounded border-2 overflow-hidden flex-shrink-0 hover:scale-110 transition"
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
                            <div className="w-full h-full bg-[#1e2a3a]" />
                          )}
                        </a>
                      );
                    })}
                  </div>
                  {/* Stats: 4-column grid on mobile under the icon/users
                      block; explicit cells on desktop via contents. */}
                  <div className="grid grid-cols-4 gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents">
                    <Cell label={t('tft.avgPlacement')} value={it.avgPlacement?.toFixed(2) ?? '—'} accent="white" />
                    <Cell label={t('tft.pickRate')} value={it.pickRate != null ? `${(it.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.gamesShort')} value={String(it.games)} accent="muted" />
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

function costToColor(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}

// Same reflow trick as /tft/units — mobile shows label-above-value pairs
// in a 4-col grid, desktop pulls the value through to the parent grid via
// `display: contents`. Wait — there are 5 desktop columns (avg/pick/top4/
// games hidden on mobile but visible on desktop), but Cell only emits 1
// desktop cell. The extra `<div className="hidden md:block">{games}</div>`
// after the Cells covers the 5th column.
function Cell({ label, value, accent }: { label: string; value: string; accent?: 'white' | 'muted' }) {
  const valueClass = accent === 'white' ? 'text-white' : accent === 'muted' ? 'text-[#4a5a70]' : 'text-[#8a9bb0]';
  return (
    <>
      <div className="md:hidden">
        <div className="text-[#4a5a70] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block text-right ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}

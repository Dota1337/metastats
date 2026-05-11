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
import { loadTftAssets, tftIconUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
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
            <div className="hidden md:grid grid-cols-[3rem_1fr_12rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 text-[10px] uppercase text-[#4a5a70] bg-[#0a0e1a]">
              <div></div>
              <div>{t('nav.items')}</div>
              <div>{t('tft.topUsers')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            {items.map(it => {
              const meta = assets?.items[it.apiName];
              const url = tftIconUrl(assets, meta?.icon);
              return (
                <a
                  key={it.apiName}
                  href={`/tft/items/${encodeURIComponent(it.apiName)}?bucket=${filters.bucket}`}
                  className="grid grid-cols-[3rem_1fr_12rem_5rem_5rem_5rem_5rem] gap-2 px-4 py-2 items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]"
                >
                  {url ? (
                    <img src={url} alt={meta!.name} className="w-9 h-9 rounded" />
                  ) : (
                    <div className="w-9 h-9 rounded bg-[#1e2a3a] flex items-center justify-center text-[8px] text-[#4a5a70] px-0.5 text-center">{prettyApi(it.apiName)}</div>
                  )}
                  <div className="text-white">{meta?.name || prettyApi(it.apiName)}</div>
                  <div className="flex items-center gap-1.5">
                    {(it.topUsers || []).slice(0, 5).map((cid, i) => {
                      const ch = assets?.champions[cid];
                      const curl = tftIconUrl(assets, ch?.icon);
                      return curl ? (
                        <img key={i} src={curl} alt={ch?.name || ''} title={ch?.name} className="w-9 h-9 rounded" />
                      ) : (
                        <div key={i} className="w-9 h-9 rounded bg-[#1e2a3a]" />
                      );
                    })}
                  </div>
                  <div className="text-right text-white">{it.avgPlacement?.toFixed(2) ?? '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{it.pickRate != null ? `${(it.pickRate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#8a9bb0]">{it.top4Rate != null ? `${(it.top4Rate * 100).toFixed(1)}%` : '—'}</div>
                  <div className="text-right text-[#4a5a70]">{it.games}</div>
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

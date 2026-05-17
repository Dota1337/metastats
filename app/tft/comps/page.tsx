'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import CompRow from '../../components/tft/CompRow';
import StatsFilterBar, {
  filtersFromSearchParams,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

// Filter shape and URL-sync mirror /tft/units and /tft/items so the
// three stats pages behave identically (patch / bucket / days / region).
// CompList stays as-is for the TFT landing page (compact widget).
export default function TftCompsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() =>
    filtersFromSearchParams(new URLSearchParams(searchParams.toString())),
  );
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [minGames, setMinGames] = useState<number | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/comps?${qs}&source=data`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setComps(d.comps || []);
        setPatches(d.patches || []);
        setMinGames(typeof d.minGames === 'number' ? d.minGames : null);
        setLoading(false);
      })
      .catch(() => { setHasData(false); setComps([]); setLoading(false); });
    const url = `${pathname}?${qs}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, pathname, router]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && comps.length > 0 && (
          <>
            <div className="hidden sm:grid grid-cols-[1.25rem_1.5rem_2.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem] items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#7a8aa0]">
              <div></div>
              <div></div>
              <div></div>
              <div>{t('nav.comps')}</div>
              <div></div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
            </div>
            <div className="space-y-1">
              {comps.map((c, i) => (
                <CompRow
                  key={c.slug}
                  comp={c}
                  rank={i + 1}
                  assets={assets}
                  href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${filters.bucket}&region=${filters.region}`}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <Footer />
    </main>
  );
}

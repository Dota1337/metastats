'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import EmptyData from '../../components/tft/EmptyData';
import CompRow from '../../components/tft/CompRow';
import StatsFilterBar, {
  loadInitialFilters,
  persistFilters,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';
import AdvancedCompFilters, {
  ADV_DEFAULT,
  advFromUrlParam,
  advToUrlParam,
  applyAdvancedFilters,
  type AdvancedFilters,
} from '../../components/tft/AdvancedCompFilters';

// Filter shape and URL-sync mirror /tft/units and /tft/items so the
// three stats pages behave identically (patch / bucket / days / region).
// CompList stays as-is for the TFT landing page (compact widget).
export default function TftCompsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [filters, setFilters] = useState<Filters>(() =>
    loadInitialFilters(new URLSearchParams(searchParams.toString())),
  );
  const [adv, setAdv] = useState<AdvancedFilters>(() =>
    advFromUrlParam(searchParams.get('adv')),
  );
  const [sortBy, setSortBy] = useState<'avg' | 'win' | 'top4' | 'pick' | 'velocity'>(
    (searchParams.get('sort') as any) || 'avg',
  );
  // Whether the user manually picked a sort. As long as they haven't, toggling
  // the Δ-filter automatically promotes "Trending" so the column they just
  // enabled actually drives the order — otherwise the new column would render
  // but the rows would stay sorted by avg-placement, which made the feature
  // look broken in earlier sessions.
  const [sortTouched, setSortTouched] = useState<boolean>(() => searchParams.has('sort'));
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
    // Filter in localStorage spiegeln → bei nächstem fresh visit (neuer Tab,
    // Bookmark ohne Params) startet die Page mit der gleichen Persona.
    persistFilters(filters);
    const advParam = advToUrlParam(adv);
    // Sort in URL persistieren wenn vom User explizit gewählt — sonst fiel
    // er beim Reload immer auf 'avg' zurück.
    const sortParam = sortTouched && sortBy !== 'avg' ? `&sort=${sortBy}` : '';
    const url = `${pathname}?${qs}${advParam ? `&adv=${advParam}` : ''}${sortParam}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
  }, [filters, adv, sortBy, sortTouched, pathname, router]);

  // Filter-change handler that also auto-flips the sort to "Trending" the
  // first time the user enables Δ — and back to "avg" when they turn it off.
  // Skips if they've explicitly chosen a sort already, so a manual decision
  // is never overridden. Done in the change handler instead of an effect to
  // avoid the setState-within-effect cascade lint flags warn about.
  const handleFiltersChange = (next: Filters) => {
    if (!sortTouched) {
      if (next.velocity > 0 && filters.velocity === 0) setSortBy('velocity');
      else if (next.velocity === 0 && filters.velocity > 0) setSortBy('avg');
    }
    setFilters(next);
  };

  const currentPatchLabel = patches[0]?.patch;

  // Apply advanced filters BEFORE sort so the result count + sort target match.
  // Client-side filter on the already-loaded comps — no extra API roundtrip.
  // Carry-Cost-Lookup: cluster_key = "<trait>@<level>_<carryCharacterId>".
  // Bundle-Champions tragen den Cost direkt; null wenn der Carry-Asset fehlt
  // (stale Carry-ID nach Set-Wechsel).
  const carryCostLookup = (clusterKey: string): number | null => {
    if (!assets) return null;
    const m = /^(.+)@\d+_(.+)$/.exec(clusterKey);
    if (!m) return null;
    const ch = assets.champions[m[2]];
    return typeof ch?.cost === 'number' ? ch.cost : null;
  };
  const filteredComps = applyAdvancedFilters(comps, adv, { carryCostLookup });
  const sortedComps = (() => {
    if (filteredComps.length === 0) return filteredComps;
    const copy = [...filteredComps];
    switch (sortBy) {
      case 'win':   copy.sort((a, b) => (b.top1Rate ?? 0) - (a.top1Rate ?? 0)); break;
      case 'top4':  copy.sort((a, b) => (b.top4Rate ?? 0) - (a.top4Rate ?? 0)); break;
      case 'pick':  copy.sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0)); break;
      case 'velocity':
        // Most-improved first (most-negative Δ = biggest jump up in placement).
        // Comps with null Δ (new comps or below sample-size threshold) fall to
        // the bottom so the trending set always reads top-down.
        copy.sort((a, b) => {
          const da = a.velocity?.deltaAvgPlace ?? Infinity;
          const db = b.velocity?.deltaAvgPlace ?? Infinity;
          return da - db;
        });
        break;
      case 'avg':
      default:      copy.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
    }
    return copy;
  })();

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('nav.comps')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={handleFiltersChange} />

        <AdvancedCompFilters
          filters={adv}
          onChange={setAdv}
          resultCount={filteredComps.length}
          totalCount={comps.length}
        />

        <div className="flex items-center justify-end gap-2 mb-3 -mt-1 text-xs">
          <span className="text-[#7a8aa0]">{t('tft.sortBy')}:</span>
          <select
            value={sortBy}
            onChange={e => { setSortTouched(true); setSortBy(e.target.value as any); }}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          >
            <option value="avg">{t('tft.avgPlacement')}</option>
            <option value="top4">{t('tft.top4')}</option>
            <option value="win">{t('tft.top1')}</option>
            <option value="pick">{t('tft.pickRate')}</option>
            {filters.velocity > 0 && (
              <option value="velocity">{t('tft.velocity.trending')}</option>
            )}
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && sortedComps.length > 0 && (
          <>
            <div className={`hidden sm:grid items-center gap-3 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[#7a8aa0] ${
              filters.velocity > 0
                ? 'grid-cols-[1.25rem_1.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_3.5rem_1.25rem]'
                : 'grid-cols-[1.25rem_1.5rem_minmax(11rem,1fr)_minmax(0,auto)_3rem_3rem_3rem_3rem_3rem_1.25rem]'
            }`}>
              <div></div>
              <div></div>
              <div>{t('nav.comps')}</div>
              <div></div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
              <div className="text-right">{t('tft.top4')}</div>
              <div className="text-right">{t('tft.top1')}</div>
              <div className="text-right">{t('tft.pickRate')}</div>
              <div className="text-right">{t('tft.gamesShort')}</div>
              {filters.velocity > 0 && (
                <div className="text-right text-[#c39bff]">
                  {t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))}
                </div>
              )}
              <div></div>
            </div>
            <div className="space-y-1">
              {sortedComps.map((c, i) => (
                <CompRow
                  key={c.slug}
                  comp={c}
                  rank={i + 1}
                  assets={assets}
                  href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${filters.bucket}&region=${filters.region}`}
                  showVelocity={filters.velocity > 0}
                  velocityShift={filters.velocity}
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

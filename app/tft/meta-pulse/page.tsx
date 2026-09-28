'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import EmptyData from '../../components/tft/EmptyData';
import StatsFilterBar, {
  filtersFromSearchParams,
  filtersToQueryString,
  type Filters,
  type PatchInfo,
} from '../../components/tft/StatsFilterBar';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { dedupeByPrimaryCluster, primaryClusterKey, parseClusterKey } from '../../lib/tft-cluster';
import { compDefiningAugmentApiNameFromSlug, shownAugmentSlug } from '../../lib/tft-comp-defining-augments';
import RegionCompare, { REGION_COMPARE_DEFAULT, parseCompareRegions } from '../../components/tft/RegionCompare';

// W5: Meta-Pulse Landing:
//   • Trending (was bewegt sich jetzt) — folgt jetzt dem Δ-Vergleich-Filter
//   • Patch-Movers (was hat der aktuelle Patch entschieden)
//   • Regionsvergleich (Units in 2-3 Regionen nebeneinander, ?cmp=)

interface MetaPulse {
  hasData: boolean;
  currentPatch: string | null;
  previousPatch: string | null;
  selectedPatch?: string | null;
  comparePatch?: string | null;
  bucket: string;
  requestedDays: number;
  velocityShift: number;
  velocityMode?: 'patch' | 'crossPatch';
  patches: PatchInfo[];
  rising: { clusterKey: string; deltaAvgPlace: number; avgPlaceNow: number; gamesNow: number }[];
  patchWinners: { key: string; currentAvgPlacement: number; deltaAvgPlacement: number; currentGames: number }[];
  patchLosers: { key: string; currentAvgPlacement: number; deltaAvgPlacement: number; currentGames: number }[];
  counts: { rising: number; patchSampled: number };
}

export default function TftMetaPulsePage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // Default Δ-shift = 3 days when the URL hasn't picked one. The Meta-Pulse
  // page is the velocity view by definition — "off" isn't a valid state here,
  // unlike the comps list where the Δ column is opt-in.
  const [filters, setFilters] = useState<Filters>(() => {
    const f = filtersFromSearchParams(new URLSearchParams(searchParams.toString()));
    if (f.velocity === 0) f.velocity = 3;
    if (!searchParams.has('bucket')) f.bucket = 'master_plus';
    return f;
  });
  const [compareRegions, setCompareRegions] = useState<string[]>(() => parseCompareRegions(searchParams.get('cmp')));
  const [data, setData] = useState<MetaPulse | null>(null);
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const qs = filtersToQueryString(filters);
    fetch(`/api/tft/meta-pulse?${qs}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setData(null); setLoading(false); } });
    // cmp nur, wenn vom Standard abweichend — sonst bleibt die URL wie bisher.
    const cmp = compareRegions.join(',') === REGION_COMPARE_DEFAULT.join(',') ? '' : `&cmp=${compareRegions.join(',')}`;
    const url = `${pathname}?${qs}${cmp}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
    return () => { cancelled = true; };
  }, [filters, compareRegions, pathname, router]);

  // Aggregat-Sichten dedupliziert nach Primary-Cluster (trait+carry+star+aug):
  // sub-cluster mit unterschiedlichen Secondary-Carry-Suffixen werden zur
  // Hauptform zusammengefasst, damit User nicht zwei optisch identische
  // Comps untereinander sieht. Behalte den games-stärksten Sub-Cluster als
  // Display, strippe den Secondary-Suffix.
  const risingDedup = data?.rising
    ? dedupeByPrimaryCluster(data.rising, r => r.clusterKey, r => r.gamesNow,
        g => {
          const top = [...g].sort((a, b) => b.gamesNow - a.gamesNow)[0];
          return { ...top, clusterKey: primaryClusterKey(top.clusterKey) };
        })
    : [];
  const patchWinnersDedup = data?.patchWinners
    ? dedupeByPrimaryCluster(data.patchWinners, r => r.key, r => r.currentGames,
        g => {
          const top = [...g].sort((a, b) => b.currentGames - a.currentGames)[0];
          return { ...top, key: primaryClusterKey(top.key) };
        })
    : [];
  const patchLosersDedup = data?.patchLosers
    ? dedupeByPrimaryCluster(data.patchLosers, r => r.key, r => r.currentGames,
        g => {
          const top = [...g].sort((a, b) => b.currentGames - a.currentGames)[0];
          return { ...top, key: primaryClusterKey(top.key) };
        })
    : [];
  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.metaPulse.title')} subtitle={t('tft.metaPulse.subtitle')} patch={data?.selectedPatch || data?.currentPatch || undefined} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={data?.patches || []} onChange={setFilters} />

        {loading && (
          <div className="text-fg-muted text-center py-12">…</div>
        )}
        {!loading && !data?.hasData && <EmptyData />}

        {data?.hasData && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Rising — biggest Δ-avg-place vs the user-selected Δ window. */}
            <PulseSection
              title={t('tft.metaPulse.rising')}
              accent="#3ecf8e"
              empty={data.rising.length === 0}
              footer={data.velocityMode === 'crossPatch' && data.previousPatch
                ? t('tft.metaPulse.vsPatch').replace('{p}', data.previousPatch)
                : t('tft.velocity.deltaVs').replace('{n}', String(data.velocityShift))}
            >
              {risingDedup.map(r => (
                <PulseRow
                  key={r.clusterKey}
                  clusterKey={r.clusterKey}
                  assets={assets}
                  bucket={filters.bucket}
                  primary={`Ø ${r.avgPlaceNow.toFixed(2)}`}
                  secondary={`Δ ${r.deltaAvgPlace >= 0 ? '+' : ''}${r.deltaAvgPlace.toFixed(2)}`}
                  secondaryColor={r.deltaAvgPlace < 0 ? '#3ecf8e' : '#e44040'}
                  meta={`${r.gamesNow} ${t('tft.gamesShort')}`}
                />
              ))}
            </PulseSection>

            <PulseSection
              title={t('tft.metaPulse.patchWinners')}
              accent="#e0c75a"
              empty={data.patchWinners.length === 0}
              footer={data.comparePatch ? `${data.comparePatch} → ${data.selectedPatch}` : undefined}
            >
              {patchWinnersDedup.map(r => (
                <PulseRow
                  key={r.key}
                  clusterKey={r.key}
                  assets={assets}
                  bucket={filters.bucket}
                  primary={`Ø ${r.currentAvgPlacement.toFixed(2)}`}
                  secondary={`Δ ${r.deltaAvgPlacement.toFixed(2)}`}
                  secondaryColor={r.deltaAvgPlacement < 0 ? '#3ecf8e' : '#e44040'}
                  meta={`${r.currentGames} ${t('tft.gamesShort')}`}
                />
              ))}
            </PulseSection>

            <PulseSection
              title={t('tft.metaPulse.patchLosers')}
              accent="#e44040"
              empty={data.patchLosers.length === 0}
              footer={data.comparePatch ? `${data.comparePatch} → ${data.selectedPatch}` : undefined}
            >
              {patchLosersDedup.map(r => (
                <PulseRow
                  key={r.key}
                  clusterKey={r.key}
                  assets={assets}
                  bucket={filters.bucket}
                  primary={`Ø ${r.currentAvgPlacement.toFixed(2)}`}
                  secondary={`Δ +${r.deltaAvgPlacement.toFixed(2)}`}
                  secondaryColor="#e44040"
                  meta={`${r.currentGames} ${t('tft.gamesShort')}`}
                />
              ))}
            </PulseSection>
          </div>
        )}

        {data?.hasData && (
          <RegionCompare
            regions={compareRegions}
            onRegionsChange={setCompareRegions}
            bucket={data.bucket}
            days={filters.days}
            patch={data.selectedPatch || data.currentPatch}
            assets={assets}
          />
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-6">
          <a
            href="/tft/regions"
            className="block bg-surface-base border border-border-subtle rounded p-4 hover:border-[#c39bff]/40 transition-colors"
          >
            <div className="text-fg-secondary text-[10px] uppercase tracking-widest">{t('tft.metaPulse.shortcut')}</div>
            <div className="text-white text-base font-medium mt-1">{t('tft.regions.title')} →</div>
            <div className="text-fg-muted text-xs mt-0.5">{t('tft.regions.subtitle')}</div>
          </a>
        </div>
      </div>
      <Footer />
    </main>
  );
}

function PulseSection({
  title, accent, children, empty, footer,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
  empty?: boolean;
  footer?: string;
}) {
  return (
    <section className="bg-surface-base border border-border-subtle rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-widest" style={{ color: accent }}>{title}</h2>
        {footer && <span className="text-fg-muted text-[10px] tabular-nums">{footer}</span>}
      </div>
      {empty ? (
        <div className="text-fg-faint text-xs text-center py-6">—</div>
      ) : (
        <div className="space-y-1.5">{children}</div>
      )}
    </section>
  );
}

function PulseRow({
  clusterKey, assets, primary, secondary, secondaryColor, meta, bucket,
}: {
  clusterKey: string;
  assets: TftAssetsBundle | null;
  primary: string;
  secondary: string;
  secondaryColor: string;
  meta: string;
  bucket: string;
}) {
  const parts = parseClusterKey(clusterKey);
  const traitName = parts && assets
    ? (assets.traits[parts.trait]?.name || parts.trait.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''))
    : '';
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const carryName = carry?.name || (parts ? parts.carry.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '') : '');
  const carryUrl = tftChampionTileUrl(assets, carry);
  const augSlug = shownAugmentSlug(parts?.augmentSlug);
  const augApiName = augSlug ? compDefiningAugmentApiNameFromSlug(augSlug) : null;
  const augName = (augApiName && assets ? assets.items[augApiName]?.name : null) || augSlug;

  return (
    <a
      href={`/tft/comps/${encodeURIComponent(clusterKey)}?bucket=${bucket}`}
      className="block bg-surface-raised border border-border-subtle rounded p-2 hover:border-accent-a40 transition-colors"
    >
      <div className="flex items-center gap-2">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-8 h-8 rounded border-2 border-[#c39bff]/60 object-cover flex-shrink-0" />
        ) : (
          <div className="w-8 h-8 rounded bg-surface-overlay flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white text-[11px] truncate flex items-center gap-1">
            <span className="truncate">{traitName} · {carryName}</span>
            {parts?.carryStar === 3 && (
              <span
                className="inline-flex items-center px-1 py-[1px] rounded text-[8px] font-semibold tabular-nums flex-shrink-0"
                style={{ color: '#e0c75a', backgroundColor: 'rgba(224,199,90,0.15)', border: '1px solid rgba(224,199,90,0.4)' }}
              >3★</span>
            )}
            {augName && (
              <span
                className="inline-flex items-center px-1 py-[1px] rounded text-[8px] font-medium flex-shrink-0"
                style={{ color: '#c39bff', backgroundColor: 'rgba(123,97,255,0.12)', border: '1px solid rgba(123,97,255,0.4)' }}
              >{augName}</span>
            )}
          </div>
          <div className="text-fg-muted text-[10px] tabular-nums">{meta}</div>
        </div>
        <div className="text-right">
          <div className="text-white text-xs tabular-nums">{primary}</div>
          <div className="text-[10px] tabular-nums" style={{ color: secondaryColor }}>{secondary}</div>
        </div>
      </div>
    </a>
  );
}

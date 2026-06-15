'use client';
import { useEffect, useState, useMemo } from 'react';
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
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import TftHero from '../../components/tft/TftHero';

interface UnitVelocity {
  deltaAvgPlace: number | null;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  gamesNow: number;
  gamesPrev: number;
  isNew: boolean;
}

interface UnitRow {
  characterId: string;
  games: number;
  avgPlacement: number | null;
  top4Rate: number | null;
  top1Rate: number | null;
  pickRate: number | null;
  velocity?: UnitVelocity | null;
}

export default function TftUnitsPage() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // useState-Init im SSR-Pass kennt kein window → loadInitialFilters fällt
  // dort auf URL-only zurück. Separater Init-Effekt hydratisiert nach Mount
  // aus localStorage; `hydrated`-Gate verhindert dass der erste persist-Tick
  // localStorage mit Defaults überschreibt.
  const [filters, setFilters] = useState<Filters>(() => loadInitialFilters(new URLSearchParams(searchParams.toString())));
  const [hydrated, setHydrated] = useState(false);
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  const [costFilter, setCostFilter] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

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
    fetch(`/api/tft/units?${qs}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setHasData(!!d.hasData);
        setUnits(d.units || []);
        setPatches(d.patches || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setHasData(false); setUnits([]); setLoading(false); } });
    // Mirror filter state into the URL so links are shareable + Back/Fwd works.
    const url = `${pathname}?${qs}`;
    if (typeof window !== 'undefined' && window.location.pathname + window.location.search !== url) {
      router.replace(url, { scroll: false });
    }
    if (hydrated) persistFilters(filters);
    return () => { cancelled = true; };
  }, [filters, hydrated, pathname, router]);

  const filtered = useMemo(() => {
    if (costFilter == null) return units;
    return units.filter(u => (assets?.champions[u.characterId]?.cost ?? -1) === costFilter);
  }, [units, assets, costFilter]);

  const currentPatchLabel = patches[0]?.patch;

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="units" />
      <TftHero pageTitle={t('nav.units')} patch={currentPatchLabel} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

        <div className="flex flex-wrap gap-1 mb-4">
          <button
            onClick={() => setCostFilter(null)}
            className={`px-3 py-1 rounded text-xs ${costFilter == null ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
          >
            {t('tft.bucket.all')}
          </button>
          {[1, 2, 3, 4, 5].map(c => (
            <button
              key={c}
              onClick={() => setCostFilter(c)}
              className={`px-3 py-1 rounded text-xs ${costFilter === c ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#a0b0c5] hover:text-white'}`}
            >
              {c}-Cost
            </button>
          ))}
        </div>

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">{t('tft.noDataYet').replace('Noch keine Daten', 'Lade')}</div>
        )}
        {hasData === false && <EmptyData />}

        {hasData && filtered.length > 0 && (
          <div className="bg-[#0d1526] border border-[#1e2a3a] rounded overflow-hidden">
            <div className={`hidden md:grid ${filters.velocity > 0 ? 'grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-2 px-4 py-2 text-[10px] uppercase text-[#7a8aa0] bg-[#0a0e1a]`}>
              <div></div>
              <div>{t('tft.champion')}</div>
              <div className="text-right">{t('tft.avgPlacement')}</div>
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
            {/* Mobile-only column hint */}
            <div className="md:hidden px-4 py-2 text-[10px] uppercase tracking-widest text-[#7a8aa0] bg-[#0a0e1a]">
              Champion
            </div>
            {filtered.map(u => {
              const ch = assets?.champions[u.characterId];
              const cost = ch?.cost ?? 1;
              const costColor = costColorOf(cost);
              const url = tftChampionTileUrl(assets, ch);
              return (
                <a
                  key={u.characterId}
                  href={`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${filters.bucket}`}
                  className={`block md:grid ${filters.velocity > 0 ? 'md:grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem_4rem]' : 'md:grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_5rem]'} gap-2 px-4 py-2 md:items-center text-xs hover:bg-white/5 border-t border-[#1e2a3a]`}
                >
                  {/* Mobile: icon + name row, stats row below.
                      Desktop: 7-col grid (8-col when Δ active). */}
                  <div className="flex items-center gap-3 md:contents">
                    <div className="w-9 h-9 rounded border-2 overflow-hidden flex-shrink-0" style={{ borderColor: costColor }}>
                      {url && <img src={url} alt={ch!.name} className="w-full h-full object-cover" />}
                    </div>
                    <div className="text-white truncate flex-1 md:flex-initial">{ch?.name || prettyCharId(u.characterId)}</div>
                  </div>
                  {/* Stats: 4-column grid on mobile so the numbers stack
                      neatly under the icon row; explicit cells on desktop. */}
                  <div className={`grid ${filters.velocity > 0 ? 'grid-cols-5' : 'grid-cols-4'} gap-2 mt-1.5 pl-12 md:pl-0 md:mt-0 md:contents`}>
                    <Cell label={t('tft.avgPlacement')} value={u.avgPlacement?.toFixed(2) ?? '—'} accent="white" />
                    <Cell label={t('tft.pickRate')} value={u.pickRate != null ? `${(u.pickRate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top4')} value={u.top4Rate != null ? `${(u.top4Rate * 100).toFixed(1)}%` : '—'} />
                    <Cell label={t('tft.top1')} value={u.top1Rate != null ? `${(u.top1Rate * 100).toFixed(1)}%` : '—'} />
                    <div className="hidden md:block text-right text-[#7a8aa0]">{u.games}</div>
                    {filters.velocity > 0 && (
                      <VelocityCell velocity={u.velocity} label={t('tft.velocity.deltaVs').replace('{n}', String(filters.velocity))} t={t} />
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

function costColorOf(cost: number) {
  return cost === 1 ? '#9aa6b2' : cost === 2 ? '#3a8' : cost === 3 ? '#3a8ddc' : cost === 4 ? '#c39bff' : '#e0c75a';
}
function prettyCharId(id: string) {
  return id.replace(/^TFT\d+_/, '');
}

// Stat cell that reflows between mobile (label-above-value pair, left-
// aligned in a 4-col mobile grid) and desktop (right-aligned single value
// in the parent's explicit grid column). `display: contents` on the
// desktop side makes the parent grid pull this through transparently.
function Cell({ label, value, accent }: { label: string; value: string; accent?: 'white' }) {
  const valueClass = accent === 'white' ? 'text-white' : 'text-[#a0b0c5]';
  return (
    <>
      <div className="md:hidden">
        <div className="text-[#7a8aa0] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
        <div className={`${valueClass} tabular-nums leading-tight`}>{value}</div>
      </div>
      <div className={`hidden md:block text-right ${valueClass} tabular-nums`}>{value}</div>
    </>
  );
}

// Δ-Vergleich-Zelle für die Units-Liste. Lila Trennlinie zur Stats-Strip,
// grün/rot Pfeil mit Wert, "NEU" für frisch erschienene Units. Tooltip
// liefert Jetzt/Vorher-Werte (damit die Zahl im Kontext steht).
function VelocityCell({ velocity, label, t }: {
  velocity?: { deltaAvgPlace: number | null; avgPlaceNow: number | null; avgPlacePrev: number | null; isNew: boolean } | null;
  label: string;
  t: (k: any) => string;
}) {
  const renderDesktop = (content: React.ReactNode, title?: string) => (
    <div className="hidden md:block text-right tabular-nums" title={title}>{content}</div>
  );
  const renderMobile = (content: React.ReactNode, title?: string) => (
    <div className="md:hidden" title={title}>
      <div className="text-[#c39bff] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
      <div className="tabular-nums leading-tight">{content}</div>
    </div>
  );
  if (!velocity) {
    const tip = t('tft.velocity.notEnough');
    return (<>
      {renderMobile(<span className="text-[#5a6a80]">—</span>, tip)}
      {renderDesktop(<span className="text-[#5a6a80]">—</span>, tip)}
    </>);
  }
  if (velocity.isNew) {
    const txt = t('tft.velocity.newComp');
    return (<>
      {renderMobile(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
      {renderDesktop(<span className="text-[#c39bff] font-semibold">{txt}</span>)}
    </>);
  }
  if (velocity.deltaAvgPlace == null) {
    const tip = t('tft.velocity.notEnough');
    return (<>
      {renderMobile(<span className="text-[#5a6a80]">—</span>, tip)}
      {renderDesktop(<span className="text-[#5a6a80]">—</span>, tip)}
    </>);
  }
  const better = velocity.deltaAvgPlace < 0;
  const color = better ? '#3ecf8e' : '#e44040';
  const arrow = better ? '▲' : '▼';
  const dirLabel = better ? t('tft.velocity.better') : t('tft.velocity.worse');
  const nowStr = velocity.avgPlaceNow != null ? velocity.avgPlaceNow.toFixed(2) : '—';
  const prevStr = velocity.avgPlacePrev != null ? velocity.avgPlacePrev.toFixed(2) : '—';
  const detail = (t('tft.velocity.tooltipDetail') as string).replace('{now}', nowStr).replace('{prev}', prevStr);
  const tip = `${dirLabel} — ${detail}`;
  const value = `${arrow} ${Math.abs(velocity.deltaAvgPlace).toFixed(2)}`;
  return (<>
    {renderMobile(<span style={{ color }} className="font-medium">{value}</span>, tip)}
    {renderDesktop(<span style={{ color }} className="font-medium">{value}</span>, tip)}
  </>);
}

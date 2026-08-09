'use client';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { parseClusterKey } from '../../lib/tft-cluster';
import {
  classifyRegionPattern,
  regionPatternSortScore,
  buildRegionNarrative,
  type RegionPattern,
} from '../../lib/tft-region-pattern';

// W2-A Region-Meta-Divergence — Redesign 2026-06-18 (User-Feedback):
//   Statt 3 Tabs (KR-voraus / EU-voraus / NA-voraus) eine Hauptliste mit
//   Pattern-Klassifikation pro Row. Mode-Filter darüber, narrative Δ-Zeile
//   statt Roh-Zahlen. Thresholds in app/lib/tft-region-pattern.ts kalibriert
//   gegen DB-Realität (data-skeptic verdict 2026-06-18).

interface Row {
  cluster_key: string;
  games_kr: number;
  games_eu: number;
  games_na: number;
  avg_place_kr: number | null;
  avg_place_eu: number | null;
  avg_place_na: number | null;
  pickrate_kr: number | null;
  pickrate_eu: number | null;
  pickrate_na: number | null;
  dPickEu: number | null;
  dPickNa: number | null;
  dPlaceEu: number | null;
  dPlaceNa: number | null;
  krAheadEu: number | null;
  krAheadNa: number | null;
}

type Mode = 'all' | 'kr-ahead' | 'west-ahead' | 'mastery';
const VALID_MODES: Mode[] = ['all', 'kr-ahead', 'west-ahead', 'mastery'];

function modeFilter(mode: Mode, pattern: RegionPattern): boolean {
  if (mode === 'all') return true;
  if (mode === 'kr-ahead') return pattern === 'kr-secret';
  if (mode === 'west-ahead') return pattern === 'west-trend';
  if (mode === 'mastery') return pattern === 'mastery';
  return true;
}

const PATTERN_COLORS: Record<RegionPattern, string> = {
  'kr-secret':  '#3ecf8e',   // green — Geheimtipp
  'west-trend': '#7B61FF',   // purple — West-Trend
  'mastery':    '#e0c75a',   // gold — Mastery
  'etabliert':  '#5a6a80',   // muted — etabliert
  'niche':      '#3a8ddc',   // blue — Niche
};

export default function TftRegionsPage() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();

  const initialMode = (search.get('mode') as Mode | null);
  const [mode, setMode] = useState<Mode>(
    initialMode && VALID_MODES.includes(initialMode) ? initialMode : 'all',
  );
  const [days, setDays] = useState(7);
  const [bucket, setBucket] = useState('master_plus');
  const [comps, setComps] = useState<Row[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

  // URL-Sync (per architect verdict): no localStorage, mode is session-bound.
  useEffect(() => {
    if (!pathname) return;
    const next = new URLSearchParams(search.toString());
    if (mode === 'all') next.delete('mode'); else next.set('mode', mode);
    const q = next.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  }, [mode, pathname, router, search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tft/regions/divergence?days=${days}&bucket=${bucket}&min=80`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return;
        setHasData(!!d.hasData);
        setComps(d.comps || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setHasData(false); setComps([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [days, bucket]);

  // Classify + filter + sort. Pattern wird einmal pro Row berechnet,
  // gefiltert nach mode, dann nach Pattern-Score sortiert (Geheimtipps
  // oben, Niche unten).
  const rows = useMemo(() => {
    return comps
      .map(r => ({ row: r, pattern: classifyRegionPattern(r) }))
      .filter(x => modeFilter(mode, x.pattern))
      .sort((a, b) => regionPatternSortScore(b.pattern, b.row) - regionPatternSortScore(a.pattern, a.row))
      .slice(0, 50);
  }, [comps, mode]);

  return (
    <main className="min-h-screen bg-surface-page">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.regions.title')} subtitle={t('tft.regions.subtitle')} />
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 pt-2 pb-6">
        {/* Mode-Filter + Window-Controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([
            { v: 'all'         as Mode, label: t('tft.regions.mode.all'),       tip: t('tft.regions.mode.all.tooltip') },
            { v: 'kr-ahead'    as Mode, label: t('tft.regions.mode.krAhead'),   tip: t('tft.regions.mode.krAhead.tooltip') },
            { v: 'west-ahead'  as Mode, label: t('tft.regions.mode.westAhead'), tip: t('tft.regions.mode.westAhead.tooltip') },
            { v: 'mastery'     as Mode, label: t('tft.regions.mode.mastery'),   tip: t('tft.regions.mode.mastery.tooltip') },
          ]).map(o => (
            <button
              key={o.v}
              onClick={() => setMode(o.v)}
              title={o.tip}
              className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                mode === o.v
                  ? 'bg-accent-a20 border-accent-a60 text-white'
                  : 'bg-surface-raised border-border-subtle text-fg-secondary hover:border-accent-a40'
              }`}
            >
              {o.label}
            </button>
          ))}
          <div className="flex-1" />
          <select
            value={String(days)}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-surface-raised border border-border-subtle rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
          >
            <option value="3">{t('tft.filter.dayN').replace('{n}', '3')}</option>
            <option value="7">{t('tft.filter.dayN').replace('{n}', '7')}</option>
            <option value="14">{t('tft.filter.dayN').replace('{n}', '14')}</option>
          </select>
          <select
            value={bucket}
            onChange={e => setBucket(e.target.value)}
            className="bg-surface-raised border border-border-subtle rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-accent-a60"
          >
            <option value="master_plus">{t('tft.filter.masterPlus')}</option>
            <option value="challenger">{t('tft.bucket.challenger')}</option>
            <option value="diamond">{t('tft.bucket.diamond')}</option>
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-fg-muted text-center py-8">…</div>
        )}
        {hasData === false && !loading && <EmptyData />}

        {hasData && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map(({ row, pattern }) => (
              <RegionRowCard
                key={row.cluster_key}
                row={row}
                pattern={pattern}
                assets={assets}
                t={t}
              />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}

function RegionRowCard({
  row, pattern, assets, t,
}: {
  row: Row;
  pattern: RegionPattern;
  assets: TftAssetsBundle | null;
  t: (k: any) => string;
}) {
  const parts = parseClusterKey(row.cluster_key);
  const trait = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = trait?.name || (parts ? parts.trait.replace(/^TFT\d+_/, '') : '');
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);
  const narrative = buildRegionNarrative(row, pattern, t);
  const badgeColor = PATTERN_COLORS[pattern];
  const patternKey =
    pattern === 'kr-secret' ? 'krSecret' :
    pattern === 'west-trend' ? 'westTrend' :
    pattern;
  const badgeLabel = t(`tft.regions.pattern.${patternKey}` as any);
  const badgeTooltip = t(`tft.regions.pattern.${patternKey}.tooltip` as any);

  return (
    <a
      href={`/tft/comps/${encodeURIComponent(row.cluster_key)}?bucket=master_plus`}
      className="block bg-surface-base border border-border-subtle rounded p-3 hover:border-accent-a40 transition-colors"
    >
      <div className="flex items-center gap-3">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-10 h-10 rounded border-2 border-[#c39bff]/60 object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded bg-surface-overlay flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white text-sm font-medium truncate">
              {traitName} · {carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : '')}
            </span>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-[1px] rounded text-[9px] font-semibold tabular-nums flex-shrink-0 cursor-help"
              style={{
                color: badgeColor,
                backgroundColor: `${badgeColor}1f`,
                border: `1px solid ${badgeColor}40`,
              }}
              title={badgeTooltip}
              onClick={(e) => e.preventDefault()}
            >
              {badgeLabel}
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" className="opacity-70">
                <circle cx="6" cy="6" r="5" />
                <path d="M6 4.5V3.5M6 6V8.5" strokeLinecap="round" />
              </svg>
            </span>
          </div>
          {narrative && (
            <div className="text-fg-secondary text-[11px] mt-0.5 leading-snug">{narrative}</div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <RegionCell label="KR"  avgPlace={row.avg_place_kr} pickRate={row.pickrate_kr} games={row.games_kr} />
        <RegionCell label="EUW" avgPlace={row.avg_place_eu} pickRate={row.pickrate_eu} games={row.games_eu} />
        <RegionCell label="NA"  avgPlace={row.avg_place_na} pickRate={row.pickrate_na} games={row.games_na} />
      </div>
    </a>
  );
}

function RegionCell({ label, avgPlace, pickRate, games }: {
  label: string;
  avgPlace: number | null;
  pickRate: number | null;
  games: number;
}) {
  const empty = games === 0;
  return (
    <div className={`bg-surface-raised border border-border-subtle rounded px-2 py-1.5 ${empty ? 'opacity-40' : ''}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-fg-muted text-[10px] uppercase tracking-widest">{label}</span>
        <span className="text-white text-sm font-medium tabular-nums">
          {avgPlace != null ? avgPlace.toFixed(2) : '—'}
        </span>
      </div>
      <div className="text-[10px] text-fg-secondary tabular-nums mt-0.5">
        {pickRate != null ? `${(pickRate * 100).toFixed(2)}%` : '—'}
        <span className="text-fg-faint"> · {games}</span>
      </div>
    </div>
  );
}

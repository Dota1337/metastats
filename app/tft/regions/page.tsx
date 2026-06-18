'use client';
import { useEffect, useMemo, useState } from 'react';
import Nav from '../../components/Nav';
import Footer from '../../components/Footer';
import TftHero from '../../components/tft/TftHero';
import EmptyData from '../../components/tft/EmptyData';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, tftChampionTileUrl, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { parseClusterKey } from '../../lib/tft-cluster';

// W2-A: Region-Meta-Divergence — Pro-Tool um zu sehen, was KR vor dem
// Westen spielt. Datenquelle: /api/tft/regions/divergence (Migration 0032).
// Bewusst KEIN Statistik-Stream pro Augment/Item, sondern nur Comp-Ebene.

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

type Lens = 'kr-ahead' | 'eu-ahead' | 'na-ahead';

export default function TftRegionsPage() {
  const { t } = useI18n();
  const [lens, setLens] = useState<Lens>('kr-ahead');
  const [days, setDays] = useState(7);
  const [bucket, setBucket] = useState('master_plus');
  const [comps, setComps] = useState<Row[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);

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

  // Re-rank by the selected lens. The API ships KR-ahead order by default;
  // EU/NA lenses just flip the sign of the relevant Δ.
  const sorted = useMemo(() => {
    const copy = [...comps];
    if (lens === 'kr-ahead') {
      copy.sort((a, b) => (b.krAheadEu ?? -1e9) - (a.krAheadEu ?? -1e9));
    } else if (lens === 'eu-ahead') {
      copy.sort((a, b) => -((b.krAheadEu ?? 1e9) - (a.krAheadEu ?? 1e9)));
    } else {
      // NA-ahead: comps where NA pickrate > KR pickrate (= West ahead of KR).
      copy.sort((a, b) => {
        const sa = a.krAheadNa != null ? -a.krAheadNa : -1e9;
        const sb = b.krAheadNa != null ? -b.krAheadNa : -1e9;
        return sb - sa;
      });
    }
    return copy.slice(0, 30);
  }, [comps, lens]);

  return (
    <main className="min-h-screen bg-[#0e1525]">
      <Nav active="comps" />
      <TftHero pageTitle={t('tft.regions.title')} subtitle={t('tft.regions.subtitle')} />
      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-2 pb-6">
        {/* Lens + window controls */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {([
            { v: 'kr-ahead' as Lens, label: t('tft.regions.lensKr') },
            { v: 'eu-ahead' as Lens, label: t('tft.regions.lensEu') },
            { v: 'na-ahead' as Lens, label: t('tft.regions.lensNa') },
          ]).map(o => (
            <button
              key={o.v}
              onClick={() => setLens(o.v)}
              className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                lens === o.v
                  ? 'bg-[#7B61FF]/20 border-[#7B61FF]/60 text-white'
                  : 'bg-[#141c2e] border-[#1e2a3a] text-[#a0b0c5] hover:border-[#7B61FF]/40'
              }`}
            >
              {o.label}
            </button>
          ))}
          <div className="flex-1" />
          <select
            value={String(days)}
            onChange={e => setDays(Number(e.target.value))}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          >
            <option value="3">{t('tft.filter.dayN').replace('{n}', '3')}</option>
            <option value="7">{t('tft.filter.dayN').replace('{n}', '7')}</option>
            <option value="14">{t('tft.filter.dayN').replace('{n}', '14')}</option>
          </select>
          <select
            value={bucket}
            onChange={e => setBucket(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          >
            <option value="master_plus">{t('tft.filter.masterPlus')}</option>
            <option value="challenger">{t('tft.bucket.challenger')}</option>
            <option value="diamond">{t('tft.bucket.diamond')}</option>
          </select>
        </div>

        {loading && hasData === null && (
          <div className="text-[#7a8aa0] text-center py-8">…</div>
        )}
        {hasData === false && !loading && <EmptyData />}

        {hasData && sorted.length > 0 && (
          <div className="space-y-2">
            {sorted.map(r => (
              <RegionRow key={r.cluster_key} row={r} assets={assets} t={t} />
            ))}
          </div>
        )}
      </div>
      <Footer />
    </main>
  );
}


function RegionRow({ row, assets, t }: { row: Row; assets: TftAssetsBundle | null; t: (k: any) => string }) {
  const parts = parseClusterKey(row.cluster_key);
  const trait = parts && assets ? assets.traits[parts.trait] : null;
  const traitName = trait?.name || (parts ? parts.trait.replace(/^TFT\d+_/, '') : '');
  const carry = parts && assets ? assets.champions[parts.carry] : null;
  const carryUrl = tftChampionTileUrl(assets, carry);

  return (
    <a
      href={`/tft/comps/${encodeURIComponent(row.cluster_key)}?bucket=master_plus`}
      className="block bg-[#0d1526] border border-[#1e2a3a] rounded p-3 hover:border-[#7B61FF]/40 transition-colors"
    >
      <div className="flex items-center gap-3">
        {carryUrl ? (
          <img src={carryUrl} alt="" className="w-10 h-10 rounded border-2 border-[#c39bff]/60 object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded bg-[#1e2a3a] flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-white text-sm font-medium truncate">
            {traitName} · {carry?.name || (parts ? parts.carry.replace(/^TFT\d+_/, '') : '')}
          </div>
          <div className="text-[#7a8aa0] text-[10px]">{trait?.name ? '' : row.cluster_key}</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <RegionCell label="KR" avgPlace={row.avg_place_kr} pickRate={row.pickrate_kr} games={row.games_kr} />
        <RegionCell label="EUW" avgPlace={row.avg_place_eu} pickRate={row.pickrate_eu} games={row.games_eu} />
        <RegionCell label="NA" avgPlace={row.avg_place_na} pickRate={row.pickrate_na} games={row.games_na} />
      </div>
      {/* Δ-row: shows the per-region gap relative to KR. Color follows whether
          KR is ahead (green if higher pickrate/lower placement). */}
      <div className="grid grid-cols-2 gap-2 mt-2 text-[10px] tabular-nums">
        <DeltaTag label={t('tft.regions.vsEu')} dPick={row.dPickEu} dPlace={row.dPlaceEu} />
        <DeltaTag label={t('tft.regions.vsNa')} dPick={row.dPickNa} dPlace={row.dPlaceNa} />
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
    <div className={`bg-[#141c2e] border border-[#1e2a3a] rounded px-2 py-1.5 ${empty ? 'opacity-40' : ''}`}>
      <div className="flex items-baseline justify-between">
        <span className="text-[#7a8aa0] text-[10px] uppercase tracking-widest">{label}</span>
        <span className="text-white text-sm font-medium tabular-nums">
          {avgPlace != null ? avgPlace.toFixed(2) : '—'}
        </span>
      </div>
      <div className="text-[10px] text-[#a0b0c5] tabular-nums mt-0.5">
        {pickRate != null ? `${(pickRate * 100).toFixed(2)}%` : '—'}
        <span className="text-[#5a6a80]"> · {games}</span>
      </div>
    </div>
  );
}

function DeltaTag({ label, dPick, dPlace }: { label: string; dPick: number | null; dPlace: number | null }) {
  if (dPick == null && dPlace == null) return <span className="text-[#5a6a80]">— {label}</span>;
  // Lower placement = better; higher pickrate = more played. KR-positive on
  // both = strongly ahead (green).
  const krAhead = (dPick ?? 0) > 0 && (dPlace ?? 0) > 0;
  const krBehind = (dPick ?? 0) < 0 && (dPlace ?? 0) < 0;
  const color = krAhead ? '#3ecf8e' : krBehind ? '#e44040' : '#a0b0c5';
  return (
    <span style={{ color }}>
      {label}: {dPick != null ? `${dPick >= 0 ? '+' : ''}${(dPick * 100).toFixed(2)}%` : '—'}
      {dPlace != null ? ` / Ø ${dPlace >= 0 ? '+' : ''}${dPlace.toFixed(2)}` : ''}
    </span>
  );
}

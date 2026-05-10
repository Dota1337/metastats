'use client';
import { useEffect, useMemo, useState } from 'react';
import TierFilter, { type TierBucket } from './TierFilter';
import EmptyData from './EmptyData';
import CompCard from './CompCard';
import { useI18n } from '../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';

interface CompListProps {
  // When the parent renders a TftHero above, hide CompList's inline title and
  // set-badge to avoid duplication. Patch info is then surfaced in the meta line.
  headless?: boolean;
}

const REGIONS: { value: string; label: string }[] = [
  { value: 'euw1', label: 'EUW' },
  { value: 'kr',   label: 'KR' },
  { value: 'na1',  label: 'NA' },
];

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'avgPlacement', label: 'Ø Platzierung' },
  { value: 'pickRate',     label: 'Pick-Rate' },
  { value: 'top4Rate',     label: 'Top 4' },
  { value: 'top1Rate',     label: 'Sieg-Rate' },
];

export default function CompList({ headless = false }: CompListProps) {
  const { t } = useI18n();
  const [bucket, setBucket] = useState<TierBucket>('master_plus');
  const [region, setRegion] = useState('euw1');
  const [sortBy, setSortBy] = useState('avgPlacement');
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [meta, setMeta] = useState<{ set?: number; setName?: string; patch?: string; matchesAnalyzed?: number; minGames?: number } | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    setComps([]);
    setHasData(null);
    fetch(`/api/tft/comps?region=${region}&bucket=${bucket}&source=data`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setComps(d.comps || []);
        setMeta({ set: d.set, setName: d.setName, patch: d.patch, matchesAnalyzed: d.matchesAnalyzed, minGames: d.minGames });
      })
      .catch(() => { setHasData(false); setComps([]); });
  }, [bucket, region]);

  const sorted = useMemo(() => {
    const c = [...comps];
    if (sortBy === 'avgPlacement') c.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));
    else if (sortBy === 'pickRate') c.sort((a, b) => (b.pickRate ?? 0) - (a.pickRate ?? 0));
    else if (sortBy === 'top4Rate') c.sort((a, b) => (b.top4Rate ?? 0) - (a.top4Rate ?? 0));
    else if (sortBy === 'top1Rate') c.sort((a, b) => (b.top1Rate ?? 0) - (a.top1Rate ?? 0));
    return c;
  }, [comps, sortBy]);

  return (
    <>
      {!headless && (
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-4">
          <div>
            {assets && <div className="text-[#7B61FF] text-xs uppercase tracking-widest">Set {assets.set} · {assets.setName}{meta?.patch ? ` · Patch ${meta.patch}` : ''}</div>}
            <h1 className="text-white text-2xl font-medium mt-1">{t('nav.comps')}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {REGIONS.map(r => (
              <button
                key={r.value}
                onClick={() => setRegion(r.value)}
                className={`px-3 py-1.5 rounded text-xs font-medium ${region === r.value ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {headless && (
        <div className="flex flex-wrap items-center justify-end gap-2 mb-4">
          {REGIONS.map(r => (
            <button
              key={r.value}
              onClick={() => setRegion(r.value)}
              className={`px-3 py-1.5 rounded text-xs font-medium ${region === r.value ? 'bg-[#7B61FF] text-white' : 'bg-[#141c2e] text-[#8a9bb0] hover:text-white'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <TierFilter value={bucket} onChange={setBucket} />
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <span className="text-[#4a5a70] text-xs">Sortieren:</span>
          <select
            value={sortBy}
            onChange={e => setSortBy(e.target.value)}
            className="bg-[#141c2e] border border-[#1e2a3a] rounded px-3 py-1.5 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
          >
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {hasData && meta?.matchesAnalyzed != null && (
        <div className="text-[#4a5a70] text-[11px] mb-3">
          {meta.matchesAnalyzed.toLocaleString('de-DE')} Matches analysiert · {sorted.length} Comps mit ≥ {meta.minGames ?? 30} Spielen{headless && meta?.patch ? ` · Patch ${meta.patch}` : ''}
        </div>
      )}

      {hasData === false && <EmptyData />}
      {hasData && sorted.length === 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#8a9bb0] text-sm">
          {region !== 'euw1'
            ? 'Für diese Region wurden noch keine Daten gecrawlt — aktuell nur EUW. KR und NA folgen mit dem Production-Key.'
            : 'Keine Comps mit ausreichend Spielen für diese Auswahl.'}
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((c, i) => (
          <CompCard
            key={c.slug}
            comp={c}
            rank={i + 1}
            assets={assets}
            href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${bucket}&region=${region}`}
          />
        ))}
      </div>
    </>
  );
}

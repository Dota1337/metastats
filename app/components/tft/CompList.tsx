'use client';
import { useEffect, useMemo, useState } from 'react';
import EmptyData from './EmptyData';
import CompCard from './CompCard';
import StatsFilterBar, { type Filters, type PatchInfo } from './StatsFilterBar';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftPatchLabel } from '../../lib/tft-patch-label';

interface CompListProps {
  // When the parent renders a TftHero above, hide CompList's inline title to
  // avoid duplication. Patch info is then surfaced in the meta line.
  headless?: boolean;
}

// Mirror /tft/units and /tft/items defaults so the stats pages line up:
// current patch · Diamond · last 3 days · all regions.
const DEFAULT_FILTERS: Filters = { patch: 'current', bucket: 'diamond', days: 3, region: 'all', velocity: 0 };

const SORT_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'avgPlacement', labelKey: 'tft.avgPlacement' },
  { value: 'top4Rate',     labelKey: 'tft.top4' },
  { value: 'top1Rate',     labelKey: 'tft.top1' },
  { value: 'pickRate',     labelKey: 'tft.pickRate' },
];

export default function CompList({ headless = false }: CompListProps) {
  const { t } = useI18n();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [sortBy, setSortBy] = useState('avgPlacement');
  const [comps, setComps] = useState<any[]>([]);
  const [hasData, setHasData] = useState<boolean | null>(null);
  const [patches, setPatches] = useState<PatchInfo[]>([]);
  const [meta, setMeta] = useState<{ patch?: string; minGames?: number } | null>(null);
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);

  useEffect(() => { loadTftAssets().then(setAssets); }, []);
  useEffect(() => {
    setComps([]);
    setHasData(null);
    const qs = new URLSearchParams({
      patch: filters.patch,
      bucket: filters.bucket,
      days: String(filters.days),
      region: filters.region,
      source: 'data',
    }).toString();
    fetch(`/api/tft/comps?${qs}`)
      .then(r => r.json())
      .then(d => {
        setHasData(!!d.hasData);
        setComps(d.comps || []);
        setPatches(d.patches || []);
        setMeta({ patch: d.filters?.patch, minGames: d.minGames });
      })
      .catch(() => { setHasData(false); setComps([]); });
  }, [filters]);

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
        <h1 className="text-white text-2xl font-medium mb-4">{t('nav.comps')}</h1>
      )}

      <StatsFilterBar filters={filters} patches={patches} onChange={setFilters} />

      <div className="flex items-center justify-end gap-2 mb-3 -mt-1 text-xs">
        <span className="text-[#7a8aa0]">{t('tft.sortBy')}:</span>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="bg-[#141c2e] border border-[#1e2a3a] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#7B61FF]/60"
        >
          {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(o.labelKey as TranslationKey)}</option>)}
        </select>
      </div>

      {hasData && meta && (
        <div className="text-[#7a8aa0] text-[11px] mb-3">
          {sorted.length} Comps · ≥ {meta.minGames ?? 30} {t('tft.gamesShort')}
          {meta.patch ? ` · Patch ${tftPatchLabel(meta.patch)}` : ''}
        </div>
      )}

      {hasData === false && <EmptyData />}
      {hasData && sorted.length === 0 && (
        <div className="bg-[#0d1526] border border-[#1e2a3a] rounded p-6 text-center text-[#a0b0c5] text-sm">
          {t('tft.noCompsForSelection')}
        </div>
      )}

      <div className="space-y-2">
        {sorted.map((c, i) => (
          <CompCard
            key={c.slug}
            comp={c}
            rank={i + 1}
            assets={assets}
            href={`/tft/comps/${encodeURIComponent(c.slug)}?bucket=${filters.bucket}&region=${filters.region}`}
          />
        ))}
      </div>
    </>
  );
}

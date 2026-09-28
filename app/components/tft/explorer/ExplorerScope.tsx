'use client';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { regionShortLabel } from '../StatsFilterBar';
import {
  EXPLORER_RANKS, LATEST_PATCH, type ExplorerMeta, type ExplorerQuery, type ExplorerRank,
} from '../../../lib/tft-explorer-query';

// Grundmenge: Patch, Region, Rang. Die Auswahl kommt aus dem, was im
// Speicher tatsaechlich liegt (meta), nicht aus festen Listen.

export const RANK_LABEL: Record<ExplorerRank, TranslationKey> = {
  CHALLENGER: 'tft.bucket.challenger',
  GRANDMASTER: 'tft.bucket.grandmaster',
  MASTER: 'tft.bucket.master',
  DIAMOND: 'tft.bucket.diamond',
  EMERALD: 'tft.bucket.emerald',
};

const chip = (on: boolean) =>
  `px-2.5 py-1 rounded-md text-xs border transition-colors whitespace-nowrap ${
    on ? 'bg-accent-a15 border-accent-a50 text-fg-bright' : 'bg-surface-base border-border-subtle text-fg-secondary hover:text-fg-primary'
  }`;

export default function ExplorerScope({
  query, setQuery, meta, resolvedPatch,
}: {
  query: ExplorerQuery;
  setQuery: (q: ExplorerQuery) => void;
  meta: ExplorerMeta | null;
  resolvedPatch: string | null;
}) {
  const { t } = useI18n();
  const isLatest = query.patches[0] === LATEST_PATCH;
  const isAll = query.patches.length === 0;
  const patches = meta?.patches ?? [];

  const togglePatch = (p: string) => {
    const cur = isLatest || isAll ? [] : query.patches;
    const next = cur.includes(p) ? cur.filter(x => x !== p) : [...cur, p];
    setQuery({ ...query, patches: next.length ? next.sort() : [LATEST_PATCH] });
  };
  const toggleRank = (r: ExplorerRank) => {
    const next = query.ranks.includes(r) ? query.ranks.filter(x => x !== r) : [...query.ranks, r];
    setQuery({ ...query, ranks: next.length === EXPLORER_RANKS.length ? [] : next.sort() });
  };

  return (
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0">
        <span className="text-fg-muted text-xs mr-1 shrink-0">{t('tft.filter.patch')}</span>
        <button type="button" className={chip(isLatest)} onClick={() => setQuery({ ...query, patches: [LATEST_PATCH] })}>
          {t('tft.explorer.x.patch.latest')}{isLatest && resolvedPatch ? ` · ${resolvedPatch}` : ''}
        </button>
        {patches.length > 1 && patches.map(p => (
          <button key={p.patch} type="button" className={chip(!isLatest && !isAll && query.patches.includes(p.patch))}
            onClick={() => togglePatch(p.patch)}>
            {p.patch}
          </button>
        ))}
        {patches.length > 1 && (
          <button type="button" className={chip(isAll)} onClick={() => setQuery({ ...query, patches: [] })}>
            {t('tft.explorer.x.patch.all')}
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 shrink-0">
        <span className="text-fg-muted text-xs">{t('tft.filter.region')}</span>
        <select
          value={query.region}
          onChange={e => setQuery({ ...query, region: e.target.value })}
          className="bg-surface-base border border-border-subtle rounded-md text-xs text-fg-primary px-2 py-1"
        >
          <option value="all">{t('tft.filter.allRegions')}</option>
          {(meta?.regions ?? []).map(r => (
            <option key={r.region} value={r.region}>{regionShortLabel(r.region)}</option>
          ))}
          {query.region !== 'all' && !(meta?.regions ?? []).some(r => r.region === query.region) && (
            <option value={query.region}>{regionShortLabel(query.region)}</option>
          )}
        </select>
      </label>

      <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden -mx-4 px-4 sm:mx-0 sm:px-0">
        <button type="button" className={chip(query.ranks.length === 0)} onClick={() => setQuery({ ...query, ranks: [] })}>
          {t('tft.filter.allRanks')}
        </button>
        {EXPLORER_RANKS.map(r => (
          <button key={r} type="button" className={chip(query.ranks.includes(r))} onClick={() => toggleRank(r)}>
            {t(RANK_LABEL[r])}
          </button>
        ))}
      </div>
    </div>
  );
}

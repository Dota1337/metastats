'use client';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { regionShortLabel } from '../StatsFilterBar';
import {
  EXPLORER_RANKS, EXPLORER_RANK_STAGES, LATEST_PATCH, rankStageOf, stageRanks,
  type ExplorerMeta, type ExplorerQuery, type ExplorerRank, type ExplorerRankStage,
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

// Gleiche Beschriftung wie die Rang-Auswahl der uebrigen TFT-Seiten (StatsFilterBar).
const STAGE_LABEL: Record<ExplorerRankStage, TranslationKey> = {
  challenger: 'tft.bucket.challenger',
  grandmaster_plus: 'tft.filter.grandmasterPlus',
  master_plus: 'tft.filter.masterPlus',
  diamond_plus: 'tft.filter.diamondPlus',
  emerald_plus: 'tft.filter.emeraldPlus',
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
  // Stufen statt Einzelraenge. Eine Auswahl, die keine Stufe ist (alter Link,
  // Klick im Reiter Rang), steht als eigener Knopf daneben und laesst sich entfernen.
  const stage = rankStageOf(query.ranks);
  const looseRanks = stage === null
    ? EXPLORER_RANKS.filter(r => query.ranks.includes(r)).map(r => t(RANK_LABEL[r])).join(', ')
    : null;

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
        <button type="button" className={chip(stage === 'all')} aria-pressed={stage === 'all'} onClick={() => setQuery({ ...query, ranks: [] })}>
          {t('tft.filter.allRanks')}
        </button>
        {EXPLORER_RANK_STAGES.map(s => (
          <button key={s} type="button" className={chip(stage === s)} aria-pressed={stage === s}
            onClick={() => setQuery({ ...query, ranks: stageRanks(s) })}>
            {t(STAGE_LABEL[s])}
          </button>
        ))}
        {looseRanks && (
          <span className={`${chip(true)} inline-flex items-center gap-1.5 pr-1.5`}>
            {looseRanks}
            <button type="button" onClick={() => setQuery({ ...query, ranks: [] })}
              aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
              className="text-fg-muted hover:text-fg-primary">{'×'}</button>
          </span>
        )}
      </div>
    </div>
  );
}

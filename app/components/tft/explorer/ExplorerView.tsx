'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { useTftExplorer } from '../../../lib/useTftExplorer';
import { buildExplorerOptions } from './explorer-options';
import ExplorerScope from './ExplorerScope';
import ExplorerFilters from './ExplorerFilters';
import ExplorerSummary, { type DeltaMode } from './ExplorerSummary';
import ExplorerResults from './ExplorerResults';

export default function ExplorerView() {
  const { t, lang } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  useEffect(() => {
    let alive = true;
    loadTftAssets().then(a => { if (alive) setAssets(a); });
    return () => { alive = false; };
  }, []);
  const options = useMemo(() => buildExplorerOptions(assets), [assets]);
  const { query, setQuery, backToUnits, data, dataQuery, loading, error, reload } = useTftExplorer();
  const [deltaMode, setDeltaMode] = useState<DeltaMode>('base');

  const hasFilters = query.units.length + query.items.length + query.traits.length > 0;
  const resolvedPatch = data?.query?.patches?.length === 1 ? data.query.patches[0] : null;
  const builtAt = data?.meta?.builtAt ? new Date(data.meta.builtAt) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-fg-bright text-xl font-medium">{t('tft.explorer.title')}</h1>
        {builtAt && !Number.isNaN(builtAt.getTime()) && (
          <span className="text-[11px] text-fg-faint tabular-nums">
            {t('tft.explorer.x.dataDate')}: {builtAt.toLocaleString(lang === 'de' ? 'de-DE' : lang, { dateStyle: 'medium', timeStyle: 'short' })}
          </span>
        )}
      </div>

      <ExplorerScope query={query} setQuery={setQuery} meta={data?.meta ?? null} resolvedPatch={resolvedPatch} />
      <ExplorerFilters query={query} setQuery={setQuery} options={options} assets={assets} />

      {error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-base p-6 flex flex-col items-center gap-3 text-center">
          <span className="text-sm text-fg-secondary">
            {t(error === 'busy' ? 'tft.explorer.x.err.busy' : error === 'timeout' ? 'tft.explorer.x.err.timeout' : 'tft.explorer.x.err.unavailable')}
          </span>
          <button type="button" onClick={reload}
            className="px-3 py-1.5 rounded-md border border-accent-a50 bg-accent-a15 text-xs text-fg-bright hover:bg-accent-a25">
            {t('tft.explorer.x.retry')}
          </button>
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="h-32 rounded-xl border border-border-subtle bg-surface-base animate-pulse" />
          <div className="h-96 rounded-xl border border-border-subtle bg-surface-base animate-pulse" />
        </div>
      ) : (
        <div className="flex flex-col gap-4" aria-busy={loading}>
          <ExplorerSummary data={data} deltaMode={deltaMode} setDeltaMode={setDeltaMode} hasFilters={hasFilters} />
          <ExplorerResults query={query} setQuery={setQuery} backToUnits={backToUnits} data={data} dataQuery={dataQuery} options={options} assets={assets}
            deltaMode={deltaMode} setDeltaMode={setDeltaMode} />
        </div>
      )}
    </div>
  );
}

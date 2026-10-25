'use client';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { loadTftAssets, type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { useTftExplorer } from '../../../lib/useTftExplorer';
import { hasBoardFilters } from '../../../lib/tft-explorer-query';
import { buildExplorerOptions } from './explorer-options';
import ExplorerFilters from './ExplorerFilters';
import ExplorerSummary, { ExplorerSummarySkeleton } from './ExplorerSummary';
import ExplorerResults from './ExplorerResults';

export default function ExplorerView() {
  const { t } = useI18n();
  const [assets, setAssets] = useState<TftAssetsBundle | null>(null);
  useEffect(() => {
    let alive = true;
    loadTftAssets().then(a => { if (alive) setAssets(a); });
    return () => { alive = false; };
  }, []);
  const options = useMemo(() => buildExplorerOptions(assets), [assets]);
  const { query, setQuery, backToUnits, data, dataQuery, loading, stale, error, reload } = useTftExplorer();

  // Aus den geladenen Daten: sonst taucht die Δ-Zelle beim ersten Filter ueber
  // den alten Zahlen auf und die Zahlenreihe springt.
  const hasFilters = hasBoardFilters(dataQuery ?? query);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-fg-bright text-xl font-medium">{t('tft.explorer.title')}</h1>

      <ExplorerFilters query={query} setQuery={setQuery} options={options} assets={assets} data={data} dataQuery={dataQuery} />

      {error ? (
        <div className="rounded-xl border border-border-subtle bg-surface-base p-6 flex flex-col items-center gap-3 text-center">
          <span className="text-sm text-fg-secondary">
            {t(error === 'busy' ? 'tft.explorer.x.err.busy' : error === 'timeout' ? 'tft.explorer.x.err.timeout'
              : error === 'notReady' ? 'tft.explorer.x.err.notReady' : 'tft.explorer.x.err.unavailable')}
          </span>
          <button type="button" onClick={reload}
            className="px-3 py-1.5 rounded-md border border-accent-a50 bg-accent-a15 text-xs text-fg-bright hover:bg-accent-a25">
            {t('tft.explorer.x.retry')}
          </button>
        </div>
      ) : !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <ExplorerSummarySkeleton hasFilters={hasFilters} place={query.place} />
          <div className="h-96 rounded-xl border border-border-subtle bg-surface-base animate-pulse" />
        </div>
      ) : (
        // Neue Auswahl laedt: alte Zahlen bleiben stehen, gedimmt, mit Ladebalken.
        <div className={`relative flex flex-col gap-4 transition-opacity duration-150 ${stale ? 'opacity-60' : ''}`} aria-busy={loading}>
          {stale && <div className="absolute -top-2 inset-x-0 h-0.5 rounded-full bg-accent-a60 animate-pulse" aria-hidden="true" />}
          <ExplorerSummary data={data} hasFilters={hasFilters}
            place={(dataQuery ?? query).place} />
          <ExplorerResults query={query} setQuery={setQuery} backToUnits={backToUnits} data={data} dataQuery={dataQuery} options={options} assets={assets} />
        </div>
      )}
    </div>
  );
}

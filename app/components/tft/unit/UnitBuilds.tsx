'use client';
// Build- und Item-Bereich der Unit-Detailseite (Logik wie metatft.com/units:
// Stufe, Ø Platz, Place Change, Haeufigkeit — tft-unit-build-score.ts).
// Oben die Empfehlungen auf einen Blick (Builds, Items, Artefakte, Embleme),
// darunter die Tabellen mit Filterzeile. Zahlen aus dem Data Explorer.
import { useMemo, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import TftItemIcon from '../TftItemIcon';
import { type TftAssetsBundle } from '../../../lib/tft-cdragon';
import { itemBucketOf, type ItemBucket } from '../../../lib/tft-item-bucket';
import { type ExplorerRow } from '../../../lib/tft-explorer-query';
import { buildExplorerUrl } from '../../../lib/tft-explorer-url';
import {
  BUILD_TIER_COLORS, MIN_TIER_GAMES, buildsWithCount, isThiefsGlovesBuild, scoreBuilds, scoreItems, type Scored,
} from '../../../lib/tft-unit-build-score';
import { unitFilterOf, type UnitExplorerFilters, type UnitExplorerState } from './useUnitExplorer';
import type { ExplorerError } from '../../../lib/useTftExplorer';

type View = 'builds' | 'items';
type Kind = 'all' | ItemBucket;
type SortKey = 'score' | 'avg' | 'pc' | 'top4' | 'top1' | 'games';

const PAGE = 15;
const fmtPct = (v: number | null | undefined, d = 1) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`);
const fmtPc = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(2)}`);
const pcClass = (v: number | null) => (v == null ? 'text-fg-muted' : v <= -0.1 ? 'text-[#3ecf8e]' : v >= 0.1 ? 'text-[#ff6b6b]' : 'text-fg-secondary');

// Embleme aus Augmenten (DA_18_EmblemFloraFatalisAugment, gleicher Name wie das
// echte) zaehlen nicht — das waere eine Augment-Statistik (feedback_no_augment_stats).
// Gleiche Regel wie isCompEmblem in tft-comp-outcome.ts.
const isAugmentGranted = (id: string) => /Augment|Phantom/i.test(id);

export default function UnitBuilds({
  unitId, unitName, region, bucket, assets, data, filters, setFilters,
}: {
  unitId: string;
  unitName: string;
  region: string;
  bucket: string;
  assets: TftAssetsBundle | null;
  data: UnitExplorerState;
  filters: UnitExplorerFilters;
  setFilters: (f: UnitExplorerFilters) => void;
}) {
  const { t, withLang } = useI18n();
  const [view, setView] = useState<View>('builds');
  const [kind, setKind] = useState<Kind>('all');
  const [withItem, setWithItem] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('score');
  const [shown, setShown] = useState(PAGE);

  const kindOf = (id: string): ItemBucket => itemBucketOf(id, assets);
  const items = data.items;
  const builds = data.builds;

  const scoredItems = useMemo(() => {
    if (!items?.rows || !items.summary.avg) return [];
    return scoreItems(items.rows.filter(r => !isAugmentGranted(r.key)), { games: items.summary.games, avg: items.summary.avg });
  }, [items]);
  const maxItemGames = useMemo(() => Math.max(0, ...(items?.rows ?? []).map(r => r.games)), [items]);
  const scoredBuilds = useMemo(() => {
    if (!builds?.rows || !builds.summary.avg) return [];
    const rows = buildsWithCount(builds.rows, filters.itemCount).filter(r => !r.key.split('|').some(isAugmentGranted));
    return scoreBuilds(rows, { games: builds.summary.games, avg: builds.summary.avg }, maxItemGames);
  }, [builds, filters.itemCount, maxItemGames]);

  // Empfehlungen: nur normale Items (wie MetaTFT), Stufe nur mit genug Spielen.
  const isStandardBuild = (key: string) => isThiefsGlovesBuild(key) || key.split('|').every(id => kindOf(id) === 'standard');
  const recommended = scoredBuilds.filter(s => s.tier && isStandardBuild(s.row.key)).slice(0, 5);
  const topItems = scoredItems.filter(s => s.tier && kindOf(s.row.key) === 'standard').slice(0, 5);
  // Artefakte/Embleme: die meistgespielten (User 19.10.2026).
  const mostPlayed = (b: ItemBucket) => scoredItems.filter(s => kindOf(s.row.key) === b).sort((a, z) => z.row.games - a.row.games).slice(0, 5);
  const artifacts = mostPlayed('artifact');
  const emblems = mostPlayed('emblem');

  const kinds = useMemo(() => {
    const present = new Set(scoredItems.map(s => kindOf(s.row.key)));
    return (['standard', 'artifact', 'emblem', 'radiant'] as ItemBucket[]).filter(k => present.has(k));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scoredItems, assets]);

  const sorter = (a: Scored<ExplorerRow>, b: Scored<ExplorerRow>): number => {
    switch (sort) {
      case 'avg': return a.row.avg - b.row.avg;
      case 'pc': return (a.pc ?? 99) - (b.pc ?? 99);
      case 'top4': return b.row.top4 - a.row.top4;
      case 'top1': return b.row.top1 - a.row.top1;
      case 'games': return b.row.games - a.row.games;
      default: return b.score - a.score;
    }
  };
  const tableRows = (view === 'builds'
    ? scoredBuilds.filter(s => !withItem || s.row.key.split('|').includes(withItem))
    : scoredItems.filter(s => kind === 'all' || kindOf(s.row.key) === kind)
  ).slice().sort(sorter);
  const ref = view === 'builds' ? builds : items;

  const patchOptions = (data.stars?.meta.patches ?? []).map(p => p.patch);
  // 4★ nur, wenn es die Stufe fuer diese Unit in den Daten gibt (Review 19.10.).
  const starOptions: (number | null)[] = (data.stars?.rows ?? []).some(r => r.key === unitId && r.sub === 4 && r.games > 0)
    ? [null, 1, 2, 3, 4] : [null, 1, 2, 3];
  const latest = data.latestPatch;
  const explorerHref = (tab: View, its?: string[]) => withLang(buildExplorerUrl({
    units: [unitFilterOf(unitId, filters, its)],
    focus: its?.length ? undefined : unitId,
    tab: its?.length ? 'units' : tab,
    bucket, region,
    patch: filters.patch && filters.patch !== latest ? filters.patch : undefined,
  }));
  const pickItem = (id: string) => { setWithItem(id); setView('builds'); setShown(PAGE); };
  const stale = data.loading && !!items;

  return (
    <div className="space-y-4">
      {/* Empfehlungen auf einen Blick */}
      <div className={`grid grid-cols-1 md:grid-cols-2 gap-3 transition-opacity ${stale ? 'opacity-60' : ''}`}>
        <HighlightCard title={t('tft.unit.recommendedBuilds')} loading={!builds && !data.error}>
          {recommended.map(s => (
            <HighlightRow key={s.row.key} icons={s.row.key.split('|')} assets={assets} s={s} t={t} onItem={pickItem} />
          ))}
        </HighlightCard>
        <HighlightCard title={t('tft.unit.topItems')} loading={!items && !data.error}>
          {topItems.map(s => (
            <HighlightRow key={s.row.key} icons={[s.row.key]} assets={assets} s={s} t={t} onItem={pickItem} />
          ))}
        </HighlightCard>
        {artifacts.length > 0 && (
          <HighlightCard title={t('tft.unit.topArtifacts')}>
            {artifacts.map(s => (
              <HighlightRow key={s.row.key} icons={[s.row.key]} assets={assets} s={s} t={t} onItem={pickItem} showName />
            ))}
          </HighlightCard>
        )}
        {emblems.length > 0 && (
          <HighlightCard title={t('tft.unit.topEmblems')}>
            {emblems.map(s => (
              <HighlightRow key={s.row.key} icons={[s.row.key]} assets={assets} s={s} t={t} onItem={pickItem} showName />
            ))}
          </HighlightCard>
        )}
      </div>

      {/* Tabellen */}
      <div className="bg-surface-base border border-border-subtle rounded-lg">
        <div role="tablist" className="flex items-center gap-1 px-3 pt-2 border-b border-border-subtle">
          {(['builds', 'items'] as View[]).map(v => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => { setView(v); setShown(PAGE); }}
              className={`px-4 py-2 text-[14px] font-semibold border-b-2 -mb-px transition-colors ${
                view === v ? 'text-white border-accent' : 'text-fg-muted border-transparent hover:text-fg-secondary'
              }`}
            >
              {t(v === 'builds' ? 'tft.explorer.x.tab.builds' : 'tft.explorer.x.tab.items')}
            </button>
          ))}
        </div>

        {/* Filterzeile */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 border-b border-border-subtle text-[12px]">
          {patchOptions.length > 0 && (
            <label className="inline-flex items-center gap-1.5 text-fg-muted">
              {t('tft.unit.patch')}
              <select
                value={filters.patch ?? latest ?? ''}
                onChange={e => setFilters({ ...filters, patch: e.target.value === latest ? null : e.target.value })}
                className="bg-surface-raised border border-border-subtle rounded px-1.5 py-1 text-white"
              >
                {patchOptions.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          )}
          <ChipGroup
            label={t('tft.stars')}
            options={starOptions}
            value={filters.star}
            render={v => (v == null ? t('tft.starTierAll') : '★'.repeat(v))}
            onChange={v => setFilters({ ...filters, star: v })}
          />
          <ChipGroup
            label={t('tft.itemsShort')}
            options={[null, 1, 2, 3]}
            value={filters.itemCount}
            render={v => (v == null ? t('tft.starTierAll') : String(v))}
            onChange={v => setFilters({ ...filters, itemCount: v })}
          />
          {view === 'items' && kinds.length > 1 && (
            <ChipGroup
              label={t('tft.explorer.x.itemKind')}
              options={['all', ...kinds] as Kind[]}
              value={kind}
              render={k => t(`tft.item.bucket.${k}` as TranslationKey)}
              onChange={k => { setKind(k); setShown(PAGE); }}
            />
          )}
          {view === 'builds' && withItem && (
            <button
              type="button"
              onClick={() => setWithItem(null)}
              className="inline-flex items-center gap-1.5 pl-1 pr-2 py-0.5 rounded-full border border-accent-a60 bg-accent-a10 text-white"
              title={t('tft.explorer.x.remove')}
            >
              <TftItemIcon apiName={withItem} assets={assets} className="w-5 h-5" />
              <span className="max-w-[10rem] truncate">{assets?.items[withItem]?.name ?? withItem}</span>
              <span aria-hidden="true" className="text-fg-muted">✕</span>
            </button>
          )}
          <a
            href={explorerHref(view)}
            className="ml-auto inline-flex items-center gap-1 text-accent hover:underline whitespace-nowrap"
          >
            {t('tft.drill.openInExplorer')} →
          </a>
        </div>

        {data.error && !ref ? (
          <ExplorerFailure error={data.error} retry={data.retry} t={t} />
        ) : !ref ? (
          <div className="p-3 space-y-2" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-10 rounded bg-surface-raised animate-pulse" />)}
          </div>
        ) : (
          <div className={`overflow-x-auto transition-opacity ${stale ? 'opacity-60' : ''}`}>
            <table className="w-full text-[13px] tabular-nums">
              <thead>
                <tr className="text-fg-muted text-[11px] border-b border-border-subtle">
                  <th className="text-left font-medium px-3 py-2">{t(view === 'builds' ? 'tft.unit.build' : 'tft.unit.item')}</th>
                  <SortTh k="score" sort={sort} setSort={setSort} label={t('tft.unit.tier')} />
                  <SortTh k="avg" sort={sort} setSort={setSort} label={t('tft.avgPlacement')} />
                  <SortTh k="pc" sort={sort} setSort={setSort} label={t('tft.unit.placeChange')} />
                  <SortTh k="top4" sort={sort} setSort={setSort} label={t('tft.top4')} className="hidden sm:table-cell" />
                  <SortTh k="top1" sort={sort} setSort={setSort} label={t('tft.top1')} className="hidden sm:table-cell" />
                  <SortTh k="games" sort={sort} setSort={setSort} label={t('tft.unit.frequency')} />
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {/* Bezugszeile: alle Bretter der Unit mit diesen Filtern */}
                <tr className="border-b border-border-subtle bg-surface-raised/60 text-fg-secondary">
                  <td className="px-3 py-2 text-[12px]">{t('tft.unit.allBoards').replace('{unit}', unitName)}</td>
                  <td />
                  <td className="text-center px-2">{ref.summary.avg?.toFixed(2) ?? '—'}</td>
                  <td className="text-center px-2 text-fg-muted">—</td>
                  <td className="text-center px-2 hidden sm:table-cell">{fmtPct(ref.summary.top4)}</td>
                  <td className="text-center px-2 hidden sm:table-cell">{fmtPct(ref.summary.top1)}</td>
                  <td className="text-right px-3">{ref.summary.games.toLocaleString('de-DE')}</td>
                  <td />
                </tr>
                {tableRows.slice(0, shown).map(s => {
                  const ids = s.row.key.split('|');
                  // Blass nur ohne Stufe: der Place Change rechnet die Unsicherheit
                  // schon ein (vorsichtiger Ø), eine Zeile mit Stufe ist belastbar.
                  const weak = s.row.games < MIN_TIER_GAMES;
                  return (
                    <tr key={s.row.key} className={`border-b border-border-subtle/60 last:border-0 hover:bg-surface-raised/50 ${weak ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-1.5">
                        <div className="flex items-center gap-1">
                          {ids.map((id, i) => (
                            <button key={`${id}-${i}`} type="button" onClick={() => pickItem(id)} className="shrink-0 rounded hover:ring-2 hover:ring-accent-a60 transition">
                              <TftItemIcon apiName={id} assets={assets} className="w-7 h-7 sm:w-8 sm:h-8" />
                            </button>
                          ))}
                          {view === 'items' && (
                            <span className="ml-2 text-white text-[12px] truncate max-w-[12rem] hidden md:inline">{assets?.items[ids[0]]?.name ?? ''}</span>
                          )}
                        </div>
                      </td>
                      <td className="text-center px-2"><TierBadge tier={s.tier} /></td>
                      <td className="text-center px-2 text-white font-medium">{s.row.avg.toFixed(2)}</td>
                      <td className={`text-center px-2 font-medium ${pcClass(s.pc)}`}>{fmtPc(s.pc)}</td>
                      <td className="text-center px-2 hidden sm:table-cell">{fmtPct(s.row.top4)}</td>
                      <td className="text-center px-2 hidden sm:table-cell">{fmtPct(s.row.top1)}</td>
                      <td className="text-right px-3 whitespace-nowrap">
                        <span className="text-white">{s.row.games.toLocaleString('de-DE')}</span>
                        <span className="text-fg-muted text-[11px] ml-1.5">{fmtPct(s.share)}</span>
                      </td>
                      <td className="pr-2 text-center">
                        <a href={explorerHref(view, ids)} className="text-fg-muted hover:text-accent" title={t('tft.drill.openInExplorer')} aria-label={t('tft.drill.openInExplorer')}>→</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {tableRows.length > PAGE && (
              <div className="flex justify-center py-2.5 border-t border-border-subtle">
                <button
                  type="button"
                  onClick={() => setShown(shown >= tableRows.length ? PAGE : shown + 30)}
                  className="text-[12px] text-accent hover:underline"
                >
                  {shown >= tableRows.length
                    ? t('tft.player.showLess')
                    : t('tft.player.showMore').replace('{n}', String(Math.min(30, tableRows.length - shown)))}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function HighlightCard({ title, loading = false, children }: { title: string; loading?: boolean; children: React.ReactNode }) {
  const empty = !loading && (!children || (Array.isArray(children) && children.length === 0));
  if (empty) return null;
  return (
    <div className="bg-surface-base border border-border-subtle rounded-lg p-3.5">
      <h2 className="text-white text-[14px] font-semibold mb-2">{title}</h2>
      {loading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => <div key={i} className="h-9 rounded bg-surface-raised animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-1">{children}</div>
      )}
    </div>
  );
}

function HighlightRow({ icons, assets, s, t, onItem, showName = false }: {
  icons: string[];
  assets: TftAssetsBundle | null;
  s: Scored<ExplorerRow>;
  t: (k: TranslationKey) => string;
  onItem: (id: string) => void;
  showName?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <div className="flex items-center gap-1 shrink-0">
        {icons.map((id, i) => (
          <button key={`${id}-${i}`} type="button" onClick={() => onItem(id)} className="rounded hover:ring-2 hover:ring-accent-a60 transition">
            <TftItemIcon apiName={id} assets={assets} className="w-9 h-9" />
          </button>
        ))}
      </div>
      {showName && <span className="text-[12px] text-fg-secondary truncate min-w-0 flex-1">{assets?.items[icons[0]]?.name ?? ''}</span>}
      <div className={`grid grid-cols-3 gap-2 text-center ${showName ? '' : 'flex-1'} min-w-[11rem]`}>
        <Metric value={s.row.avg.toFixed(2)} label={t('tft.avgPlacement')} />
        <Metric value={fmtPc(s.pc)} label={t('tft.explorer.x.delta')} title={t('tft.unit.placeChange')} className={pcClass(s.pc)} />
        <Metric value={fmtPct(s.share)} label={t('tft.unit.playRate')} />
      </div>
    </div>
  );
}

function Metric({ value, label, title, className = 'text-white' }: { value: string; label: string; title?: string; className?: string }) {
  return (
    <div className="leading-tight" title={title}>
      <div className={`text-[14px] font-semibold tabular-nums ${className}`}>{value}</div>
      <div className="text-[10px] text-fg-muted truncate">{label}</div>
    </div>
  );
}

function TierBadge({ tier }: { tier: Scored<ExplorerRow>['tier'] }) {
  if (!tier) return <span className="text-fg-faint">—</span>;
  return (
    <span
      className="inline-flex items-center justify-center w-6 h-6 rounded text-[12px] font-bold text-[#11151c]"
      style={{ background: BUILD_TIER_COLORS[tier] }}
    >
      {tier}
    </span>
  );
}

function SortTh({ k, sort, setSort, label, className = '' }: {
  k: SortKey; sort: SortKey; setSort: (k: SortKey) => void; label: string; className?: string;
}) {
  const active = sort === k;
  return (
    <th className={`font-medium px-2 py-2 ${k === 'games' ? 'text-right pr-3' : 'text-center'} ${className}`} aria-sort={active ? 'descending' : 'none'}>
      <button type="button" onClick={() => setSort(k)} className={`hover:text-white whitespace-nowrap ${active ? 'text-white' : ''}`}>
        {label}{active ? ' ▾' : ''}
      </button>
    </th>
  );
}

function ChipGroup<T extends string | number | null>({ label, options, value, render, onChange }: {
  label: string;
  options: T[];
  value: T;
  render: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={label}>
      <span className="text-fg-muted">{label}</span>
      {options.map(o => (
        <button
          key={String(o)}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={`px-2 py-0.5 rounded border transition-colors ${
            value === o ? 'border-accent bg-accent text-white' : 'border-border-subtle text-fg-secondary hover:border-accent-a40 hover:text-white'
          }`}
        >
          {render(o)}
        </button>
      ))}
    </div>
  );
}

function ExplorerFailure({ error, retry, t }: { error: ExplorerError; retry: () => void; t: (k: TranslationKey) => string }) {
  const key = error === 'busy' ? 'tft.explorer.x.err.busy'
    : error === 'timeout' ? 'tft.explorer.x.err.timeout'
    : error === 'notReady' ? 'tft.explorer.x.err.notReady'
    : 'tft.explorer.x.err.unavailable';
  return (
    <div className="p-6 text-center text-[13px] text-fg-secondary">
      <div className="mb-2">{t(key)}</div>
      <button type="button" onClick={retry} className="px-3 py-1.5 rounded border border-border-subtle hover:border-accent-a60 text-white">
        {t('tft.explorer.x.retry')}
      </button>
    </div>
  );
}

'use client';
import { useMemo, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import { regionShortLabel } from '../StatsFilterBar';
import {
  EXPLORER_RANKS, EXPLORER_TABS, isWeakRow, roundLabel,
  type ExplorerQuery, type ExplorerRank, type ExplorerResponse, type ExplorerRow, type ExplorerTab,
} from '../../../lib/tft-explorer-query';
import {
  fmtAvg, fmtDelta, fmtPct, itemImg, itemName, traitImg, traitMin, traitName, unitImg, unitName,
  type ExplorerOptions,
} from './explorer-options';
import { DeltaToggle, deltaClass, type DeltaMode } from './ExplorerSummary';
import { RANK_LABEL } from './ExplorerScope';

const TAB_LABEL: Record<ExplorerTab, TranslationKey> = {
  units: 'tft.explorer.x.tab.units', items: 'tft.explorer.x.tab.items', traits: 'tft.explorer.x.tab.traits',
  comps: 'tft.explorer.x.tab.comps', level: 'tft.explorer.x.tab.level', round: 'tft.explorer.x.tab.round',
  gold: 'tft.explorer.x.tab.gold', region: 'tft.explorer.x.tab.region', rank: 'tft.explorer.x.tab.rank',
};

type SortKey = 'games' | 'share' | 'avg' | 'top4' | 'top1' | 'delta' | 'key';
const MIN_GAMES = [5, 30, 100, 500, 2000];
const GOLD_ORDER = ['0', '1-9', '10-19', '20-29', '30-49', '50+'];

const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;

// Natuerliche Reihenfolge der Zahlen-Reiter (Level, Runde, Gold).
function orderKey(tab: ExplorerTab, r: ExplorerRow): number {
  if (tab === 'gold') return GOLD_ORDER.indexOf(r.key);
  if (tab === 'level' || tab === 'round') return Number(r.key);
  if (tab === 'rank') { const i = EXPLORER_RANKS.indexOf(r.key as ExplorerRank); return i < 0 ? 99 : i; }
  return 0;
}
const NUMERIC_TABS: ExplorerTab[] = ['level', 'round', 'gold', 'rank'];

export default function ExplorerResults({
  query, setQuery, data, options, assets, deltaMode, setDeltaMode,
}: {
  query: ExplorerQuery;
  setQuery: (q: ExplorerQuery) => void;
  data: ExplorerResponse | null;
  options: ExplorerOptions;
  assets: TftAssetsBundle | null;
  deltaMode: DeltaMode;
  setDeltaMode: (m: DeltaMode) => void;
}) {
  const { t, lang } = useI18n();
  const tab = query.tab;
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 } | null>(null);
  const [minGames, setMinGames] = useState(30);
  const refGames = data?.refGames ?? 0;
  const num = (v: number) => v.toLocaleString(lang === 'de' ? 'de-DE' : lang);

  const dOf = (r: ExplorerRow) => (deltaMode === 'base' ? r.dBase : r.dOut);
  const dhOf = (r: ExplorerRow) => (deltaMode === 'base' ? r.dBaseHalf : r.dOutHalf);

  // Anzeigename je Zeile, auch fuer die Textsuche in der Sortierung und die CSV.
  const labelOf = (r: ExplorerRow): string => {
    switch (tab) {
      case 'units': return unitName(options, assets, r.key) + (r.sub ? ` ${r.sub}★` : '');
      case 'items': return r.key.split('|').map(i => itemName(options, assets, i)).join(' + ');
      case 'traits': {
        const m = r.sub ? traitMin(options, assets, r.key, r.sub) : null;
        return `${traitName(options, assets, r.key)}${m != null ? ` ${m}` : ''}${r.sub2 ? ` +${r.sub2}` : ''}`;
      }
      case 'comps': {
        const [trait, carry] = r.key.split('__');
        return [trait ? traitName(options, assets, trait) : '', carry ? unitName(options, assets, carry) : ''].filter(Boolean).join(' · ');
      }
      case 'round': return roundLabel(Number(r.key));
      case 'gold': return r.key;
      case 'region': return regionShortLabel(r.key);
      case 'rank': return (EXPLORER_RANKS as readonly string[]).includes(r.key) ? t(RANK_LABEL[r.key as ExplorerRank]) : r.key;
      default: return r.key;
    }
  };

  const rows = useMemo(() => {
    const list = (data?.rows ?? []).filter(r => r.games >= minGames);
    const s = sort ?? (NUMERIC_TABS.includes(tab) ? { key: 'key' as SortKey, dir: 1 as const } : { key: 'games' as SortKey, dir: -1 as const });
    const val = (r: ExplorerRow): number => {
      switch (s.key) {
        case 'games': case 'share': return r.games;
        case 'avg': return r.avg;
        case 'top4': return r.top4;
        case 'top1': return r.top1;
        case 'delta': return dOf(r) ?? 0;
        case 'key': return orderKey(tab, r) * 100 + (r.sub ?? 0) * 10 + (r.sub2 ?? 0);
      }
    };
    return [...list].sort((a, b) => (val(a) - val(b)) * s.dir || b.games - a.games);
    // dOf haengt nur an deltaMode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, minGames, sort, tab, deltaMode]);

  const setTab = (next: ExplorerTab) => { setSort(null); setQuery({ ...query, tab: next }); };

  // Klick auf eine Zeile nimmt sie als Filter auf.
  const rowAction = (r: ExplorerRow): (() => void) | null => {
    switch (tab) {
      case 'units':
        if (query.units.some(u => u.id === r.key) || query.units.length >= 9) return null;
        return () => setQuery({ ...query, units: [...query.units, r.sub ? { id: r.key, s: r.sub, se: true } : { id: r.key }] });
      case 'items': {
        const ids = r.key.split('|');
        if (query.focus) {
          const f = query.focus;
          const cur = query.units.find(u => u.id === f);
          const it = [...new Set([...(cur?.it ?? []), ...ids])].slice(0, 3);
          const units = cur ? query.units.map(u => (u.id === f ? { ...u, it } : u)) : [...query.units, { id: f, it }];
          if (units.length > 9) return null;
          return () => setQuery({ ...query, units, tab: 'units', focus: null, combo: 1 });
        }
        if (query.items.some(i => i.id === r.key) || query.items.length >= 6) return null;
        return () => setQuery({ ...query, items: [...query.items, { id: r.key }] });
      }
      case 'traits':
        if (query.traits.some(x => x.id === r.key) || query.traits.length >= 6) return null;
        return () => setQuery({ ...query, traits: [...query.traits, r.sub ? { id: r.key, l: r.sub, le: true } : { id: r.key }] });
      case 'region':
        return query.region === r.key ? null : () => setQuery({ ...query, region: r.key });
      case 'rank':
        return (EXPLORER_RANKS as readonly string[]).includes(r.key) ? () => setQuery({ ...query, ranks: [r.key as ExplorerRank] }) : null;
      default:
        return null;
    }
  };

  const downloadCsv = () => {
    const head = ['name', 'key', 'sub', 'sub2', 'games', 'matches', 'share', 'avg_place', 'avg_ci95', 'top4', 'top1', 'delta', 'delta_ci95'];
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const n = (v: number | null | undefined, d = 4) => (v == null ? '' : v.toFixed(d));
    const lines = [head.join(',')];
    for (const r of rows) {
      lines.push([
        q(labelOf(r)), q(r.key), r.sub ?? '', r.sub2 ?? '', r.games, r.matches,
        n(refGames ? r.games / refGames : null), n(r.avg), n(r.half), n(r.top4), n(r.top1), n(dOf(r)), n(dhOf(r)),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `metastats-tft-explorer-${tab}${data?.meta?.maxDay ? `-${data.meta.maxDay}` : ''}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const th = (key: SortKey, label: string, cls = '') => {
    const active = sort?.key === key;
    return (
      <th className={`px-2 py-2 font-medium text-right whitespace-nowrap ${cls}`}>
        <button type="button" onClick={() => setSort({ key, dir: active && sort!.dir === -1 ? 1 : active ? -1 : key === 'avg' || key === 'delta' ? 1 : -1 })}
          className={`hover:text-fg-primary ${active ? 'text-fg-bright' : ''}`}>
          {label}{active ? (sort!.dir === 1 ? ' ▲' : ' ▼') : ''}
        </button>
      </th>
    );
  };

  const nameCell = (r: ExplorerRow) => {
    const label = labelOf(r);
    let icons: React.ReactNode = null;
    if (tab === 'units') {
      const cost = options.unitById.get(r.key)?.cost ?? 1;
      const src = unitImg(options, assets, r.key);
      icons = src ? <img src={src} alt="" loading="lazy" className="w-7 h-7 rounded object-cover" style={{ boxShadow: `inset 0 0 0 1.5px ${costColor(cost)}` }} /> : null;
    } else if (tab === 'items') {
      icons = <span className="flex gap-0.5">{r.key.split('|').map(i => { const s = itemImg(options, assets, i); return s ? <img key={i} src={s} alt="" loading="lazy" className="w-6 h-6 rounded" /> : null; })}</span>;
    } else if (tab === 'traits' || tab === 'comps') {
      const id = tab === 'traits' ? r.key : r.key.split('__')[0];
      const s = traitImg(options, assets, id);
      icons = s ? <img src={s} alt="" loading="lazy" className="w-5 h-5" /> : null;
      if (tab === 'comps') {
        const carry = r.key.split('__')[1];
        const cs = carry ? unitImg(options, assets, carry) : null;
        icons = <span className="flex items-center gap-1">{icons}{cs && <img src={cs} alt="" loading="lazy" className="w-6 h-6 rounded object-cover" />}</span>;
      }
    }
    return (
      <span className="flex items-center gap-2 min-w-0">
        {icons}
        <span className="truncate text-fg-primary">{label}</span>
      </span>
    );
  };

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-base">
      <div className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-border-subtle px-2">
        {EXPLORER_TABS.map(k => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`px-3 py-2.5 text-sm whitespace-nowrap border-b-2 -mb-px ${tab === k ? 'border-accent text-fg-bright' : 'border-transparent text-fg-secondary hover:text-fg-primary'}`}>
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 border-b border-border-subtle">
        {tab === 'units' && (
          <button type="button" className={seg(query.split === 'star')} onClick={() => setQuery({ ...query, split: query.split === 'star' ? null : 'star' })}>
            {t('tft.explorer.x.split.star')}
          </button>
        )}
        {tab === 'traits' && (
          <button type="button" className={seg(query.split === 'over')} onClick={() => setQuery({ ...query, split: query.split === 'over' ? null : 'over' })}>
            {t('tft.explorer.x.split.over')}
          </button>
        )}
        {tab === 'items' && (
          <label className="flex items-center gap-2">
            <span className="text-xs text-fg-muted">{t('tft.explorer.x.focus')}</span>
            <select value={query.focus ?? ''} onChange={e => setQuery({ ...query, focus: e.target.value || null, combo: 1 })}
              className="bg-surface-page border border-border-subtle rounded text-xs text-fg-primary px-2 py-1 max-w-[12rem]">
              <option value="">{'—'}</option>
              {options.units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
        )}
        {tab === 'items' && query.focus && (
          <div className="flex gap-1">
            {([1, 2, 3] as const).map(c => (
              <button key={c} type="button" className={seg(query.combo === c)} onClick={() => setQuery({ ...query, combo: c })}>
                {t(c === 1 ? 'tft.explorer.x.combo.1' : c === 2 ? 'tft.explorer.x.combo.2' : 'tft.explorer.x.combo.3')}
              </button>
            ))}
          </div>
        )}
        <DeltaToggle mode={deltaMode} set={setDeltaMode} />
        <label className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">{t('tft.explorer.minGames')}</span>
          <select value={minGames} onChange={e => setMinGames(Number(e.target.value))}
            className="bg-surface-page border border-border-subtle rounded text-xs text-fg-primary px-2 py-1">
            {MIN_GAMES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <button type="button" onClick={downloadCsv} disabled={!rows.length}
          className="ml-auto px-2.5 py-1 rounded-md border border-border-subtle text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-40">
          CSV
        </button>
      </div>

      {tab === 'items' && !query.focus && (
        <div className="px-3 pt-2 text-[11px] text-fg-muted">{t('tft.explorer.x.focus.pick')}: {t('tft.explorer.x.focus')}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <thead className="text-fg-muted">
            <tr className="border-b border-border-subtle">
              <th className="px-3 py-2 font-medium text-left">
                <button type="button" onClick={() => setSort({ key: 'key', dir: sort?.key === 'key' && sort.dir === 1 ? -1 : 1 })} className="hover:text-fg-primary">
                  {t('tft.explorer.x.name')}
                </button>
              </th>
              {th('games', t('tft.explorer.sort.games'))}
              {th('share', t('tft.explorer.x.share'), 'hidden sm:table-cell')}
              {th('avg', t('tft.explorer.sort.avg'))}
              {th('delta', t('tft.explorer.x.delta'))}
              {th('top4', t('tft.explorer.sort.top4'), 'hidden sm:table-cell')}
              {th('top1', t('tft.explorer.sort.top1'), 'hidden md:table-cell')}
              {tab === 'units' && <th className="px-2 py-2 w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const act = rowAction(r);
              const weak = isWeakRow(r);
              const d = dOf(r);
              const dh = dhOf(r);
              return (
                <tr key={`${r.key}|${r.sub ?? ''}|${r.sub2 ?? ''}`}
                  onClick={act ?? undefined}
                  className={`border-b border-border-subtle last:border-0 ${act ? 'cursor-pointer hover:bg-surface-raised' : ''} ${weak ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-1.5 max-w-[14rem] sm:max-w-none">{nameCell(r)}</td>
                  <td className="px-2 py-1.5 text-right text-fg-primary">{num(r.games)}</td>
                  <td className="px-2 py-1.5 text-right text-fg-secondary hidden sm:table-cell">{refGames ? fmtPct(r.games / refGames) : '—'}</td>
                  <td className="px-2 py-1.5 text-right text-fg-bright">
                    {fmtAvg(r.avg)}
                    <span className="text-fg-faint text-[10px] ml-1 hidden lg:inline">{'±'}{r.half.toFixed(2)}</span>
                  </td>
                  <td className={`px-2 py-1.5 text-right ${deltaClass(d, dh)}`}>
                    {fmtDelta(d)}
                    {dh != null && <span className="text-fg-faint text-[10px] ml-1 hidden lg:inline">{'±'}{dh.toFixed(2)}</span>}
                  </td>
                  <td className="px-2 py-1.5 text-right text-fg-secondary hidden sm:table-cell">{fmtPct(r.top4)}</td>
                  <td className="px-2 py-1.5 text-right text-fg-secondary hidden md:table-cell">{fmtPct(r.top1)}</td>
                  {tab === 'units' && (
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" title={t('tft.explorer.items')}
                        onClick={e => { e.stopPropagation(); setSort(null); setQuery({ ...query, tab: 'items', focus: r.key, combo: 1 }); }}
                        className="px-1.5 py-0.5 rounded border border-border-subtle text-fg-muted hover:text-fg-primary hover:border-accent-a40 whitespace-nowrap">
                        {t('tft.explorer.items')} {'→'}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
            {data && rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-fg-muted">{t('tft.explorer.noResults')}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

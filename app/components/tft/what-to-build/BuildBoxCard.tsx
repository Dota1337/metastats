'use client';
// Eine Box der Seite „What to build": Unit, Stern, Synergie, Einzel/Duo/Trio,
// feste Items, Urteil und Item-Liste. Zeile anklicken setzt fest, der Knopf rechts
// nimmt sie in den Vergleich.
import { useMemo, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import type { ItemBucket } from '../../../lib/tft-item-bucket';
import { costColor } from '../../../lib/tft-ui';
import { isWeakRow, type ExplorerResponse } from '../../../lib/tft-explorer-query';
import {
  EXPLORER_ROW_CAP, MIN_GAMES_FOR_RANGE, boxRows, canFix, minCombo, normalizeBox, rowsAreDisjoint, verdictOf,
  type BoxRow, type BuildBox, type BuildKind, type Combo, type ItemListRules, type VerdictSide,
} from '../../../lib/tft-what-to-build';
import { OptIcon } from '../explorer/ExplorerSearchBox';
import { browseTraits, PICK_KINDS } from '../explorer/explorer-search';
import { fmtAvg, itemFitsUnit, itemName, type ExplorerOptions } from '../explorer/explorer-options';
import type { QueryResult } from './useBuildExplorer';

const KIND_LABEL: Record<BuildKind, TranslationKey> = {
  standard: 'tft.explorer.items',
  artifact: 'tft.item.bucket.artifact',
  emblem: 'tft.item.bucket.emblem',
  radiant: 'tft.item.bucket.radiant',
};
const COMBOS: { c: Combo; label: TranslationKey }[] = [
  { c: 1, label: 'tft.build.single' }, { c: 2, label: 'tft.build.duo' }, { c: 3, label: 'tft.build.trio' },
];
const SKELETON_ROWS = 8;
// Nachkommastellen und Breiten der Zahlen-Spalten, an einer Stelle.
const fmtPct0 = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const sideOf = (r: BoxRow | undefined): VerdictSide | null =>
  (r && r.avg != null ? { games: r.games, avg: r.avg, half: r.half ?? 0 } : null);
const COLS = 'grid grid-cols-[minmax(0,1fr)_4.75rem_2.5rem_3.25rem_1.75rem] @[30rem]:grid-cols-[minmax(0,1fr)_4.75rem_2.5rem_2.5rem_3.25rem_1.75rem] items-center gap-x-1.5';
const pill = (on: boolean, off = false) => `px-2 py-0.5 rounded text-[11px] border ${
  off ? 'border-border-subtle text-fg-faint cursor-not-allowed'
    : on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;

export default function BuildBoxCard({
  box, options, assets, kindOf, rules, star, starReady, items, split, onChange, onRemove, onRetry,
}: {
  box: BuildBox;
  options: ExplorerOptions;
  assets: TftAssetsBundle | null;
  kindOf: (id: string) => ItemBucket;
  rules: ItemListRules | null;
  /** Stern, mit dem gerade gerechnet wird; null = alle. */
  star: number | null;
  starReady: boolean;
  items: QueryResult | null;
  split: [QueryResult | null, QueryResult | null] | null;
  onChange: (fn: (b: BuildBox) => BuildBox) => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const { t, lang } = useI18n();
  const num = (v: number) => v.toLocaleString(lang === 'de' ? 'de-DE' : lang);
  const unit = options.unitById.get(box.unit);
  const itemLabel = (id: string) => itemName(options, assets, id);
  const itemImg = (id: string) => options.itemById.get(id)?.img ?? null;

  // Beim Filterwechsel bleiben die alten Zahlen gedimmt stehen.
  const [last, setLast] = useState<ExplorerResponse | null>(null);
  if (items?.data && items.data !== last) setLast(items.data);
  const shown = items?.data ?? last;
  const stale = !items?.data && !!shown && !items?.error;

  const allRows = useMemo(() => boxRows(shown?.rows, box, {
    boxGames: shown?.summary.games ?? 0,
    kindOf,
    known: id => options.itemById.has(id),
    fits: (id, carried) => itemFitsUnit(options, box.unit, id, carried),
    allItems: options.items,
    lang: options.lang,
    rules,
  }), [shown, box, kindOf, options, rules]);
  const rows = allRows.filter(r => r.kind === box.kind);
  // Volle Antwort: eine fehlende Zeile sagt nichts ueber die Spielzahl.
  const capped = (shown?.rows?.length ?? 0) >= EXPLORER_ROW_CAP;
  const traits = useMemo(() => {
    const own = new Set(unit?.traits ?? []);
    // Stufe 2 muss mehr als eine Unit bedeuten (Rival: 1/1/2), sonst filtert sie nichts Sinnvolles.
    const list = (browseTraits(options.traits, options.lang)[0] ?? []).filter(x => x.mins.length < 2 || x.mins[1] > 1);
    return [...list.filter(x => own.has(x.name)), ...list.filter(x => !own.has(x.name))];
  }, [options.traits, options.lang, unit]);

  const set = (patch: Partial<BuildBox>) => onChange(b => normalizeBox({ ...b, ...patch }));
  const fix = (r: BoxRow) => {
    const fixed = [...box.fixed, ...r.rest];
    set({ fixed, combo: minCombo(fixed.length), compare: [] });
  };
  const unfix = (at: number) => {
    const fixed = box.fixed.filter((_, i) => i !== at);
    set({ fixed, combo: minCombo(fixed.length), compare: [] });
  };
  const toggleCompare = (key: string) => onChange(b => {
    const on = b.compare.includes(key);
    return normalizeBox({ ...b, compare: on ? b.compare.filter(k => k !== key) : [...b.compare, key].slice(-2) });
  });
  const canCompare = (r: BoxRow) => r.rest.length === 1 || box.combo === 3;

  const verdictLine = useMemo(() => {
    if (box.compare.length !== 2) return null;
    const [ka, kb] = box.compare;
    const ra = allRows.find(r => r.restKey === ka);
    const rb = allRows.find(r => r.restKey === kb);
    const kindA = ra?.kind, kindB = rb?.kind;
    // Nie ueber Sorten hinweg: ein Emblem misst die Comp, nicht das Item.
    if (ra && rb && kindA !== kindB) return null;
    const name = (k: string) => k.split('|').map(itemLabel).join(' + ');
    let a: VerdictSide | null = null;
    let b: VerdictSide | null = null;
    if (rowsAreDisjoint(box)) {
      a = sideOf(ra); b = sideOf(rb);
      if (shown && (!a || !b)) return t('tft.build.few');
    } else {
      const sa = split?.[0]?.data?.summary;
      const sb = split?.[1]?.data?.summary;
      if (sa?.avg != null && sb?.avg != null) {
        a = { games: sa.games, avg: sa.avg, half: sa.half ?? 0 };
        b = { games: sb.games, avg: sb.avg, half: sb.half ?? 0 };
      } else if (sa && sb) return t('tft.build.few');
    }
    if (!a || !b) return null;
    const v = verdictOf(a, b);
    if (v.state === 'few') return t('tft.build.few');
    if (v.state === 'tie') return t('tft.build.tie');
    const [win, lose] = v.winner === 0 ? [ka, kb] : [kb, ka];
    return t('tft.build.better').replace('{a}', name(win)).replace('{b}', name(lose)).replace('{d}', v.diff.toFixed(2));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, allRows, split, shown, t, options]);

  const activeStar: 'all' | number = star ?? 'all';
  const err = items?.error;

  return (
    <section className="@container rounded-xl border border-border-subtle bg-surface-base p-3 flex flex-col gap-2 min-w-0">
      <div className="flex items-center gap-2">
        <OptIcon src={unit?.img ?? null} alt={unit?.label ?? box.unit} className="w-9 h-9" border={costColor(unit?.cost ?? 1)} />
        <h2 className="text-sm font-medium text-fg-bright truncate min-w-0">{unit?.label ?? box.unit}</h2>
        <button type="button" onClick={onRemove} aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
          className="w-6 h-6 shrink-0 rounded text-fg-muted hover:text-fg-primary hover:bg-surface-overlay">×</button>
        {shown && <span className="ml-auto text-[11px] text-fg-muted tabular-nums shrink-0">{num(shown.summary.games)} {t('tft.games')}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="group" aria-label={t('tft.explorer.starLevel')}>
          {(['all', 1, 2, 3] as const).map(s => (
            <button key={s} type="button" aria-pressed={activeStar === s} className={pill(activeStar === s)}
              onClick={() => set({ star: s, compare: box.compare })}>
              {s === 'all' ? t('tft.build.allStars') : <span className="text-gold-earnings">{'★'.repeat(s)}</span>}
            </button>
          ))}
        </div>
        <select aria-label={t('tft.build.allTraits')} value={box.trait ?? ''}
          onChange={e => set({ trait: e.target.value || null })}
          className="min-w-0 max-w-[10rem] bg-surface-raised rounded px-1.5 py-0.5 text-[11px] text-fg-primary border border-border-subtle focus:outline-none focus:border-accent-a60">
          <option value="">{t('tft.build.allTraits')}</option>
          {traits.map(x => <option key={x.id} value={x.id}>{x.mins.length >= 2 ? `${x.mins[1]} ` : ''}{x.label}</option>)}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="group">
          {COMBOS.map(({ c, label }) => {
            const off = c < minCombo(box.fixed.length);
            return (
              <button key={c} type="button" disabled={off} aria-pressed={box.combo === c} className={pill(box.combo === c, off)}
                onClick={() => set({ combo: c, compare: [] })}>
                {t(label)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-1" role="group">
          {(PICK_KINDS as BuildKind[]).map(k => (
            <button key={k} type="button" aria-pressed={box.kind === k} className={pill(box.kind === k)}
              onClick={() => set({ kind: k, compare: [] })}>
              {t(KIND_LABEL[k])}
            </button>
          ))}
        </div>
      </div>

      {box.fixed.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {box.fixed.map((id, i) => (
            <span key={`${id}-${i}`} className="inline-flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded border border-accent-a40 bg-accent-a8 text-[11px] text-fg-primary max-w-full">
              <OptIcon src={itemImg(id)} alt={itemLabel(id)} className="w-5 h-5" />
              <span className="truncate">{itemLabel(id)}</span>
              <button type="button" onClick={() => unfix(i)} aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
                className="w-4 h-4 shrink-0 rounded text-fg-muted hover:text-fg-primary">×</button>
            </span>
          ))}
        </div>
      )}

      {verdictLine && (
        <div className="px-2 py-1.5 rounded border border-accent-a40 bg-accent-a8 text-xs font-medium text-fg-bright">{star ? `${'★'.repeat(star)} · ` : ''}{verdictLine}</div>
      )}

      {err ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <span className="text-xs text-fg-secondary">
            {t(err === 'busy' ? 'tft.explorer.x.err.busy' : err === 'timeout' ? 'tft.explorer.x.err.timeout'
              : err === 'notReady' ? 'tft.explorer.x.err.notReady' : 'tft.explorer.x.err.unavailable')}
          </span>
          <button type="button" onClick={onRetry}
            className="px-3 py-1.5 rounded-md border border-accent-a50 bg-accent-a15 text-xs text-fg-bright hover:bg-accent-a25">
            {t('tft.explorer.x.retry')}
          </button>
        </div>
      ) : !shown || !starReady ? (
        <div className="flex flex-col gap-1" aria-busy="true">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <div key={i} className="h-8 rounded bg-surface-overlay/50 animate-pulse" />)}
        </div>
      ) : (
        <div className={`transition-opacity duration-150 ${stale ? 'opacity-60' : ''}`} aria-busy={stale}>
          <div className={`${COLS} px-1 pb-1 text-[10px] uppercase tracking-wide text-fg-muted`}>
            <span />
            <span className="text-right">{t('tft.explorer.sort.avg')}</span>
            <span className="text-right">{t('tft.top4')}</span>
            <span className="hidden @[30rem]:block text-right">{t('tft.top1')}</span>
            <span className="text-right">{t('tft.games')}</span>
            <span />
          </div>
          {rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-fg-muted">—</div>
          ) : (
            <ul className="max-h-[26rem] overflow-y-auto flex flex-col gap-0.5">
              {rows.map(r => {
                const on = box.compare.includes(r.restKey);
                const fixable = canFix(box.fixed.length, r.rest);
                const faint = r.thin || (r.half != null && isWeakRow({ matches: r.matches, half: r.half }));
                const label = r.rest.map(itemLabel).join(' + ');
                const copies = r.rest.length === 1 ? box.fixed.filter(id => id === r.rest[0]).length + 1 : 1;
                const body = (
                  <>
                    <span className="flex items-center gap-0.5 shrink-0">
                      {r.rest.map((id, i) => <OptIcon key={`${id}-${i}`} src={itemImg(id)} alt={itemLabel(id)} className="w-6 h-6" />)}
                    </span>
                    {r.rest.length === 1 && (
                      <span className="truncate text-xs text-fg-primary">
                        {copies > 1 && <span className="text-gold-earnings mr-1">{copies}×</span>}
                        {itemLabel(r.rest[0])}
                      </span>
                    )}
                    {r.rest.length > 1 && <span className="truncate text-[11px] text-fg-secondary">{label}</span>}
                  </>
                );
                return (
                  <li key={r.restKey} className={`${COLS} px-1 py-0.5 rounded ${on ? 'bg-accent-a15 ring-1 ring-accent-a50' : 'hover:bg-surface-overlay'}`}>
                    {fixable ? (
                      <button type="button" onClick={() => fix(r)} title={`${t('tft.build.fix')}: ${label}`} className="flex items-center gap-1.5 min-w-0 text-left">{body}</button>
                    ) : (
                      <span title={label} className="flex items-center gap-1.5 min-w-0">{body}</span>
                    )}
                    <span className={`text-right text-xs tabular-nums ${faint ? 'text-fg-muted' : 'text-fg-bright'}`}>
                      {r.avg == null ? '—' : fmtAvg(r.avg)}
                      {r.half != null && r.games >= MIN_GAMES_FOR_RANGE && <span className="text-[10px] text-fg-muted"> ±{r.half.toFixed(2)}</span>}
                    </span>
                    <span className={`text-right text-xs tabular-nums ${faint ? 'text-fg-muted' : 'text-fg-secondary'}`}>{fmtPct0(r.top4)}</span>
                    <span className={`hidden @[30rem]:block text-right text-xs tabular-nums ${faint ? 'text-fg-muted' : 'text-fg-secondary'}`}>{fmtPct0(r.top1)}</span>
                    <span className="text-right text-[11px] tabular-nums text-fg-muted">{r.noData ? (capped ? '—' : '<5') : num(r.games)}</span>
                    {canCompare(r) ? (
                      <button type="button" onClick={() => toggleCompare(r.restKey)} aria-pressed={on} aria-label={`${t('tft.build.compare')}: ${label}`} title={t('tft.build.compare')}
                        className={`w-6 h-6 flex items-center justify-center rounded ${on ? 'text-accent' : 'text-fg-muted hover:text-fg-primary'}`}>
                        <svg aria-hidden="true" viewBox="0 0 20 20" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M4 7h11M12 4l3 3-3 3M16 13H5M8 10l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : <span />}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

'use client';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import {
  EXPLORER_LIMITS, ITEM_KINDS, filterCount,
  type ExplorerQuery, type FilterGroup, type ItemFilter, type ItemKind, type TraitFilter, type UnitFilter,
} from '../../../lib/tft-explorer-query';
import {
  itemImg, itemName, traitImg, traitMin, traitName, unitImg, unitName, type ExplorerOptions,
} from './explorer-options';

// Filter-Chips (mit/ohne, Sterne, Items, Trait-Stufe), Level und Platz,
// Kaesten „eins davon" / „keins davon" plus Auswahl zum Hinzufuegen. Grenzen
// wie in parseExplorerParams (EXPLORER_LIMITS): 9 Units, 6 Items, 6 Traits,
// 3 Kaesten mit je 6 Gliedern, 15 Bedingungen insgesamt.

type Kind = 'units' | 'items' | 'traits';
const LIMIT: Record<Kind, number> = { units: EXPLORER_LIMITS.units, items: EXPLORER_LIMITS.items, traits: EXPLORER_LIMITS.traits };
const LEVELS = [6, 7, 8, 9, 10];
const PLACES = [1, 2, 3, 4, 5, 6, 7, 8];
const KIND_LABEL: Record<ItemKind, TranslationKey> = {
  artifact: 'tft.item.bucket.artifact', emblem: 'tft.item.bucket.emblem', radiant: 'tft.item.bucket.radiant',
};

// Wohin die Auswahl hinzufuegt: Hauptleiste, Kasten Nr. g oder ein neuer Kasten.
type Target = 'main' | number | 'any' | 'none';

const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;
const addBtn = (on: boolean) =>
  `px-3 py-1.5 rounded-md text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'bg-surface-base border-border-subtle text-fg-primary hover:border-accent-a40'}`;

const groupSize = (g: FilterGroup) => g.units.length + g.items.length + g.traits.length;

function patchList<T extends { id: string }>(arr: T[], id: string, patch: Partial<T> | null): T[] {
  return patch === null ? arr.filter(f => f.id !== id) : arr.map(f => (f.id === id ? { ...f, ...patch } : f));
}

function Icon({ src, alt, className = 'w-6 h-6', border }: { src: string | null; alt: string; className?: string; border?: string }) {
  if (!src) return <span className={`${className} rounded bg-surface-overlay shrink-0`} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" className={`${className} rounded object-cover shrink-0`} style={border ? { boxShadow: `inset 0 0 0 1.5px ${border}` } : undefined} />;
}

// Spanne als Knopf-Zustand: mind. / genau / hoechstens; eine echte Spanne
// (nur ueber Links, z. B. s2-3) hat keinen Modus.
type Mode = 'min' | 'exact' | 'max';
const MODE_LABEL: Record<Mode, TranslationKey> = { min: 'tft.explorer.x.atLeast', exact: 'tft.explorer.x.exact', max: 'tft.explorer.x.atMost' };
function spanMode(lo: number | undefined, hi: number | undefined, min: number): { mode: Mode | null; v: number | null } {
  if (lo == null && hi == null) return { mode: null, v: null };
  if (hi == null) return { mode: 'min', v: lo! };
  if (lo === hi) return { mode: 'exact', v: hi };
  if (lo == null || lo === min) return { mode: 'max', v: hi };
  return { mode: null, v: null };
}
function spanText(lo: number | undefined, hi: number | undefined, min: number, unit: (v: number) => string): string | null {
  const m = spanMode(lo, hi, min);
  if (m.mode === 'min') return `≥${unit(m.v!)}`;
  if (m.mode === 'exact') return unit(m.v!);
  if (m.mode === 'max') return `≤${unit(m.v!)}`;
  return lo != null && hi != null ? `${lo}–${unit(hi)}` : null;
}

export default function ExplorerFilters({
  query, setQuery, options, assets,
}: {
  query: ExplorerQuery;
  setQuery: (q: ExplorerQuery) => void;
  options: ExplorerOptions;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);   // "m:u:ID" | "0:i:ID" | "lv" | "pl"
  const [rawTarget, setTarget] = useState<Target | null>(null);
  // Kasten verschwunden (entfernt, letzter Eintrag weg): Auswahl zu.
  const target = typeof rawTarget === 'number' && !query.groups[rawTarget] ? null : rawTarget;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Klick ausserhalb schliesst das offene Einstellfenster.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const total = filterCount(query);
  const full = total >= EXPLORER_LIMITS.total;

  const setGroup = (g: number, fn: (gr: FilterGroup) => FilterGroup) => setQuery({
    ...query, groups: query.groups.map((gr, i) => (i === g ? fn(gr) : gr)).filter(gr => groupSize(gr) > 0),
  });
  const setUnit = (g: number | null, id: string, p: Partial<UnitFilter> | null) => (g == null
    ? setQuery({ ...query, units: patchList(query.units, id, p) })
    : setGroup(g, gr => ({ ...gr, units: patchList(gr.units, id, p) })));
  const setItem = (g: number | null, id: string, p: Partial<ItemFilter> | null) => (g == null
    ? setQuery({ ...query, items: patchList(query.items, id, p) })
    : setGroup(g, gr => ({ ...gr, items: patchList(gr.items, id, p) })));
  const setTrait = (g: number | null, id: string, p: Partial<TraitFilter> | null) => (g == null
    ? setQuery({ ...query, traits: patchList(query.traits, id, p) })
    : setGroup(g, gr => ({ ...gr, traits: patchList(gr.traits, id, p) })));

  const add = (kind: Kind, id: string) => {
    if (full || target == null) return;
    if (target === 'main') {
      if (query[kind].some(f => f.id === id) || query[kind].length >= LIMIT[kind]) return;
      setQuery({ ...query, [kind]: [...query[kind], { id }] });
    } else if (typeof target === 'number') {
      const gr = query.groups[target];
      if (!gr || gr[kind].some(f => f.id === id) || groupSize(gr) >= EXPLORER_LIMITS.groupMembers) return;
      setGroup(target, x => ({ ...x, [kind]: [...x[kind], { id }] }));
    } else {
      if (query.groups.length >= EXPLORER_LIMITS.groups) return;
      const gr: FilterGroup = { m: target, units: [], items: [], traits: [], [kind]: [{ id }] };
      setQuery({ ...query, groups: [...query.groups, gr] });
      setTarget(query.groups.length);
    }
  };
  const toggleTarget = (next: Target) => setTarget(target === next ? null : next);

  // Chips einer Liste (Hauptleiste g = null, sonst Kasten g).
  const chips = (g: number | null, units: UnitFilter[], items: ItemFilter[], traits: TraitFilter[]) => {
    const pre = g == null ? 'm' : String(g);
    const inGroup = g != null;
    const toggle = (key: string) => setOpen(open === key ? null : key);
    return <>
      {units.map(u => {
        const key = `${pre}:u:${u.id}`;
        const stars = spanText(u.s, u.sx, 1, v => '★'.repeat(v));
        const cnt = spanText(u.n, u.nx, 0, v => `${v}i`);
        return (
          <Chip key={key} excluded={!!u.x} open={open === key} onToggle={() => toggle(key)}
            onRemove={() => setUnit(g, u.id, null)} removeLabel={t('tft.explorer.x.remove')}
            label={<>
              <Icon src={unitImg(options, assets, u.id)} alt={unitName(options, assets, u.id)} border={costColor(options.unitById.get(u.id)?.cost ?? 1)} />
              <span className="truncate max-w-[9rem]">{unitName(options, assets, u.id)}</span>
              {stars && <span className="text-gold-earnings">{stars}</span>}
              {cnt && <span className="text-fg-muted">{cnt}</span>}
              {u.c ? <span className="text-fg-muted">{'≥'}{u.c}{'×'}</span> : null}
              {(u.k ?? []).map(e => <span key={e.b} className="text-fg-muted">{'≥'}{e.n} {t(KIND_LABEL[e.b])}</span>)}
              {(u.it ?? []).map((i, n) => <Icon key={`${i}${n}`} src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />)}
              {(u.nit ?? []).map(i => <span key={i} className="relative opacity-60"><Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" /><span className="absolute inset-0 flex items-center justify-center text-pos-loss text-xs font-bold">{'∕'}</span></span>)}
            </>}>
            <UnitEditor u={u} set={p => setUnit(g, u.id, p)} options={options} assets={assets} inGroup={inGroup} />
          </Chip>
        );
      })}
      {items.map(i => {
        const key = `${pre}:i:${i.id}`;
        return (
          <Chip key={key} excluded={!!i.x} open={open === key} onToggle={() => toggle(key)}
            onRemove={() => setItem(g, i.id, null)} removeLabel={t('tft.explorer.x.remove')}
            label={<>
              <Icon src={itemImg(options, assets, i.id)} alt={itemName(options, assets, i.id)} />
              <span className="truncate max-w-[9rem]">{itemName(options, assets, i.id)}</span>
              {i.n ? <span className="text-fg-muted">{'≥'}{i.n}{'×'}</span> : null}
            </>}>
            <ItemEditor i={i} set={p => setItem(g, i.id, p)} inGroup={inGroup} />
          </Chip>
        );
      })}
      {traits.map(tr => {
        const key = `${pre}:t:${tr.id}`;
        const min = tr.l ? traitMin(options, assets, tr.id, tr.l) : null;
        const mins = options.traitById.get(tr.id)?.mins ?? [];
        return (
          <Chip key={key} excluded={!!tr.x} open={open === key} onToggle={() => toggle(key)}
            onRemove={() => setTrait(g, tr.id, null)} removeLabel={t('tft.explorer.x.remove')}
            label={<>
              <Icon src={traitImg(options, assets, tr.id)} alt={traitName(options, assets, tr.id)} className="w-5 h-5" />
              <span className="truncate max-w-[9rem]">{traitName(options, assets, tr.id)}</span>
              {min != null && <span className="text-fg-muted">{tr.le ? '' : '≥'}{min}</span>}
            </>}>
            {(!inGroup || mins.length > 1) ? <TraitEditor tr={tr} set={p => setTrait(g, tr.id, p)} mins={mins} inGroup={inGroup} /> : null}
          </Chip>
        );
      })}
    </>;
  };

  const hasAny = total > 0 || query.levels.length > 0 || query.place != null;
  const place = query.place ?? [1, 8];
  const setPlace = (lo: number, hi: number) => setQuery({ ...query, place: lo === 1 && hi === 8 ? null : [lo, hi] });

  // Auswahl: was ist im Ziel schon gewaehlt, ist es voll?
  const tgtGroup = typeof target === 'number' ? query.groups[target] : null;
  const chosen = (kind: Kind) => new Set((target === 'main' ? query[kind] : tgtGroup ? tgtGroup[kind] : []).map(f => f.id));
  const isFull = (kind: Kind) => full || (target === 'main' ? query[kind].length >= LIMIT[kind]
    : tgtGroup ? groupSize(tgtGroup) >= EXPLORER_LIMITS.groupMembers : query.groups.length >= EXPLORER_LIMITS.groups);
  const canNewGroup = !full && query.groups.length < EXPLORER_LIMITS.groups;

  return (
    <div ref={wrapRef} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {chips(null, query.units, query.items, query.traits)}
        <button type="button" onClick={() => toggleTarget('main')} className={addBtn(target === 'main')}>
          + {t('tft.explorer.units')} / {t('tft.explorer.items')} / {t('tft.explorer.traits')}
        </button>
        {(['any', 'none'] as const).map(m => (
          <button key={m} type="button" disabled={!canNewGroup && target !== m} onClick={() => toggleTarget(m)}
            className={`${addBtn(target === m)} disabled:opacity-40 disabled:pointer-events-none`}>
            + {t(m === 'any' ? 'tft.explorer.x.anyOf' : 'tft.explorer.x.noneOf')}
          </button>
        ))}
        <PlainChip label={t('tft.explorer.x.playerLevel')} value={query.levels.length ? query.levels.join(', ') : null}
          open={open === 'lv'} onToggle={() => setOpen(open === 'lv' ? null : 'lv')} onClear={() => setQuery({ ...query, levels: [] })}>
          <Row label={t('tft.explorer.x.playerLevel')}>
            <button type="button" className={seg(query.levels.length === 0)} onClick={() => setQuery({ ...query, levels: [] })}>{t('tft.explorer.x.any')}</button>
            {LEVELS.map(l => {
              const on = query.levels.includes(l);
              return (
                <button key={l} type="button" className={seg(on)} aria-pressed={on}
                  onClick={() => setQuery({ ...query, levels: on ? query.levels.filter(x => x !== l) : [...query.levels, l].sort((a, b) => a - b) })}>
                  {l}
                </button>
              );
            })}
          </Row>
        </PlainChip>
        <PlainChip label={t('tft.explorer.x.place')} value={query.place ? (place[0] === place[1] ? String(place[0]) : `${place[0]}–${place[1]}`) : null}
          open={open === 'pl'} onToggle={() => setOpen(open === 'pl' ? null : 'pl')} onClear={() => setQuery({ ...query, place: null })}>
          <Row label={t('tft.explorer.x.from')}>
            {PLACES.map(p => (
              <button key={p} type="button" className={seg(place[0] === p)} onClick={() => setPlace(p, Math.max(p, place[1]))}>{p}</button>
            ))}
          </Row>
          <Row label={t('tft.explorer.x.to')}>
            {PLACES.map(p => (
              <button key={p} type="button" className={seg(place[1] === p)} onClick={() => setPlace(Math.min(p, place[0]), p)}>{p}</button>
            ))}
          </Row>
        </PlainChip>
        {hasAny && (
          <button type="button" onClick={() => {
            setTarget(null);
            setQuery({ ...query, units: [], items: [], traits: [], groups: [], levels: [], place: null, focus: null });
          }}
            className="text-xs text-fg-muted hover:text-fg-primary underline-offset-2 hover:underline">
            {t('tft.explorer.resetAll')}
          </button>
        )}
      </div>

      {query.groups.length > 0 && (
        <div className="flex flex-wrap items-start gap-2">
          {query.groups.map((gr, g) => (
            <div key={g}
              className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-2 ${gr.m === 'none' ? 'border-pos-loss' : 'border-accent-a50'} ${target === g ? 'bg-accent-a8' : ''}`}>
              <span className={`text-[11px] ${gr.m === 'none' ? 'text-pos-loss' : 'text-fg-muted'}`}>
                {t(gr.m === 'any' ? 'tft.explorer.x.anyOf' : 'tft.explorer.x.noneOf')}
              </span>
              {chips(g, gr.units, gr.items, gr.traits)}
              <button type="button" onClick={() => toggleTarget(g)} aria-pressed={target === g}
                disabled={target !== g && (full || groupSize(gr) >= EXPLORER_LIMITS.groupMembers)}
                className={`${seg(target === g)} disabled:opacity-40 disabled:pointer-events-none`}>{'+'}</button>
              <button type="button" onClick={() => { setTarget(null); setQuery({ ...query, groups: query.groups.filter((_, i) => i !== g) }); }}
                aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
                className="px-1 text-fg-muted hover:text-fg-primary">{'×'}</button>
            </div>
          ))}
        </div>
      )}

      {target != null && (
        <Picker options={options} onAdd={add} chosen={chosen} isFull={isFull}
          counts={target === 'main' ? (k => `${query[k].length}/${LIMIT[k]}`) : null} />
      )}
    </div>
  );
}

function Chip({
  label, excluded, open, onToggle, onRemove, removeLabel, children,
}: {
  label: React.ReactNode; excluded: boolean; open: boolean; onToggle: () => void; onRemove: () => void; removeLabel: string;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <div className={`flex items-center rounded-md border text-xs ${excluded ? 'border-pos-loss bg-surface-base' : 'border-accent-a40 bg-accent-a8'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1 text-fg-primary ${excluded ? 'line-through decoration-pos-loss' : ''}`}>
          {excluded && <span className="text-pos-loss no-underline">{t('tft.explorer.x.without')}</span>}
          {label}
        </button>
        <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel}
          className="px-1.5 py-1 text-fg-muted hover:text-fg-primary border-l border-border-subtle">{'×'}</button>
      </div>
      {open && children && <Popover>{children}</Popover>}
    </div>
  );
}

function Popover({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute z-30 left-0 top-full mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-xl space-y-3">
      {children}
    </div>
  );
}

// Level / Platz: immer da; gesetzt = hervorgehoben mit ×.
function PlainChip({
  label, value, open, onToggle, onClear, children,
}: { label: string; value: string | null; open: boolean; onToggle: () => void; onClear: () => void; children: React.ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <div className={`flex items-center rounded-md border text-xs ${value ? 'border-accent-a40 bg-accent-a8' : 'border-border-subtle bg-surface-base'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 ${value ? 'text-fg-primary' : 'text-fg-secondary hover:text-fg-primary'}`}>
          {label}
          {value && <span className="text-fg-bright tabular-nums">{value}</span>}
        </button>
        {value && (
          <button type="button" onClick={onClear} aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
            className="px-1.5 py-1 text-fg-muted hover:text-fg-primary border-l border-border-subtle">{'×'}</button>
        )}
      </div>
      {open && <Popover>{children}</Popover>}
    </div>
  );
}

function WithWithout({ x, set }: { x: boolean; set: (x: boolean) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-1">
      <button type="button" className={seg(!x)} onClick={() => set(false)}>{t('tft.explorer.x.with')}</button>
      <button type="button" className={seg(x)} onClick={() => set(true)}>{t('tft.explorer.x.without')}</button>
    </div>
  );
}

function MinExact({ exact, set, disabled }: { exact: boolean; set: (e: boolean) => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <div className={`flex gap-1 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <button type="button" className={seg(!exact)} onClick={() => set(false)}>{t('tft.explorer.x.atLeast')}</button>
      <button type="button" className={seg(exact)} onClick={() => set(true)}>{t('tft.explorer.x.exact')}</button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

// Werte + mind./genau/hoechstens. Der Modus gilt fuer den naechsten Klick auf
// einen Wert; „0" bei „mind." heisst „genau 0" (mind. 0 waere egal).
function SpanRow({
  label, lo, hi, min, values, fmt, set,
}: {
  label: string; lo: number | undefined; hi: number | undefined; min: number; values: number[];
  fmt: (v: number) => string; set: (lo: number | undefined, hi: number | undefined) => void;
}) {
  const { t } = useI18n();
  const cur = spanMode(lo, hi, min);
  const [pref, setPref] = useState<Mode>(cur.mode ?? 'min');
  const mode = cur.mode ?? pref;
  const pick = (v: number, m: Mode) => (m === 'min' && v === 0 ? set(0, 0) : m === 'min' ? set(v, undefined) : m === 'exact' ? set(v, v) : set(undefined, v));
  const isOn = (v: number) => (cur.mode ? cur.v === v : v === lo || v === hi);
  return (
    <Row label={label}>
      <button type="button" className={seg(lo == null && hi == null)} onClick={() => set(undefined, undefined)}>{t('tft.explorer.x.any')}</button>
      {values.map(v => (
        <button key={v} type="button" className={seg(isOn(v))} onClick={() => pick(v, mode)}>{fmt(v)}</button>
      ))}
      <span className="w-2" />
      <div className="flex gap-1">
        {(['min', 'exact', 'max'] as const).map(m => (
          <button key={m} type="button" className={seg(mode === m)}
            onClick={() => { setPref(m); if (cur.v != null) pick(cur.v, m); }}>
            {t(MODE_LABEL[m])}
          </button>
        ))}
      </div>
    </Row>
  );
}

function UnitEditor({
  u, set, options, assets, inGroup,
}: { u: UnitFilter; set: (p: Partial<UnitFilter>) => void; options: ExplorerOptions; assets: TftAssetsBundle | null; inGroup: boolean }) {
  const { t } = useI18n();
  const withItems = u.it ?? [];
  const withoutItems = u.nit ?? [];
  const setKind = (b: ItemKind, n: number | undefined) => {
    const k = (u.k ?? []).filter(e => e.b !== b);
    set({ k: n ? [...k, { b, n }] : k });
  };
  return (
    <>
      {!inGroup && <WithWithout x={!!u.x} set={x => set({ x })} />}
      <SpanRow label={t('tft.explorer.starLevel')} lo={u.s} hi={u.sx} min={1} values={[1, 2, 3, 4]} fmt={v => `${v}★`}
        set={(s, sx) => set({ s, sx })} />
      <SpanRow label={t('tft.explorer.itemsCount')} lo={u.n} hi={u.nx} min={0} values={[0, 1, 2, 3]} fmt={String}
        set={(n, nx) => set({ n, nx })} />
      <Row label={t('tft.explorer.x.copies')}>
        <button type="button" className={seg(!u.c)} onClick={() => set({ c: undefined })}>{t('tft.explorer.x.any')}</button>
        {[2, 3].map(c => (
          <button key={c} type="button" className={seg(u.c === c)} onClick={() => set({ c })}>{'≥'}{c}</button>
        ))}
      </Row>
      <Row label={t('tft.explorer.x.withItem')}>
        {withItems.map((i, n) => (
          <button key={`${i}${n}`} type="button" onClick={() => set({ it: withItems.filter((_, j) => j !== n) })}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle text-xs text-fg-primary hover:border-pos-loss">
            <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />
            <span className="truncate max-w-[7rem]">{itemName(options, assets, i)}</span>
            <span className="text-fg-muted">{'×'}</span>
          </button>
        ))}
        {withItems.length < 3 && (
          <select value="" onChange={e => e.target.value && set({ it: [...withItems, e.target.value] })}
            className="bg-surface-base border border-border-subtle rounded text-xs text-fg-primary px-1.5 py-0.5 max-w-[11rem]">
            <option value="">+</option>
            {options.items.filter(i => !withoutItems.includes(i.id)).map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
      </Row>
      <Row label={t('tft.explorer.x.withoutItem')}>
        {withoutItems.map(i => (
          <button key={i} type="button" onClick={() => set({ nit: withoutItems.filter(x => x !== i) })}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle text-xs text-fg-primary hover:border-pos-loss">
            <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />
            <span className="truncate max-w-[7rem]">{itemName(options, assets, i)}</span>
            <span className="text-fg-muted">{'×'}</span>
          </button>
        ))}
        {withoutItems.length < 3 && (
          <select value="" onChange={e => e.target.value && set({ nit: [...withoutItems, e.target.value] })}
            className="bg-surface-base border border-border-subtle rounded text-xs text-fg-primary px-1.5 py-0.5 max-w-[11rem]">
            <option value="">+</option>
            {options.items.filter(i => !withItems.includes(i.id) && !withoutItems.includes(i.id)).map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
      </Row>
      <Row label={t('tft.explorer.x.itemKind')}>
        <div className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1">
          {ITEM_KINDS.map(b => {
            const cur = u.k?.find(e => e.b === b)?.n;
            return (
              <Fragment key={b}>
                <span className="text-[11px] text-fg-secondary">{t(KIND_LABEL[b])}</span>
                <div className="flex gap-1">
                  <button type="button" className={seg(cur == null)} onClick={() => setKind(b, undefined)}>{t('tft.explorer.x.any')}</button>
                  {[1, 2, 3].map(n => (
                    <button key={n} type="button" className={seg(cur === n)} onClick={() => setKind(b, n)}>{'≥'}{n}</button>
                  ))}
                </div>
              </Fragment>
            );
          })}
        </div>
      </Row>
    </>
  );
}

function ItemEditor({ i, set, inGroup }: { i: ItemFilter; set: (p: Partial<ItemFilter>) => void; inGroup: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {!inGroup && <WithWithout x={!!i.x} set={x => set({ x })} />}
      <Row label={t('tft.explorer.x.onBoard')}>
        {[1, 2, 3].map(n => (
          <button key={n} type="button" className={seg((i.n ?? 1) === n)} onClick={() => set({ n: n === 1 ? undefined : n })}>{'≥'}{n}</button>
        ))}
      </Row>
    </>
  );
}

function TraitEditor({ tr, set, mins, inGroup }: { tr: TraitFilter; set: (p: Partial<TraitFilter>) => void; mins: number[]; inGroup: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {!inGroup && <WithWithout x={!!tr.x} set={x => set({ x })} />}
      {mins.length > 1 && (
        <Row label={t('tft.explorer.x.level')}>
          <button type="button" className={seg(!tr.l)} onClick={() => set({ l: undefined, le: undefined })}>{t('tft.explorer.x.any')}</button>
          {mins.map((m, i) => (
            <button key={i} type="button" className={seg(tr.l === i + 1)} onClick={() => set({ l: i + 1 })}>{m}</button>
          ))}
          <span className="w-2" />
          <MinExact exact={!!tr.le} set={le => set({ le })} disabled={!tr.l} />
        </Row>
      )}
    </>
  );
}

function Picker({
  options, onAdd, chosen, isFull, counts,
}: {
  options: ExplorerOptions; onAdd: (k: Kind, id: string) => void;
  chosen: (k: Kind) => Set<string>; isFull: (k: Kind) => boolean; counts: ((k: Kind) => string) | null;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>('units');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const picked = chosen(kind);
  const full = isFull(kind);

  const list = useMemo(() => {
    const src: { id: string; name: string; img: string | null; border?: string }[] =
      kind === 'units' ? options.units.map(u => ({ id: u.id, name: u.name, img: u.img, border: costColor(u.cost) }))
      : kind === 'items' ? options.items
      : options.traits;
    return needle ? src.filter(x => x.name.toLowerCase().includes(needle)) : src;
  }, [kind, options, needle]);

  return (
    <div className="rounded-lg border border-border-subtle bg-surface-base p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {(['units', 'items', 'traits'] as const).map(k => (
          <button key={k} type="button" className={seg(kind === k)} onClick={() => setKind(k)}>
            {t(k === 'units' ? 'tft.explorer.units' : k === 'items' ? 'tft.explorer.items' : 'tft.explorer.traits')}
            {counts && <span className="text-fg-muted ml-1">{counts(k)}</span>}
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tft.explorer.x.search')} aria-label={t('tft.explorer.x.search')}
          className="flex-1 min-w-[10rem] bg-surface-page border border-border-subtle rounded-md text-xs text-fg-primary px-2 py-1" />
      </div>
      <div className={`grid gap-1.5 max-h-72 overflow-y-auto ${kind === 'units' ? 'grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]'}`}>
        {list.map(x => {
          const on = picked.has(x.id);
          const disabled = on || full;
          return kind === 'units' ? (
            <button key={x.id} type="button" disabled={disabled} onClick={() => onAdd(kind, x.id)} title={x.name}
              className={`flex flex-col items-center gap-0.5 p-0.5 rounded ${on ? 'opacity-30' : disabled ? 'opacity-50' : 'hover:bg-surface-overlay'}`}>
              <Icon src={x.img} alt={x.name} className="w-10 h-10" border={x.border} />
              <span className="text-[10px] text-fg-secondary truncate w-full text-center">{x.name}</span>
            </button>
          ) : (
            <button key={x.id} type="button" disabled={disabled} onClick={() => onAdd(kind, x.id)}
              className={`flex items-center gap-2 px-1.5 py-1 rounded text-left text-xs text-fg-primary ${on ? 'opacity-30' : disabled ? 'opacity-50' : 'hover:bg-surface-overlay'}`}>
              <Icon src={x.img} alt={x.name} className="w-6 h-6" />
              <span className="truncate">{x.name}</span>
            </button>
          );
        })}
        {list.length === 0 && <div className="text-xs text-fg-muted col-span-full">{t('tft.explorer.noResults')}</div>}
      </div>
    </div>
  );
}

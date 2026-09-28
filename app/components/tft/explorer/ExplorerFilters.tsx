'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import type { ExplorerQuery, ItemFilter, TraitFilter, UnitFilter } from '../../../lib/tft-explorer-query';
import {
  itemImg, itemName, traitImg, traitMin, traitName, unitImg, unitName, type ExplorerOptions,
} from './explorer-options';

// Filter-Chips (mit/ohne, Sterne, Items, Trait-Stufe) plus Auswahl zum
// Hinzufuegen. Grenzen wie in parseExplorerParams: 9 Units, 6 Items, 6 Traits.

type Kind = 'units' | 'items' | 'traits';
const LIMIT: Record<Kind, number> = { units: 9, items: 6, traits: 6 };

const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;

function Icon({ src, alt, className = 'w-6 h-6', border }: { src: string | null; alt: string; className?: string; border?: string }) {
  if (!src) return <span className={`${className} rounded bg-surface-overlay shrink-0`} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" className={`${className} rounded object-cover shrink-0`} style={border ? { boxShadow: `inset 0 0 0 1.5px ${border}` } : undefined} />;
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
  const [open, setOpen] = useState<string | null>(null);   // "u:ID" | "i:ID" | "t:ID"
  const [picker, setPicker] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Klick ausserhalb schliesst das offene Einstellfenster.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const setUnit = (id: string, patch: Partial<UnitFilter> | null) => setQuery({
    ...query,
    units: patch === null ? query.units.filter(u => u.id !== id) : query.units.map(u => (u.id === id ? clean({ ...u, ...patch }) : u)),
  });
  const setItem = (id: string, patch: Partial<ItemFilter> | null) => setQuery({
    ...query,
    items: patch === null ? query.items.filter(i => i.id !== id) : query.items.map(i => (i.id === id ? clean({ ...i, ...patch }) : i)),
  });
  const setTrait = (id: string, patch: Partial<TraitFilter> | null) => setQuery({
    ...query,
    traits: patch === null ? query.traits.filter(x => x.id !== id) : query.traits.map(x => (x.id === id ? clean({ ...x, ...patch }) : x)),
  });

  const add = (kind: Kind, id: string) => {
    if (query[kind].some(f => f.id === id) || query[kind].length >= LIMIT[kind]) return;
    setQuery({ ...query, [kind]: [...query[kind], { id }] });
  };

  const total = query.units.length + query.items.length + query.traits.length;

  return (
    <div ref={wrapRef} className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {query.units.map(u => (
          <Chip key={`u:${u.id}`} excluded={!!u.x} open={open === `u:${u.id}`} onToggle={() => setOpen(open === `u:${u.id}` ? null : `u:${u.id}`)}
            onRemove={() => setUnit(u.id, null)} removeLabel={t('tft.explorer.x.remove')}
            label={<>
              <Icon src={unitImg(options, assets, u.id)} alt={unitName(options, assets, u.id)} border={costColor(options.unitById.get(u.id)?.cost ?? 1)} />
              <span className="truncate max-w-[9rem]">{unitName(options, assets, u.id)}</span>
              {u.s ? <span className="text-gold-earnings">{u.se ? '' : '≥'}{'★'.repeat(u.s)}</span> : null}
              {u.n ? <span className="text-fg-muted">{'≥'}{u.n}i</span> : null}
              {(u.it ?? []).map(i => <Icon key={i} src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />)}
              {(u.nit ?? []).map(i => <span key={i} className="relative opacity-60"><Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" /><span className="absolute inset-0 flex items-center justify-center text-pos-loss text-xs font-bold">{'∕'}</span></span>)}
            </>}>
            <UnitEditor u={u} set={p => setUnit(u.id, p)} options={options} assets={assets} />
          </Chip>
        ))}
        {query.items.map(i => (
          <Chip key={`i:${i.id}`} excluded={!!i.x} open={open === `i:${i.id}`} onToggle={() => setOpen(open === `i:${i.id}` ? null : `i:${i.id}`)}
            onRemove={() => setItem(i.id, null)} removeLabel={t('tft.explorer.x.remove')}
            label={<>
              <Icon src={itemImg(options, assets, i.id)} alt={itemName(options, assets, i.id)} />
              <span className="truncate max-w-[9rem]">{itemName(options, assets, i.id)}</span>
            </>}>
            <WithWithout x={!!i.x} set={x => setItem(i.id, { x })} />
          </Chip>
        ))}
        {query.traits.map(tr => {
          const min = tr.l ? traitMin(options, assets, tr.id, tr.l) : null;
          return (
            <Chip key={`t:${tr.id}`} excluded={!!tr.x} open={open === `t:${tr.id}`} onToggle={() => setOpen(open === `t:${tr.id}` ? null : `t:${tr.id}`)}
              onRemove={() => setTrait(tr.id, null)} removeLabel={t('tft.explorer.x.remove')}
              label={<>
                <Icon src={traitImg(options, assets, tr.id)} alt={traitName(options, assets, tr.id)} className="w-5 h-5" />
                <span className="truncate max-w-[9rem]">{traitName(options, assets, tr.id)}</span>
                {min != null && <span className="text-fg-muted">{tr.le ? '' : '≥'}{min}</span>}
              </>}>
              <TraitEditor tr={tr} set={p => setTrait(tr.id, p)} mins={options.traitById.get(tr.id)?.mins ?? []} />
            </Chip>
          );
        })}
        <button type="button" onClick={() => setPicker(p => !p)}
          className={`px-3 py-1.5 rounded-md text-xs border ${picker ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'bg-surface-base border-border-subtle text-fg-primary hover:border-accent-a40'}`}>
          + {t('tft.explorer.units')} / {t('tft.explorer.items')} / {t('tft.explorer.traits')}
        </button>
        {total > 0 && (
          <button type="button" onClick={() => setQuery({ ...query, units: [], items: [], traits: [], focus: null })}
            className="text-xs text-fg-muted hover:text-fg-primary underline-offset-2 hover:underline">
            {t('tft.explorer.resetAll')}
          </button>
        )}
      </div>

      {picker && <Picker query={query} options={options} onAdd={add} />}
    </div>
  );
}

// Leere Zusaetze aus dem Filter werfen, damit die URL kurz bleibt.
function clean<T extends object>(f: T): T {
  const o = { ...f } as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v === undefined || v === false || v === 0 || (Array.isArray(v) && v.length === 0)) delete o[k];
  }
  return o as T;
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
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-xl space-y-3">
          {children}
        </div>
      )}
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

function UnitEditor({
  u, set, options, assets,
}: { u: UnitFilter; set: (p: Partial<UnitFilter>) => void; options: ExplorerOptions; assets: TftAssetsBundle | null }) {
  const { t } = useI18n();
  const itemSelect = (field: 'it' | 'nit', label: string) => {
    const cur = u[field] ?? [];
    return (
      <Row label={label}>
        {cur.map(i => (
          <button key={i} type="button" onClick={() => set({ [field]: cur.filter(x => x !== i) })}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle text-xs text-fg-primary hover:border-pos-loss">
            <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />
            <span className="truncate max-w-[7rem]">{itemName(options, assets, i)}</span>
            <span className="text-fg-muted">{'×'}</span>
          </button>
        ))}
        {cur.length < 3 && (
          <select value="" onChange={e => e.target.value && set({ [field]: [...cur, e.target.value] })}
            className="bg-surface-base border border-border-subtle rounded text-xs text-fg-primary px-1.5 py-0.5 max-w-[11rem]">
            <option value="">+</option>
            {options.items.filter(i => !(u.it ?? []).includes(i.id) && !(u.nit ?? []).includes(i.id)).map(i => (
              <option key={i.id} value={i.id}>{i.name}</option>
            ))}
          </select>
        )}
      </Row>
    );
  };
  return (
    <>
      <WithWithout x={!!u.x} set={x => set({ x })} />
      <Row label={t('tft.explorer.starLevel')}>
        <button type="button" className={seg(!u.s)} onClick={() => set({ s: undefined, se: undefined })}>{t('tft.explorer.x.any')}</button>
        {[1, 2, 3, 4].map(s => (
          <button key={s} type="button" className={seg(u.s === s)} onClick={() => set({ s })}>{s}{'★'}</button>
        ))}
        <span className="w-2" />
        <MinExact exact={!!u.se} set={se => set({ se })} disabled={!u.s} />
      </Row>
      <Row label={t('tft.explorer.itemsCount')}>
        <button type="button" className={seg(!u.n)} onClick={() => set({ n: undefined })}>{t('tft.explorer.x.any')}</button>
        {[1, 2, 3].map(n => (
          <button key={n} type="button" className={seg(u.n === n)} onClick={() => set({ n })}>{'≥'}{n}</button>
        ))}
      </Row>
      {itemSelect('it', t('tft.explorer.x.withItem'))}
      {itemSelect('nit', t('tft.explorer.x.withoutItem'))}
    </>
  );
}

function TraitEditor({ tr, set, mins }: { tr: TraitFilter; set: (p: Partial<TraitFilter>) => void; mins: number[] }) {
  const { t } = useI18n();
  return (
    <>
      <WithWithout x={!!tr.x} set={x => set({ x })} />
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

function Picker({ query, options, onAdd }: { query: ExplorerQuery; options: ExplorerOptions; onAdd: (k: Kind, id: string) => void }) {
  const { t } = useI18n();
  const [kind, setKind] = useState<Kind>('units');
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const chosen = useMemo(() => new Set(query[kind].map(f => f.id)), [query, kind]);
  const full = query[kind].length >= LIMIT[kind];

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
            <span className="text-fg-muted ml-1">{query[k].length}/{LIMIT[k]}</span>
          </button>
        ))}
        <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tft.explorer.x.search')} aria-label={t('tft.explorer.x.search')}
          className="flex-1 min-w-[10rem] bg-surface-page border border-border-subtle rounded-md text-xs text-fg-primary px-2 py-1" />
      </div>
      <div className={`grid gap-1.5 max-h-72 overflow-y-auto ${kind === 'units' ? 'grid-cols-[repeat(auto-fill,minmax(3.25rem,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]'}`}>
        {list.map(x => {
          const on = chosen.has(x.id);
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

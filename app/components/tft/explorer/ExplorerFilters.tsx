'use client';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { TftAssetsBundle } from '../../../lib/tft-cdragon';
import {
  BOARD_TAGS, EXPLORER_LIMITS, ITEM_KINDS, canonBoardCounts, filterCount, serializeExplorerQuery,
  type BoardCountKey, type BoardTag, type ExplorerQuery, type ExplorerResponse, type ExplorerRow, type FilterGroup, type ItemFilter, type ItemKind,
  type TraitFilter, type UnitFilter,
} from '../../../lib/tft-explorer-query';
import type { ItemBucket } from '../../../lib/tft-item-bucket';
import {
  itemFitsUnit, itemImg, itemName, traitImg, traitMin, traitName, unitImg, unitName, type ExplorerOptions,
} from './explorer-options';
import { applyPhrase, applyPick, normText, type LastRef, type Op, type PhraseTerm, type Pick } from './explorer-search';
import ExplorerSearchBox, { ITEM_GROUPS, OptIcon, itemGroupOf } from './ExplorerSearchBox';
import { useFilterDrag } from './explorer-drag';
import type { DragSrc, Where } from './explorer-move';
import { COPLAY_MAX, coplayChosen, coplayPick } from '../../../lib/tft-explorer-coplay.mjs';

// Filterleiste (Plan 19.10.2026, Teil C1): eine Suchzeile fuer Units, Items und
// Synergien (ExplorerSearchBox), darunter die Bausteine — Hauptliste mit „und",
// Kaesten mit „oder" (Kasten = eins davon). Level, Platz und Brett bleiben eigene
// Knoepfe. „ohne" und „keins davon" gibt es nur noch aus alten Links: sie werden
// angezeigt und lassen sich entfernen, aber nicht mehr neu anlegen. Grenzen wie
// in parseExplorerParams (EXPLORER_LIMITS).

const LEVELS = [6, 7, 8, 9, 10];
const PLACES = [1, 2, 3, 4, 5, 6, 7, 8];
const KIND_LABEL: Record<ItemKind, TranslationKey> = {
  artifact: 'tft.item.bucket.artifact', emblem: 'tft.item.bucket.emblem', radiant: 'tft.item.bucket.radiant',
};

// Brett-Zaehler (Paket B) im Brett-Fenster: Gruppen wie bei MetaTFT, Werte
// je Zaehler; hoehere Werte gehen ueber „mind.". tr steht nicht hier, sondern
// als Schalter „Keine Traits" (tr = genau 0).
const BOARD_ROWS: { head: TranslationKey; rows: { k: BoardCountKey; values: number[] }[] }[] = [
  { head: 'tft.explorer.items', rows: [
    { k: 'emb', values: [0, 1, 2, 3, 4] }, { k: 'rad', values: [0, 1, 2, 3, 4] },
    { k: 'art', values: [0, 1, 2, 3, 4] }, { k: 'norm', values: [0, 2, 4, 6, 8, 10] },
  ] },
  { head: 'tft.explorer.units', rows: [
    { k: 's3', values: [0, 1, 2, 3] }, { k: 's4', values: [0, 1, 2] }, { k: 'dup', values: [0, 1, 2, 3] },
    ...(['k1', 'k2', 'k3', 'k4', 'k5'] as const).map(k => ({ k, values: [0, 1, 2, 3, 4, 5, 6] })),
  ] },
  { head: 'tft.explorer.traits', rows: [{ k: 'bronze', values: [0, 1, 2, 3, 4, 5] }, { k: 'extra', values: [0, 1, 2, 3] }] },
];
const TAG_LABEL: Record<BoardTag, TranslationKey> = {
  shred: 'tft.explorer.x.tag.shred', sunder: 'tft.explorer.x.tag.sunder', wound: 'tft.explorer.x.tag.wound',
};
function boardLabel(t: (k: TranslationKey) => string, k: BoardCountKey): string {
  switch (k) {
    case 'emb': return t(KIND_LABEL.emblem);
    case 'rad': return t(KIND_LABEL.radiant);
    case 'art': return t(KIND_LABEL.artifact);
    case 'norm': return t('tft.explorer.x.bc.norm');
    case 's3': return t('tft.explorer.x.bc.s3');
    case 's4': return t('tft.explorer.x.bc.s4');
    case 'dup': return t('tft.explorer.x.bc.dup');
    case 'bronze': return t('tft.explorer.x.bc.bronze');
    case 'extra': return t('tft.explorer.x.bc.extra');
    case 'tr': return t('tft.explorer.x.bc.noTraits');
    default: return t('tft.explorer.x.bc.cost').replace('{n}', k.slice(1));
  }
}

const seg = (on: boolean) =>
  `px-2 py-0.5 rounded text-xs border ${on ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`;

const groupSize = (g: FilterGroup) => g.units.length + g.items.length + g.traits.length;

function patchList<T extends { id: string }>(arr: T[], id: string, patch: Partial<T> | null): T[] {
  return patch === null ? arr.filter(f => f.id !== id) : arr.map(f => (f.id === id ? { ...f, ...patch } : f));
}

function Icon({ src, alt, className = 'w-8 h-8', border }: { src: string | null; alt: string; className?: string; border?: string }) {
  if (!src) return <span className={`${className} rounded bg-surface-overlay shrink-0`} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" draggable={false} className={`${className} rounded object-cover shrink-0`} style={border ? { boxShadow: `inset 0 0 0 1.5px ${border}` } : undefined} />;
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

// Liegt der zuletzt eingefuegte Baustein noch dort? Sonst haengt „oder" an nichts.
function refAlive(q: ExplorerQuery, r: LastRef): boolean {
  const list = (x: { units: UnitFilter[]; items: ItemFilter[]; traits: TraitFilter[] }) => (x[r.kind] as { id: string }[]).some(f => f.id === r.id);
  if (r.where === 'main') return list(q);
  const g = q.groups[r.where];
  return !!g && g.m === 'any' && list(g);
}
function firstRef(gr: FilterGroup, g: number): LastRef | null {
  if (gr.units[0]) return { kind: 'units', id: gr.units[0].id, where: g };
  if (gr.items[0]) return { kind: 'items', id: gr.items[0].id, where: g };
  if (gr.traits[0]) return { kind: 'traits', id: gr.traits[0].id, where: g };
  return null;
}

export default function ExplorerFilters({
  query, setQuery, options, assets, data, dataQuery,
}: {
  query: ExplorerQuery;
  /** now: Anfrage ohne die kurze Verzoegerung (einzelner Klick auf Treffer/Vorschlag). */
  setQuery: (q: ExplorerQuery, opts?: { now?: boolean }) => void;
  options: ExplorerOptions;
  assets: TftAssetsBundle | null;
  data: ExplorerResponse | null;
  dataQuery: ExplorerQuery | null;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);   // "m:u:ID" | "0:i:ID" | "lv" | "pl" | "bc"
  const [mode, setMode] = useState<Op>('and');
  const [rawLast, setLast] = useState<LastRef | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const last = rawLast && refAlive(query, rawLast) ? rawLast : null;
  const wrapRef = useRef<HTMLDivElement>(null);
  // Ziehen & Ablegen (W3): eine Ablage = ein setQuery, danach haengt „oder" an nichts mehr.
  const dnd = useFilterDrag({
    query,
    fits: (unit, item, carried) => itemFitsUnit(options, unit, item, carried),
    onDrop: q => { setQuery(q); setLast(null); },
    onStart: () => setOpen(null),
  });

  // Klick ausserhalb schliesst das offene Einstellfenster.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrapRef.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  // Suchzeile: Begriffe davor als Satz, dann der gewaehlte Treffer.
  const onApply = (prefix: PhraseTerm[], pick: Pick | null, pickOp: Op | null): string[] => {
    let next = query;
    let ref = last;
    let missed: string[] = [];
    if (prefix.length) {
      const r = applyPhrase(next, prefix, options, mode, ref);
      next = r.query; ref = r.last; missed = r.missed;
    }
    if (pick) {
      const r = applyPick(next, pick, pickOp ?? (prefix.length ? 'and' : mode), ref);
      next = r.query; ref = r.last;
    }
    if (next !== query) setQuery(next, { now: true });
    setLast(ref);
    return missed;
  };

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

  const toggle = (key: string) => setOpen(open === key ? null : key);
  const pre = (g: number | null) => (g == null ? 'm' : String(g));
  const at = (g: number | null): Where => (g == null ? 'main' : g);
  // „ohne"-Bausteine und „keins davon"-Kaesten (nur alte Links) werden nicht gezogen.
  const movable = (g: number | null, f: { x?: boolean }) => !f.x && (g == null || query.groups[g]?.m === 'any');
  const ghostOf = (img: string | null, name: string, border?: string) => <><Icon src={img} alt={name} border={border} /><span className="truncate max-w-[10rem]">{name}</span></>;
  const sourceOf = (g: number | null, f: { x?: boolean }, src: DragSrc, ghost: React.ReactNode) =>
    (movable(g, f) ? dnd.source(src, ghost) : undefined);

  const unitChip = (g: number | null, u: UnitFilter) => {
    const key = `${pre(g)}:u:${u.id}`;
    const stars = spanText(u.s, u.sx, 1, v => '★'.repeat(v));
    const cnt = spanText(u.n, u.nx, 0, v => `${v}i`);
    const drop = { kind: 'unit', id: u.id, at: at(g) } as const;
    const border = costColor(options.unitById.get(u.id)?.cost ?? 1);
    return (
      <Chip key={key} excluded={!!u.x} open={open === key} onToggle={() => toggle(key)} wide
        onRemove={() => setUnit(g, u.id, null)} removeLabel={t('tft.explorer.x.remove')}
        drag={sourceOf(g, u, { kind: 'units', id: u.id, from: at(g) }, ghostOf(unitImg(options, assets, u.id), unitName(options, assets, u.id), border))}
        drop={dnd.target(drop)} over={dnd.isOver(drop)}
        label={<>
          <Icon src={unitImg(options, assets, u.id)} alt={unitName(options, assets, u.id)} border={border} className="w-8 h-8" />
          <span className="truncate max-w-[10rem]">{unitName(options, assets, u.id)}</span>
          {stars && <span className="text-gold-earnings">{stars}</span>}
          {cnt && <span className="text-fg-muted">{cnt}</span>}
          {u.c ? <span className="text-fg-muted">{'≥'}{u.c}{'×'}</span> : null}
          {(u.k ?? []).map(e => <span key={e.b} className="text-fg-muted">{'≥'}{e.n} {t(KIND_LABEL[e.b])}</span>)}
          {/* Jedes Item-Bild ist eine eigene Quelle; ::before vergroessert die Greifflaeche unsichtbar. */}
          {(u.it ?? []).map((i, n) => (
            <span key={`${i}${n}`} className="relative before:absolute before:-inset-1"
              {...sourceOf(g, u, { kind: 'unitItem', unit: u.id, from: at(g), index: n }, <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} />)}>
              <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-5 h-5" />
            </span>
          ))}
          {(u.nit ?? []).map(i => <span key={i} className="relative opacity-60"><Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-5 h-5" /><span className="absolute inset-0 flex items-center justify-center text-pos-loss text-sm font-bold">{'∕'}</span></span>)}
        </>}>
        <UnitEditor u={u} set={p => setUnit(g, u.id, p)} options={options} assets={assets} inGroup={g != null} />
      </Chip>
    );
  };
  const itemChip = (g: number | null, i: ItemFilter) => {
    const key = `${pre(g)}:i:${i.id}`;
    return (
      <Chip key={key} excluded={!!i.x} open={open === key} onToggle={() => toggle(key)}
        onRemove={() => setItem(g, i.id, null)} removeLabel={t('tft.explorer.x.remove')}
        drag={sourceOf(g, i, { kind: 'items', id: i.id, from: at(g) }, ghostOf(itemImg(options, assets, i.id), itemName(options, assets, i.id)))}
        label={<>
          <Icon src={itemImg(options, assets, i.id)} alt={itemName(options, assets, i.id)} className="w-8 h-8" />
          <span className="truncate max-w-[10rem]">{itemName(options, assets, i.id)}</span>
          {i.n ? <span className="text-fg-muted">{'≥'}{i.n}{'×'}</span> : null}
        </>}>
        <ItemEditor i={i} set={p => setItem(g, i.id, p)} inGroup={g != null} />
      </Chip>
    );
  };
  const traitChip = (g: number | null, tr: TraitFilter) => {
    const key = `${pre(g)}:t:${tr.id}`;
    const min = tr.l ? traitMin(options, assets, tr.id, tr.l) : null;
    const mins = options.traitById.get(tr.id)?.mins ?? [];
    return (
      <Chip key={key} excluded={!!tr.x} open={open === key} onToggle={() => toggle(key)}
        onRemove={() => setTrait(g, tr.id, null)} removeLabel={t('tft.explorer.x.remove')}
        drag={sourceOf(g, tr, { kind: 'traits', id: tr.id, from: at(g) }, ghostOf(traitImg(options, assets, tr.id), traitName(options, assets, tr.id)))}
        label={<>
          <Icon src={traitImg(options, assets, tr.id)} alt={traitName(options, assets, tr.id)} className="w-7 h-7" />
          <span className="truncate max-w-[10rem]">{traitName(options, assets, tr.id)}</span>
          {min != null && <span className="text-fg-muted">{tr.le ? '' : '≥'}{min}</span>}
        </>}>
        {(mins.length > 1 || tr.x) ? <TraitEditor tr={tr} set={p => setTrait(g, tr.id, p)} mins={mins} inGroup={g != null} /> : null}
      </Chip>
    );
  };

  // Kasten: Glieder mit „oder"; „+" haengt die naechste Suche an diesen Kasten.
  const box = (gr: FilterGroup, g: number) => {
    const none = gr.m === 'none';
    const members = [...gr.units.map(u => unitChip(g, u)), ...gr.items.map(i => itemChip(g, i)), ...gr.traits.map(x => traitChip(g, x))];
    const zone = { kind: 'zone', at: g } as const;
    const active = !none && ((mode === 'or' && last?.where === g) || dnd.isOver(zone));
    return (
      <div key={`g${g}`} {...dnd.target(zone)} className={`flex flex-wrap items-center gap-1.5 rounded-lg border border-dashed px-1.5 py-1 ${
        none ? 'border-pos-loss' : 'border-accent-a50'} ${active ? 'bg-accent-a8' : ''}`}>
        {none && <span className="text-xs text-pos-loss">{t('tft.explorer.x.noneOf')}</span>}
        {members.map((m, i) => <Fragment key={i}>{i > 0 && !none && <Sep op="or" />}{m}</Fragment>)}
        {!none && groupSize(gr) < EXPLORER_LIMITS.groupMembers && (
          <button type="button" onClick={() => { setMode('or'); setLast(firstRef(gr, g)); setFocusKey(k => k + 1); }}
            aria-label={`+ ${t('tft.explorer.x.or')}`} title={`+ ${t('tft.explorer.x.or')}`}
            className="w-8 h-8 flex items-center justify-center rounded border border-border-subtle text-sm text-fg-secondary hover:border-accent-a50 hover:text-fg-bright">+</button>
        )}
        <button type="button" onClick={() => setQuery({ ...query, groups: query.groups.filter((_, i) => i !== g) })}
          aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
          className="px-1 text-fg-muted hover:text-fg-primary">{'×'}</button>
      </div>
    );
  };

  const conds = [
    ...query.units.map(u => unitChip(null, u)),
    ...query.items.map(i => itemChip(null, i)),
    ...query.traits.map(tr => traitChip(null, tr)),
    ...query.groups.map((gr, g) => box(gr, g)),
  ];

  const hasAny = filterCount(query) > 0 || query.levels.length > 0 || query.place != null || query.bc.length > 0 || query.tags.length > 0;
  const place = query.place ?? [1, 8];
  const setPlace = (lo: number, hi: number) => setQuery({ ...query, place: lo === 1 && hi === 8 ? null : [lo, hi] });
  const setCount = (k: BoardCountKey, n: number | undefined, nx: number | undefined) => setQuery({
    ...query, bc: canonBoardCounts([...query.bc.filter(e => e.k !== k), ...(n == null && nx == null ? [] : [{ k, n, nx }])]),
  });
  const toggleTag = (tag: BoardTag) => setQuery({
    ...query, tags: query.tags.includes(tag) ? query.tags.filter(x => x !== tag) : BOARD_TAGS.filter(x => x === tag || query.tags.includes(x)),
  });
  const boardValue = [
    ...query.bc.map(e => (e.k === 'tr' ? boardLabel(t, 'tr') : `${spanText(e.n, e.nx, 0, String) ?? ''} ${boardLabel(t, e.k)}`)),
    ...query.tags.map(x => t(TAG_LABEL[x])),
  ].join(', ') || null;

  return (
    <div ref={wrapRef} className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <PlainChip label={t('tft.explorer.x.playerLevel')} value={query.levels.length ? query.levels.join(', ') : null}
          open={open === 'lv'} onToggle={() => toggle('lv')} onClear={() => setQuery({ ...query, levels: [] })}>
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
          open={open === 'pl'} onToggle={() => toggle('pl')} onClear={() => setQuery({ ...query, place: null })}>
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
        <PlainChip label={t('tft.explorer.x.board')} value={boardValue} wide
          open={open === 'bc'} onToggle={() => toggle('bc')} onClear={() => setQuery({ ...query, bc: [], tags: [] })}>
          {BOARD_ROWS.map(sec => (
            <div key={sec.head} className="space-y-2">
              <div className="text-xs font-medium text-fg-secondary">{t(sec.head)}</div>
              {sec.rows.map(r => {
                const cur = query.bc.find(e => e.k === r.k);
                return (
                  <SpanRow key={r.k} label={boardLabel(t, r.k)} lo={cur?.n} hi={cur?.nx} min={0} values={r.values} fmt={String}
                    set={(n, nx) => setCount(r.k, n, nx)} />
                );
              })}
              {sec.head === 'tft.explorer.traits' && (() => {
                const on = query.bc.some(e => e.k === 'tr' && e.n === 0 && e.nx === 0);
                return (
                  <button type="button" className={seg(on)} aria-pressed={on} onClick={() => setCount('tr', on ? undefined : 0, on ? undefined : 0)}>
                    {boardLabel(t, 'tr')}
                  </button>
                );
              })()}
            </div>
          ))}
          <Row label={t('tft.explorer.x.tags')}>
            {BOARD_TAGS.map(tag => (
              <button key={tag} type="button" className={seg(query.tags.includes(tag))} aria-pressed={query.tags.includes(tag)} onClick={() => toggleTag(tag)}>
                {t(TAG_LABEL[tag])}
              </button>
            ))}
          </Row>
        </PlainChip>
        <ExplorerSearchBox options={options} mode={mode} setMode={setMode} onApply={onApply} focusKey={focusKey} onFocus={() => setOpen(null)} />
        {hasAny && (
          <button type="button" onClick={() => {
            setLast(null);
            setMode('and');
            setQuery({ ...query, units: [], items: [], traits: [], groups: [], levels: [], place: null, bc: [], tags: [], focus: null });
          }}
            className="text-xs text-fg-muted hover:text-fg-primary underline-offset-2 hover:underline">
            {t('tft.explorer.resetAll')}
          </button>
        )}
      </div>

      {conds.length > 0 && (
        // Freie Flaeche = Hauptzeile. Leuchtet beim Ziehen wie ein aktiver Kasten;
        // ring statt Innenabstand, damit nichts verrutscht.
        <div {...dnd.target({ kind: 'zone', at: 'main' })}
          className={`flex flex-wrap items-center gap-1.5 rounded-lg ${dnd.isOver({ kind: 'zone', at: 'main' }) ? 'bg-accent-a8 ring-4 ring-accent-a8' : ''}`}>
          {conds.map((c, i) => <Fragment key={i}>{i > 0 && <Sep op="and" />}{c}</Fragment>)}
        </div>
      )}
      {dnd.ghost}

      <CoplayRow query={query} data={data} dataQuery={dataQuery} options={options} assets={assets}
        onAdd={id => onApply([], { kind: 'units', f: { id } }, 'and')} />
    </div>
  );
}

function Sep({ op }: { op: Op }) {
  const { t } = useI18n();
  return <span className="text-xs text-fg-faint">{t(op === 'and' ? 'tft.explorer.x.and' : 'tft.explorer.x.or')}</span>;
}

function Chip({
  label, excluded, open, onToggle, onRemove, removeLabel, children, wide = false, drag, drop, over = false,
}: {
  label: React.ReactNode; excluded: boolean; open: boolean; onToggle: () => void; onRemove: () => void; removeLabel: string;
  children: React.ReactNode; wide?: boolean;
  /** Ziehbar (Zeiger-Props aus useFilterDrag). */
  drag?: { onPointerDown: (e: React.PointerEvent) => void };
  /** Ablageziel; over = gerade gueltiges Ziel unter dem Zeiger. */
  drop?: Record<string, string>;
  over?: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className="relative" {...drop}>
      <div className={`flex items-center rounded-md border text-sm ${
        over ? 'border-accent-a50 bg-accent-a20' : excluded ? 'border-pos-loss bg-surface-base' : 'border-accent-a40 bg-accent-a8'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open} {...drag}
          className={`flex items-center gap-1.5 pl-1.5 pr-2 py-1 min-h-10 text-fg-primary ${drag ?'select-none [-webkit-touch-callout:none]' : ''} ${excluded ? 'line-through decoration-pos-loss' : ''}`}>
          {excluded && <span className="text-pos-loss no-underline">{t('tft.explorer.x.without')}</span>}
          {label}
        </button>
        <button type="button" onClick={onRemove} aria-label={removeLabel} title={removeLabel}
          className="self-stretch flex items-center px-2 text-fg-muted hover:text-fg-primary border-l border-border-subtle">{'×'}</button>
      </div>
      {open && children && <Popover wide={wide}>{children}</Popover>}
    </div>
  );
}

// Abstand zum Fensterrand, wenn ein Einstellfenster nach links ausweicht.
const POPOVER_EDGE = 8;

// Ab sm haengt das Fenster links am Baustein. Ragt es rechts ueber den Rand,
// rueckt es um den Ueberstand nach links, nie ueber den linken Rand hinaus.
// Handy: Blatt unten, kein Versatz. Direkt am Element statt ueber den Zustand,
// damit Messen und Verschieben in derselben Darstellung passieren.
function placePopover(el: HTMLDivElement | null) {
  if (!el) return;
  el.style.transform = '';
  if (!window.matchMedia('(min-width: 640px)').matches) return;
  const r = el.getBoundingClientRect();
  const over = r.right - (document.documentElement.clientWidth - POPOVER_EDGE);
  const shift = Math.max(0, Math.min(over, r.left - POPOVER_EDGE));
  if (shift > 0.5) el.style.transform = `translateX(-${shift}px)`;
}

function Popover({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  // Nach jeder Darstellung messen: der Baustein waechst beim Bearbeiten
  // (Item-Bilder im Namen) und kann umbrechen.
  useLayoutEffect(() => placePopover(ref.current));
  useEffect(() => {
    const onResize = () => placePopover(ref.current);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return (
    // Handy: als Blatt am unteren Rand, sonst ragt es neben einem rechten Baustein aus dem Bild.
    <div ref={ref}
      className={`z-30 rounded-lg border border-border-subtle bg-surface-raised p-3 shadow-xl space-y-3 max-sm:fixed max-sm:inset-x-3 max-sm:bottom-3 max-sm:max-h-[70vh] max-sm:overflow-y-auto sm:absolute sm:left-0 sm:top-full sm:mt-1 ${
      wide ? 'sm:w-[26rem] sm:max-h-[70vh] sm:overflow-y-auto' : 'sm:w-[20rem]'}`}>
      {children}
    </div>
  );
}

// Level / Platz / Brett: immer da; gesetzt = hervorgehoben mit ×.
function PlainChip({
  label, value, open, onToggle, onClear, children, wide = false,
}: { label: string; value: string | null; open: boolean; onToggle: () => void; onClear: () => void; children: React.ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="relative">
      <div className={`flex items-center rounded-md border text-xs ${value ? 'border-accent-a40 bg-accent-a8' : 'border-border-subtle bg-surface-base'}`}>
        <button type="button" onClick={onToggle} aria-expanded={open}
          className={`flex items-center gap-1.5 px-3 py-2 ${value ? 'text-fg-primary' : 'text-fg-secondary hover:text-fg-primary'}`}>
          {label}
          {value && <span className="text-fg-bright tabular-nums truncate max-w-[16rem]">{value}</span>}
        </button>
        {value && (
          <button type="button" onClick={onClear} aria-label={t('tft.explorer.x.remove')} title={t('tft.explorer.x.remove')}
            className="self-stretch flex items-center px-2 text-fg-muted hover:text-fg-primary border-l border-border-subtle">{'×'}</button>
        )}
      </div>
      {open && <Popover wide={wide}>{children}</Popover>}
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
  const withoutItems = u.nit ?? [];
  const setKind = (b: ItemKind, n: number | undefined) => {
    const k = (u.k ?? []).filter(e => e.b !== b);
    set({ k: n ? [...k, { b, n }] : k });
  };
  return (
    <>
      {/* „ohne" nur noch aus alten Links: zurueck auf „mit" stellen geht. */}
      {!inGroup && u.x && <WithWithout x set={x => set({ x })} />}
      <SpanRow label={t('tft.explorer.starLevel')} lo={u.s} hi={u.sx} min={1} values={[1, 2, 3, 4]} fmt={v => `${v}★`}
        set={(s, sx) => set({ s, sx })} />
      <SpanRow label={t('tft.explorer.itemsCount')} lo={u.n} hi={u.nx} min={0} values={[0, 1, 2, 3]} fmt={String}
        set={(n, nx) => set({ n, nx })} />
      <Row label={t('tft.explorer.x.withItem')}>
        <ItemIconPicker chosen={u.it ?? []} max={3} options={options} assets={assets} onChange={it => set({ it })}
          fits={(id, carried) => itemFitsUnit(options, u.id, id, carried)} />
      </Row>
      {withoutItems.length > 0 && (
        <Row label={t('tft.explorer.x.withoutItem')}>
          {withoutItems.map(i => (
            <button key={i} type="button" onClick={() => set({ nit: withoutItems.filter(x => x !== i) })}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-border-subtle text-xs text-fg-primary hover:border-pos-loss">
              <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-4 h-4" />
              <span className="truncate max-w-[7rem]">{itemName(options, assets, i)}</span>
              <span className="text-fg-muted">{'×'}</span>
            </button>
          ))}
        </Row>
      )}
      <Row label={t('tft.explorer.x.copies')}>
        <button type="button" className={seg(!u.c)} onClick={() => set({ c: undefined })}>{t('tft.explorer.x.any')}</button>
        {[2, 3].map(c => (
          <button key={c} type="button" className={seg(u.c === c)} onClick={() => set({ c })}>{'≥'}{c}</button>
        ))}
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

// Knoepfe je Item-Sorte (Plan 24.10.2026, W2), Reihenfolge wie vom User genannt.
const PICK_KINDS: ItemBucket[] = ['standard', 'artifact', 'emblem', 'radiant'];

// Items an der Unit als Bilder waehlen (bis zu max). Jede Sorte hat ihren
// Knopf und zeigt nur ihre Liste; beim Tippen wird ueber alle Sorten gesucht.
// fits: Spielregel je Item (Emblem doppelt / eigener Trait) — sonst gesperrt.
function ItemIconPicker({
  chosen, max, options, assets, onChange, fits,
}: {
  chosen: string[]; max: number; options: ExplorerOptions; assets: TftAssetsBundle | null; onChange: (it: string[]) => void;
  fits?: (id: string, carried: string[]) => boolean;
}) {
  const { t } = useI18n();
  const [kind, setKind] = useState<ItemBucket | null>(null);
  const [q, setQ] = useState('');
  const needle = normText(q);
  const groups = ITEM_GROUPS
    .filter(g => needle || g.b === kind)
    .map(g => ({ ...g, list: options.items.filter(i => itemGroupOf(i) === g.b && (!needle || normText(i.name).includes(needle))) }))
    .filter(g => g.list.length);
  const full = chosen.length >= max;
  const open = kind != null;
  const pickKind = (b: ItemBucket) => { setKind(kind === b ? null : b); setQ(''); };
  return (
    <div className="w-full space-y-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {chosen.map((i, n) => (
          <button key={`${i}${n}`} type="button" onClick={() => onChange(chosen.filter((_, j) => j !== n))}
            title={`${itemName(options, assets, i)} — ${t('tft.explorer.x.remove')}`}
            className="flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded border border-border-subtle text-xs text-fg-primary hover:border-pos-loss">
            <Icon src={itemImg(options, assets, i)} alt={itemName(options, assets, i)} className="w-6 h-6" />
            <span className="text-fg-muted">{'×'}</span>
          </button>
        ))}
        {!full && PICK_KINDS.map(b => (
          <button key={b} type="button" className={seg(kind === b)} aria-expanded={kind === b} onClick={() => pickKind(b)}>
            + {t(b === 'standard' ? 'tft.explorer.items' : `tft.item.bucket.${b}` as TranslationKey)}
          </button>
        ))}
      </div>
      {open && !full && (
        <div className="rounded-md border border-border-subtle bg-surface-base p-2 space-y-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t('tft.explorer.x.search')} aria-label={t('tft.explorer.x.search')}
            className="w-full bg-surface-page border border-border-subtle rounded text-xs text-fg-primary px-2 py-1" />
          <div className="max-h-56 overflow-y-auto space-y-2 pr-1">
            {groups.map(g => (
              <div key={g.b}>
                <div className="text-[10px] uppercase tracking-wide text-fg-faint mb-1">{t(g.label)}</div>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1">
                  {g.list.map(i => {
                    const ok = !fits || fits(i.id, chosen);
                    return (
                      <button key={i.id} type="button" title={i.name} aria-label={i.name} disabled={!ok}
                        onClick={() => { onChange([...chosen, i.id]); if (chosen.length + 1 >= max) setKind(null); }}
                        className={`rounded p-0.5 ${ok ? 'hover:bg-surface-overlay' : 'opacity-40 cursor-not-allowed'}`}>
                        <OptIcon src={i.img} alt={i.name} className="w-8 h-8" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            {groups.length === 0 && <div className="text-xs text-fg-muted">{t('tft.explorer.x.notFound')}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemEditor({ i, set, inGroup }: { i: ItemFilter; set: (p: Partial<ItemFilter>) => void; inGroup: boolean }) {
  const { t } = useI18n();
  return (
    <>
      {!inGroup && i.x && <WithWithout x set={x => set({ x })} />}
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
      {!inGroup && tr.x && <WithWithout x set={x => set({ x })} />}
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

// „Oft zusammen mit …": Units des Units-Reiters fuer die aktuelle Auswahl,
// meistgespielte zuerst (Regel in app/lib/tft-explorer-coplay.mjs, die auch der
// Dienst zum Vorrechnen der Paare liest). Steht der Explorer schon auf diesem
// Reiter, kommen die Zeilen aus seiner Antwort, sonst aus einer eigenen Abfrage
// (gleiche Adresse wie der Reiter, also derselbe Zwischenspeicher).
const coplayCache = new Map<string, Promise<ExplorerResponse | null>>();
const coplayQuery = (q: ExplorerQuery): ExplorerQuery => ({ ...q, tab: 'units', stars: [], focus: null, split: null, combo: 1 });

function CoplayRow({
  query, data, dataQuery, options, assets, onAdd,
}: {
  query: ExplorerQuery; data: ExplorerResponse | null; dataQuery: ExplorerQuery | null;
  options: ExplorerOptions; assets: TftAssetsBundle | null; onAdd: (id: string) => void;
}) {
  const { t } = useI18n();
  const anchor = query.units.find(u => !u.x) ?? null;
  const qs = anchor ? serializeExplorerQuery(coplayQuery(query), { forApi: true }) : null;
  const own = qs && data && dataQuery && dataQuery.tab === 'units' && !dataQuery.stars.length
    && serializeExplorerQuery(coplayQuery(dataQuery), { forApi: true }) === qs ? data : null;
  // Ist die Hauptabfrage selbst schon diese Abfrage, auf ihre Antwort warten
  // statt dieselbe Anfrage ein zweites Mal zu schicken.
  const mainIsCoplay = qs != null && serializeExplorerQuery(query, { forApi: true }) === qs;
  const [fetched, setFetched] = useState<{ qs: string; data: ExplorerResponse | null } | null>(null);
  useEffect(() => {
    if (!qs || own || mainIsCoplay) return;
    let alive = true;
    const timer = setTimeout(() => {
      let p = coplayCache.get(qs);
      if (!p) {
        p = fetch(`/api/tft/explorer?${qs}`).then(r => (r.ok ? r.json() as Promise<ExplorerResponse> : null)).catch(() => null);
        coplayCache.set(qs, p);
        p.then(v => { if (!v) coplayCache.delete(qs); });
      }
      p.then(v => { if (alive) setFetched({ qs, data: v }); });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [qs, own, mainIsCoplay]);

  const src = own ?? (fetched && fetched.qs === qs ? fetched.data : null);
  if (!anchor || !src?.rows || !src.summary?.games) return null;
  const rows: ExplorerRow[] = coplayPick(src.rows, {
    chosen: coplayChosen(query), allow: (id: string) => options.unitById.has(id), max: COPLAY_MAX,
  });
  if (!rows.length) return null;
  const label = filterCount(query) === 1
    ? t('tft.explorer.x.coplayWith').replace('{unit}', unitName(options, assets, anchor.id))
    : t('tft.explorer.x.coplaySel');
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="text-xs text-fg-muted">{label}</span>
      {rows.map(r => {
        const u = options.unitById.get(r.key)!;
        return (
          <button key={r.key} type="button" onClick={() => onAdd(r.key)} title={u.name}
            className="flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-md border border-border-subtle bg-surface-base text-sm text-fg-primary hover:border-accent-a50">
            <OptIcon src={u.img} alt={u.name} className="w-8 h-8" border={costColor(u.cost)} />
            <span className="truncate max-w-[7rem]">{u.name}</span>
            <span className="text-fg-muted tabular-nums">{Math.round((r.games / src.summary.games) * 100)}%</span>
          </button>
        );
      })}
    </div>
  );
}

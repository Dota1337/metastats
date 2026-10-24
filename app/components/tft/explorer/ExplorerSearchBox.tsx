'use client';
// Suchzeile des Data Explorers (Plan 19.10.2026, Teil C1): ein Feld fuer Units,
// Items und Synergien mit Bild-Treffern. „und" / „oder" lassen sich tippen
// („Lux und Jinx oder Vex") oder ueber den Schalter waehlen. Logik in
// explorer-search.ts.
// Drop-down (Plan 24.10.2026): leeres Feld oder Pfeil oeffnet Reiter mit
// Bilder-Raster (Units, Item-Sorten, Synergien). Klick waehlt, zweiter Klick
// entfernt; das Fenster bleibt offen. Getippter Text zeigt die Trefferliste.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { ItemBucket } from '../../../lib/tft-item-bucket';
import type { ExplorerOptions, ItemOption } from './explorer-options';
import {
  ITEM_ORDER, PICK_KINDS, bestPick, browseTraits, browseUnits, currentTerm, gridMove, isPhrase, pickKey, searchOptions,
  splitPhrase, unitWithStars,
  type GridDir, type Op, type Pick, type PickKind, type PhraseTerm,
} from './explorer-search';

// Gleiche Reihenfolge wie ITEM_ORDER (bester Treffer = erster markierter).
export const ITEM_GROUPS: { b: ItemBucket; label: TranslationKey }[] = ITEM_ORDER.map(b => ({ b, label: `tft.item.bucket.${b}` as TranslationKey }));
export const itemGroupOf = (i: ItemOption): ItemBucket => (i.bucket === 'other' ? 'standard' : i.bucket);

export function OptIcon({ src, alt, className = 'w-6 h-6', border }: { src: string | null; alt: string; className?: string; border?: string }) {
  if (!src) return <span className={`${className} rounded bg-surface-overlay shrink-0`} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" className={`${className} rounded object-cover shrink-0`} style={border ? { boxShadow: `inset 0 0 0 1.5px ${border}` } : undefined} />;
}

// Aufklapp-Pfeil fuer Suchfeld, Knoepfe der Filterleiste und Bausteine; offen = nach oben.
export function Chevron({ open, className = 'w-4 h-4' }: { open: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" className={`${className} shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 8l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const quick = 'px-1.5 py-0.5 rounded border border-border-subtle text-[11px] text-fg-secondary hover:border-accent-a50 hover:text-fg-bright';

type BrowseTab = 'units' | ItemBucket | 'traits';
const tabLabel = (b: BrowseTab): TranslationKey => (b === 'units' ? 'tft.explorer.units' : b === 'traits' ? 'tft.explorer.traits'
  : b === 'standard' ? 'tft.explorer.items' : `tft.item.bucket.${b}` as TranslationKey);
const KEY_DIR: Record<string, GridDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
// Kachel 2rem + 0.25rem Abstand: die groesste Kostenstufe (14 Units) passt in eine Zeile.
const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,2rem)] gap-1';
const SKELETON = 14;

interface Cell { pick: Pick; name: string; img: string | null; border?: string }
type CellState = 'on' | 'out' | 'blocked' | null;

export default function ExplorerSearchBox({
  options, mode, setMode, onApply, focusKey, onFocus, chosen, blocked, onToggle, className = '',
}: {
  options: ExplorerOptions;
  mode: Op;
  setMode: (m: Op) => void;
  /** prefix: Begriffe vor dem aktuellen; pick: gewaehlter Treffer fuer den aktuellen (null = alle Begriffe). */
  onApply: (prefix: PhraseTerm[], pick: Pick | null, pickOp: Op | null) => string[];
  /** Aendert sich der Wert, bekommt das Feld den Fokus (z. B. „+" in einem Kasten). */
  focusKey: number;
  onFocus?: () => void;
  /** Raster: gewaehlte Bausteine (pickKey), out = „ohne"/„keins davon" aus alten Links. */
  chosen: { on: Set<string>; out: Set<string> };
  /** Raster: Grenze erreicht — kein weiterer Baustein dieser Art. */
  blocked: Record<PickKind, boolean>;
  /** Raster-Klick: waehlen oder (schon gewaehlt) ueberall entfernen. */
  onToggle: (p: Pick) => void;
  /** Lage in der Filterzeile (z. B. Reihenfolge am Handy). */
  className?: string;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // null = noch nicht mit Pfeilen gewaehlt: markiert ist der beste Treffer.
  const [hi, setHi] = useState<number | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const [tab, setTab] = useState<BrowseTab>('units');
  // Markierte Kachel im Raster (Maus, Pfeiltasten, zuletzt angetippt).
  const [act, setAct] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Fokus nach einer Treffer-Wahl soll das Raster nicht wieder oeffnen.
  const skipOpen = useRef(false);
  const listId = useId();

  // Der Fokus oeffnet das Fenster (onFocus), auch fuer „+" in einem Kasten —
  // blur vorher, damit onFocus auch bei schon fokussiertem Feld kommt (Safari).
  useEffect(() => {
    if (!focusKey) return;
    inputRef.current?.blur();
    inputRef.current?.focus();
  }, [focusKey]);
  // Passt der volle Platzhalter nicht ins Feld (Handy 375 px: Feld 167 px, Text 203 px), steht die Kurzform da.
  const [shortPh, setShortPh] = useState(false);
  useEffect(() => {
    const el = inputRef.current;
    const ctx = typeof ResizeObserver === 'undefined' ? null : document.createElement('canvas').getContext('2d');
    if (!el || !ctx) return;
    const full = t('tft.explorer.x.searchAll');
    const ro = new ResizeObserver(() => {
      ctx.font = getComputedStyle(el).font;
      setShortPh(ctx.measureText(full).width > el.clientWidth);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [t]);
  // Schliessen setzt zurueck: jedes neue Oeffnen beginnt bei den Units.
  const close = () => { setOpen(false); setTab('units'); setAct(null); };
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      setOpen(false); setTab('units'); setAct(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const terms = useMemo(() => splitPhrase(text, lang), [text, lang]);
  const phrase = isPhrase(terms);
  const term = useMemo(() => currentTerm(text, lang), [text, lang]);
  const res = useMemo(() => searchOptions(term, options), [term, options]);
  const preview = useMemo(() => (phrase ? terms.map(x => ({ op: x.op, pick: bestPick(x.text, options), text: x.text })) : []), [phrase, terms, options]);

  // Hauptaktion je Zeile in Anzeige-Reihenfolge (Pfeiltasten + Enter).
  const itemGroups = ITEM_GROUPS.map(g => ({ ...g, list: res.items.filter(i => itemGroupOf(i) === g.b) })).filter(g => g.list.length);
  const flat: Pick[] = [
    ...res.units.map(u => ({ kind: 'units' as const, f: { id: u.id } })),
    ...res.traits.map(x => ({ kind: 'traits' as const, f: { id: x.id } })),
    ...itemGroups.flatMap(g => g.list.map(i => ({ kind: 'items' as const, f: { id: i.id } }))),
  ];
  const idxOf = (kind: Pick['kind'], id: string) => flat.findIndex(p => p.kind === kind && p.f.id === id);
  const best = useMemo(() => (term ? bestPick(term, options) : null), [term, options]);
  const hiIdx = hi != null ? Math.min(hi, Math.max(0, flat.length - 1)) : (best ? Math.max(0, idxOf(best.kind, best.f.id)) : 0);

  // Raster: Reiter (leere Item-Sorten/Synergien fallen weg) und Kacheln je Abschnitt.
  const unitRows = useMemo(() => browseUnits(options.units), [options.units]);
  const traitRows = useMemo(() => browseTraits(options.traits), [options.traits]);
  const tabs = useMemo(() => (['units', ...PICK_KINDS, 'traits'] as BrowseTab[]).filter(b => b === 'units'
    || (b === 'traits' ? options.traits.length > 0 : options.items.some(i => itemGroupOf(i) === b))), [options]);
  const curTab = tabs.includes(tab) ? tab : 'units';
  const sections: Cell[][] = useMemo(() => {
    if (curTab === 'units') {
      return unitRows.map(r => r.map(u => ({ pick: { kind: 'units' as const, f: { id: u.id } }, name: u.name, img: u.img, border: costColor(u.cost) })));
    }
    if (curTab === 'traits') return traitRows.map(r => r.map(x => ({ pick: { kind: 'traits' as const, f: { id: x.id } }, name: x.name, img: x.img })));
    const list = options.items.filter(i => itemGroupOf(i) === curTab);
    return list.length ? [list.map(i => ({ pick: { kind: 'items' as const, f: { id: i.id } }, name: i.name, img: i.img }))] : [];
  }, [curTab, unitRows, traitRows, options.items]);
  const cells = sections.flat();
  const browse = text.trim() === '';
  const showBrowse = open && browse;
  const cellId = (i: number) => `${listId}-c${i}`;
  const tabId = (b: BrowseTab) => `${listId}-t-${b}`;
  const stateOf = (c: Cell): CellState => {
    const k = pickKey(c.pick.kind, c.pick.f.id);
    return chosen.on.has(k) ? 'on' : chosen.out.has(k) ? 'out' : blocked[c.pick.kind] ? 'blocked' : null;
  };
  const toggleCell = (i: number) => {
    const c = cells[i];
    if (!c) return;
    setAct(i);
    if (stateOf(c) === 'blocked') return;
    setMissed([]);
    onToggle(c.pick);
  };
  const pickTab = (b: BrowseTab) => { setTab(b); setAct(null); };
  // Spalten des Rasters (fuer hoch/runter), aus dem ersten Abschnitt gemessen.
  const gridCols = () => {
    const el = gridRef.current?.querySelector<HTMLElement>('[data-grid]');
    return el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : 1;
  };

  const done = (miss: string[]) => {
    setMissed(miss);
    setText('');
    setHi(null);
    close();
    skipOpen.current = true;
    inputRef.current?.focus();
    skipOpen.current = false;
  };
  // Treffer fuer den aktuellen Begriff: die Begriffe davor gehen mit.
  const pickResult = (p: Pick) => {
    const cur = terms[terms.length - 1];
    const prefix = term && cur ? terms.slice(0, -1) : terms;
    done(onApply(prefix, p, term && cur ? cur.op : null));
  };
  const applyAll = () => done(onApply(terms, null, null));

  // Tasten fuer Feld, Pfeil-Knopf und Reiter (sie liegen alle in diesem Kasten).
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const inInput = el === inputRef.current;
    if (e.key === 'Escape') { if (open) { e.preventDefault(); close(); } return; }
    if (browse) {
      const dir = KEY_DIR[e.key];
      if (dir && el.getAttribute('role') === 'tab' && (dir === 'left' || dir === 'right')) {
        e.preventDefault();
        const next = tabs[(tabs.indexOf(curTab) + (dir === 'left' ? tabs.length - 1 : 1)) % tabs.length];
        pickTab(next);
        document.getElementById(tabId(next))?.focus();
      } else if (dir) {
        e.preventDefault();
        if (!open) setOpen(true);
        else setAct(gridMove(sections.map(s => s.length), gridCols(), act ?? -1, dir));
      } else if (e.key === 'Enter' && inInput && open && act != null) {
        e.preventDefault();
        toggleCell(act);
      }
      return;
    }
    if (!inInput) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(Math.min(hiIdx + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hiIdx - 1, 0)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Ohne Pfeilwahl gilt die ganze Eingabe (mit Sternen/Stufe aus dem Text).
      if (phrase || hi == null) { if (terms.length) applyAll(); }
      else if (flat[hiIdx]) pickResult(flat[hiIdx]);
    }
  };

  const showDrop = open && (term.length > 0 || phrase);
  const rowCls = (i: number) => `flex items-center gap-2 px-2 py-1 rounded ${i === hiIdx ? 'bg-surface-overlay' : 'hover:bg-surface-overlay'}`;
  // Kachel-Zustand: gewaehlt = Akzent-Ring, „ohne" = roter Ring, Grenze = gedimmt; markiert = Umriss.
  const ringCls = (st: CellState) => (st === 'on' ? 'ring-2 ring-accent' : st === 'out' ? 'ring-2 ring-pos-loss' : '');
  const actCls = (i: number) => (i === act ? 'outline-2 outline-offset-2 outline-fg-muted' : '');
  const offCls = (st: CellState) => (st === 'blocked' ? 'opacity-40 cursor-not-allowed' : '');
  const cellProps = (i: number, c: Cell, st: CellState) => ({
    id: cellId(i), type: 'button' as const, role: 'option', tabIndex: -1, 'aria-label': c.name,
    'aria-selected': st === 'on' || st === 'out', 'aria-disabled': st === 'blocked' || undefined,
    // Fokus bleibt im Feld (Tastatur) bzw. die Handy-Tastatur bleibt zu.
    onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
    onMouseEnter: () => setAct(i),
    onClick: () => toggleCell(i),
  });

  return (
    <div ref={boxRef} onKeyDown={onKey} className={`relative w-full sm:w-auto sm:flex-1 sm:min-w-[18rem] sm:max-w-[34rem] ${className}`}>
      <div className={`flex items-center gap-2 rounded-md border bg-surface-base pl-2.5 pr-1 ${open ? 'border-accent-a50' : 'border-border-subtle'}`}>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 text-fg-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); setHi(null); setMissed([]); }}
          onFocus={() => { if (!skipOpen.current) setOpen(true); onFocus?.(); }}
          onClick={() => setOpen(true)}
          placeholder={t(shortPh ? 'tft.explorer.x.searchShort' : 'tft.explorer.x.searchAll')}
          aria-label={t('tft.explorer.x.searchAll')}
          role="combobox"
          aria-expanded={showDrop || showBrowse}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showBrowse && act != null && cells[act] ? cellId(act) : undefined}
          // Rahmen zeigt der Kasten (offen = Akzent); der globale Fokusring sitzt ausserhalb der Ebenen und schlaegt Klassen.
          style={{ outline: 'none' }}
          className="flex-1 min-w-0 bg-transparent py-2 text-sm text-fg-primary placeholder:text-fg-faint"
        />
        <button type="button" aria-label={t('tft.explorer.x.browse')} title={t('tft.explorer.x.browse')} aria-expanded={showBrowse}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { if (showBrowse) close(); else { setText(''); setOpen(true); onFocus?.(); } }}
          className="w-7 h-7 flex items-center justify-center shrink-0 rounded text-fg-muted hover:text-fg-primary">
          <Chevron open={showBrowse} />
        </button>
        <div className="flex shrink-0 rounded border border-border-subtle overflow-hidden" role="group">
          {(['and', 'or'] as const).map(m => (
            <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
              className={`px-2 py-1 text-[11px] font-medium ${mode === m ? 'bg-accent-a20 text-fg-bright' : 'text-fg-muted hover:text-fg-primary'}`}>
              {t(m === 'and' ? 'tft.explorer.x.and' : 'tft.explorer.x.or')}
            </button>
          ))}
        </div>
      </div>
      {missed.length > 0 && (
        <div className="mt-1 text-[11px] text-pos-loss">{t('tft.explorer.x.notFound')}: {missed.join(', ')}</div>
      )}

      {showBrowse && (
        // Ab lg immer 34rem, am linken Rand der Suche: die Suche schrumpft in
        // der vollen Filterzeile, die Units sollen trotzdem je Kostenstufe in
        // einer Zeile bleiben. Die Suche steht links-mittig (hinter Patch ·
        // Region · Rang) oder am Zeilenanfang, das Fenster passt nach rechts.
        <div className="absolute z-40 left-0 right-0 lg:right-auto lg:w-[34rem] top-full mt-1 rounded-lg border border-border-subtle bg-surface-raised p-2 shadow-xl">
          <div role="tablist" aria-label={t('tft.explorer.x.browse')} className="flex flex-wrap gap-1">
            {tabs.map(b => (
              <button key={b} id={tabId(b)} type="button" role="tab" aria-selected={curTab === b} aria-controls={listId}
                tabIndex={curTab === b ? 0 : -1} onMouseDown={e => e.preventDefault()} onClick={() => pickTab(b)}
                className={`px-2.5 py-1 rounded text-xs border ${curTab === b ? 'bg-accent-a20 border-accent-a50 text-fg-bright' : 'border-border-subtle text-fg-secondary hover:text-fg-primary'}`}>
                {t(tabLabel(b))}
              </button>
            ))}
          </div>
          <div aria-hidden="true" className="h-5 mt-1 px-1 text-xs leading-5 text-fg-secondary truncate">{act != null ? cells[act]?.name : ''}</div>
          <div id={listId} ref={gridRef} role="listbox" aria-multiselectable="true" aria-labelledby={tabId(curTab)}
            className="max-h-[min(60vh,26rem)] overflow-y-auto p-1 space-y-1.5">
            {cells.length === 0 && (
              <div data-grid className={TILE_GRID}>
                {Array.from({ length: SKELETON }, (_, i) => <span key={i} className="w-8 h-8 rounded bg-surface-overlay" />)}
              </div>
            )}
            {sections.map((sec, si) => {
              const base = sections.slice(0, si).reduce((a, s) => a + s.length, 0);
              if (curTab === 'traits') {
                return (
                  <div key={si} data-grid className={`grid grid-cols-2 sm:grid-cols-3 gap-1 ${si > 0 ? 'pt-1.5 border-t border-border-subtle' : ''}`}>
                    {sec.map((c, j) => {
                      const i = base + j;
                      const st = stateOf(c);
                      return (
                        <button key={c.pick.f.id} {...cellProps(i, c, st)}
                          className={`flex items-center gap-1.5 min-w-0 px-1.5 py-1 rounded border text-left text-sm ${
                            st === 'on' ? 'border-accent bg-accent-a15 text-fg-bright' : st === 'out' ? 'border-pos-loss text-fg-primary' : 'border-border-subtle text-fg-primary hover:bg-surface-overlay'
                          } ${actCls(i)} ${offCls(st)}`}>
                          <OptIcon src={c.img} alt={c.name} className="w-6 h-6" />
                          <span className="truncate">{c.name}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              }
              return (
                <div key={si} data-grid className={TILE_GRID}>
                  {sec.map((c, j) => {
                    const i = base + j;
                    const st = stateOf(c);
                    return (
                      <button key={c.pick.f.id} {...cellProps(i, c, st)} className={`w-8 h-8 rounded ${ringCls(st)} ${actCls(i)} ${offCls(st)}`}>
                        <OptIcon src={c.img} alt={c.name} className="w-8 h-8" border={c.border} />
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showDrop && (
        <div id={listId} role="listbox" className="absolute z-40 left-0 right-0 lg:right-auto lg:w-[34rem] top-full mt-1 rounded-lg border border-border-subtle bg-surface-raised p-2 shadow-xl max-h-[min(70vh,32rem)] overflow-y-auto space-y-2">
          {phrase && (
            <button type="button" onClick={applyAll}
              className="w-full flex flex-wrap items-center gap-1.5 px-2 py-1.5 rounded border border-accent-a40 bg-accent-a8 text-left text-xs hover:bg-accent-a15">
              {preview.map((p, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  {p.op && <span className="text-fg-muted">{t(p.op === 'and' ? 'tft.explorer.x.and' : 'tft.explorer.x.or')}</span>}
                  {p.pick ? (
                    <span className="inline-flex items-center gap-1 text-fg-primary">
                      <PickIcon p={p.pick} options={options} />
                      {pickName(p.pick, options)}
                      {p.pick.kind === 'units' && p.pick.f.s ? <span className="text-gold-earnings">{'★'.repeat(p.pick.f.s)}</span> : null}
                    </span>
                  ) : <span className="text-pos-loss line-through">{p.text}</span>}
                </span>
              ))}
              <span className="ml-auto text-[11px] text-fg-muted">{t('tft.explorer.x.apply')} ↵</span>
            </button>
          )}

          {res.units.length > 0 && (
            <Section label={t('tft.explorer.units')}>
              {res.units.map(u => {
                const i = idxOf('units', u.id);
                return (
                  <div key={u.id} className={rowCls(i)} onMouseEnter={() => setHi(i)}>
                    <button type="button" onClick={() => pickResult({ kind: 'units', f: { id: u.id } })} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <OptIcon src={u.img} alt={u.name} className="w-7 h-7" border={costColor(u.cost)} />
                      <span className="text-sm text-fg-primary truncate">{u.name}</span>
                    </button>
                    {[2, 3].map(s => (
                      <button key={s} type="button" className={quick} onClick={() => pickResult({ kind: 'units', f: unitWithStars(u.id, s) })}>
                        <span className="text-gold-earnings">{'★'.repeat(s)}</span>
                      </button>
                    ))}
                    <button type="button" className={quick} onClick={() => pickResult({ kind: 'units', f: { id: u.id, n: 3 } })}>
                      {t('tft.explorer.x.threeItems')}
                    </button>
                  </div>
                );
              })}
            </Section>
          )}

          {res.traits.length > 0 && (
            <Section label={t('tft.explorer.traits')}>
              {res.traits.map(x => {
                const i = idxOf('traits', x.id);
                return (
                  <div key={x.id} className={rowCls(i)} onMouseEnter={() => setHi(i)}>
                    <button type="button" onClick={() => pickResult({ kind: 'traits', f: { id: x.id } })} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                      <OptIcon src={x.img} alt={x.name} className="w-6 h-6" />
                      <span className="text-sm text-fg-primary truncate">{x.name}</span>
                    </button>
                    {x.mins.length > 1 && x.mins.map((m, li) => (
                      <button key={li} type="button" className={quick} onClick={() => pickResult({ kind: 'traits', f: { id: x.id, l: li + 1 } })}>{m}</button>
                    ))}
                  </div>
                );
              })}
            </Section>
          )}

          {itemGroups.map(g => (
            <Section key={g.b} label={t(g.label)}>
              {g.list.map(it => {
                const i = idxOf('items', it.id);
                return (
                  <button key={it.id} type="button" className={`${rowCls(i)} w-full text-left`} onMouseEnter={() => setHi(i)}
                    onClick={() => pickResult({ kind: 'items', f: { id: it.id } })}>
                    <OptIcon src={it.img} alt={it.name} className="w-6 h-6" />
                    <span className="text-sm text-fg-primary truncate">{it.name}</span>
                  </button>
                );
              })}
            </Section>
          ))}

          {!phrase && flat.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-fg-muted">{t('tft.explorer.x.notFound')}</div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2 pb-0.5 text-[10px] uppercase tracking-wide text-fg-faint">{label}</div>
      {children}
    </div>
  );
}

export function pickName(p: Pick, o: ExplorerOptions): string {
  if (p.kind === 'units') return o.unitById.get(p.f.id)?.name ?? p.f.id;
  if (p.kind === 'traits') {
    const tr = o.traitById.get(p.f.id);
    const lvl = p.f.l ? tr?.mins[p.f.l - 1] : null;
    return `${lvl ? `${lvl} ` : ''}${tr?.name ?? p.f.id}`;
  }
  return o.itemById.get(p.f.id)?.name ?? p.f.id;
}

function PickIcon({ p, options }: { p: Pick; options: ExplorerOptions }) {
  if (p.kind === 'units') {
    const u = options.unitById.get(p.f.id);
    return <OptIcon src={u?.img ?? null} alt={u?.name ?? p.f.id} className="w-5 h-5" border={costColor(u?.cost ?? 1)} />;
  }
  const x = p.kind === 'traits' ? options.traitById.get(p.f.id) : options.itemById.get(p.f.id);
  return <OptIcon src={x?.img ?? null} alt={x?.name ?? p.f.id} className="w-5 h-5" />;
}

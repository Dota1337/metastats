'use client';
// Suchzeile des Data Explorers (Plan 19.10.2026, Teil C1): ein Feld fuer Units,
// Items und Synergien mit Bild-Treffern. „und" / „oder" lassen sich tippen
// („Lux und Jinx oder Vex") oder ueber den Schalter waehlen. Logik in
// explorer-search.ts.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useI18n, type TranslationKey } from '../../../lib/i18n';
import { costColor } from '../../../lib/tft-ui';
import type { ItemBucket } from '../../../lib/tft-item-bucket';
import type { ExplorerOptions, ItemOption } from './explorer-options';
import {
  ITEM_ORDER, bestPick, currentTerm, isPhrase, searchOptions, splitPhrase, unitWithStars,
  type Op, type Pick, type PhraseTerm,
} from './explorer-search';

// Gleiche Reihenfolge wie ITEM_ORDER (bester Treffer = erster markierter).
export const ITEM_GROUPS: { b: ItemBucket; label: TranslationKey }[] = ITEM_ORDER.map(b => ({ b, label: `tft.item.bucket.${b}` as TranslationKey }));
export const itemGroupOf = (i: ItemOption): ItemBucket => (i.bucket === 'other' ? 'standard' : i.bucket);

export function OptIcon({ src, alt, className = 'w-6 h-6', border }: { src: string | null; alt: string; className?: string; border?: string }) {
  if (!src) return <span className={`${className} rounded bg-surface-overlay shrink-0`} />;
  return <img src={src} alt={alt} title={alt} loading="lazy" className={`${className} rounded object-cover shrink-0`} style={border ? { boxShadow: `inset 0 0 0 1.5px ${border}` } : undefined} />;
}

const quick = 'px-1.5 py-0.5 rounded border border-border-subtle text-[11px] text-fg-secondary hover:border-accent-a50 hover:text-fg-bright';

export default function ExplorerSearchBox({
  options, mode, setMode, onApply, focusKey, onFocus,
}: {
  options: ExplorerOptions;
  mode: Op;
  setMode: (m: Op) => void;
  /** prefix: Begriffe vor dem aktuellen; pick: gewaehlter Treffer fuer den aktuellen (null = alle Begriffe). */
  onApply: (prefix: PhraseTerm[], pick: Pick | null, pickOp: Op | null) => string[];
  /** Aendert sich der Wert, bekommt das Feld den Fokus (z. B. „+" in einem Kasten). */
  focusKey: number;
  onFocus?: () => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  // null = noch nicht mit Pfeilen gewaehlt: markiert ist der beste Treffer.
  const [hi, setHi] = useState<number | null>(null);
  const [missed, setMissed] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => { if (focusKey) inputRef.current?.focus(); }, [focusKey]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false); };
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

  const done = (miss: string[]) => {
    setMissed(miss);
    setText('');
    setHi(null);
    inputRef.current?.focus();
  };
  // Treffer fuer den aktuellen Begriff: die Begriffe davor gehen mit.
  const pickResult = (p: Pick) => {
    const cur = terms[terms.length - 1];
    const prefix = term && cur ? terms.slice(0, -1) : terms;
    done(onApply(prefix, p, term && cur ? cur.op : null));
  };
  const applyAll = () => done(onApply(terms, null, null));

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHi(Math.min(hiIdx + 1, flat.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(Math.max(hiIdx - 1, 0)); }
    else if (e.key === 'Escape') setOpen(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      // Ohne Pfeilwahl gilt die ganze Eingabe (mit Sternen/Stufe aus dem Text).
      if (phrase || hi == null) { if (terms.length) applyAll(); }
      else if (flat[hiIdx]) pickResult(flat[hiIdx]);
    }
  };

  const showDrop = open && (term.length > 0 || phrase);
  const rowCls = (i: number) => `flex items-center gap-2 px-2 py-1 rounded ${i === hiIdx ? 'bg-surface-overlay' : 'hover:bg-surface-overlay'}`;

  return (
    <div ref={boxRef} className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[18rem] sm:max-w-[34rem]">
      <div className={`flex items-center gap-2 rounded-md border bg-surface-base pl-2.5 pr-1 ${open ? 'border-accent-a50' : 'border-border-subtle'}`}>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="w-4 h-4 text-fg-muted shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="8.5" cy="8.5" r="5.5" /><path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          ref={inputRef}
          value={text}
          onChange={e => { setText(e.target.value); setOpen(true); setHi(null); setMissed([]); }}
          onFocus={() => { setOpen(true); onFocus?.(); }}
          onKeyDown={onKey}
          placeholder={t('tft.explorer.x.searchAll')}
          aria-label={t('tft.explorer.x.searchAll')}
          role="combobox"
          aria-expanded={showDrop}
          aria-controls={listId}
          aria-autocomplete="list"
          // Rahmen zeigt der Kasten (offen = Akzent); der globale Fokusring sitzt ausserhalb der Ebenen und schlaegt Klassen.
          style={{ outline: 'none' }}
          className="flex-1 min-w-0 bg-transparent py-2 text-sm text-fg-primary placeholder:text-fg-faint"
        />
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

      {showDrop && (
        <div id={listId} role="listbox" className="absolute z-40 left-0 right-0 top-full mt-1 rounded-lg border border-border-subtle bg-surface-raised p-2 shadow-xl max-h-[min(70vh,32rem)] overflow-y-auto space-y-2">
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

'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { findChampion, tftChampionTileUrl } from '../../lib/tft-cdragon';
import { costColor, HEX_CLIP } from '../../lib/tft-ui';
import { boardLayout } from '../../lib/tft-comp-board';
import { parseLevelling } from '../../lib/tft-comp-guides';
import { useI18n } from '../../lib/i18n';
import type { CompBoardResponse } from '../../api/tft/comps/board/route';

// Aufstellungsbrett unter einer Zeile der Comp-Liste, aufgebaut wie die
// Positions-Box bei MetaTFT: Reiter je Endstufe (Lv 7/8/9 mit Anteil der
// Spiele), 4×7-Sechseck-Brett mit Portraet, Name und Kostenfarbe, darunter
// der Levelplan. Anders als MetaTFT hat jede Stufe ihr eigenes Brett — die
// Units, die auf dieser Stufe am haeufigsten standen.
//
// Daten: /api/tft/comps/board (ein Abruf, ~3 KB). Zwischenspeicher je Comp und
// Filter fuer die ganze Seite; der Knopf laedt beim Zeigen/Fokussieren vor.

export interface CompBoardParams {
  slug: string;
  patch: string;
  bucket: string;
  days: number;
  region: string;
  carries: string[];
}

type BoardData = CompBoardResponse | null;

const MAX_CACHE = 60;
const MAX_PREFETCH = 2;
const cache = new Map<string, BoardData>();
const inflight = new Map<string, { promise: Promise<BoardData>; ctrl: AbortController; users: number }>();
let prefetching = 0;

function boardUrl(p: CompBoardParams): string {
  const qs = new URLSearchParams({
    slug: p.slug, patch: p.patch, bucket: p.bucket, days: String(p.days), region: p.region,
  });
  if (p.carries.length > 0) qs.set('carries', p.carries.join(','));
  return `/api/tft/comps/board?${qs.toString()}`;
}

function remember(url: string, data: BoardData) {
  cache.delete(url);
  cache.set(url, data);
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value as string);
}

// 404/400 = diese Comp hat kein Brett (zu wenig Spiele unter den Filtern) —
// das ist ein Ergebnis, kein Fehler. Alles andere darf erneut versucht werden.
function load(url: string): { promise: Promise<BoardData>; ctrl: AbortController; users: number } {
  const running = inflight.get(url);
  if (running) return running;
  const ctrl = new AbortController();
  const promise = fetch(url, { signal: ctrl.signal })
    .then(async res => {
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok) throw new Error(`board ${res.status}`);
      return (await res.json()) as CompBoardResponse;
    })
    .then(data => { remember(url, data); return data; })
    .finally(() => { if (inflight.get(url)?.promise === promise) inflight.delete(url); });
  const entry = { promise, ctrl, users: 0 };
  inflight.set(url, entry);
  return entry;
}

/** Vorladen (Zeigen/Fokus auf dem Knopf). Hoechstens zwei gleichzeitig, nie doppelt. */
export function prefetchCompBoard(params: CompBoardParams) {
  const url = boardUrl(params);
  if (cache.has(url) || inflight.has(url) || prefetching >= MAX_PREFETCH) return;
  prefetching++;
  load(url).promise.catch(() => {}).finally(() => { prefetching--; });
}

type State =
  | { url: string; status: 'loading' }
  | { url: string; status: 'error' }
  | { url: string; status: 'ready'; data: BoardData };

function useBoard(params: CompBoardParams, attempt: number): State {
  const url = boardUrl(params);
  const [state, setState] = useState<State>(() =>
    cache.has(url) ? { url, status: 'ready', data: cache.get(url)! } : { url, status: 'loading' },
  );

  useEffect(() => {
    if (cache.has(url)) {
      setState({ url, status: 'ready', data: cache.get(url)! });
      return;
    }
    setState({ url, status: 'loading' });
    let active = true;
    const entry = load(url);
    entry.users++;
    entry.promise.then(
      data => { if (active) setState({ url, status: 'ready', data }); },
      () => { if (active) setState({ url, status: 'error' }); },
    );
    return () => {
      active = false;
      entry.users--;
      // Filter gewechselt oder Brett zugeklappt: Abruf abbrechen, wenn ihn
      // niemand mehr braucht (ein laufendes Vorladen zaehlt nicht).
      if (entry.users <= 0 && inflight.get(url) === entry) {
        entry.ctrl.abort();
        inflight.delete(url);
      }
    };
  }, [url, attempt]);

  return state.url === url ? state : { url, status: 'loading' };
}

// Brettmasse in Einheiten der Feldbreite s: 7 Felder + halbes Feld Versatz,
// Sechseck 0,92 s breit (Rest = Fuge), Hoehe = Breite / cos 30°, Reihenabstand
// 0,866 s — so ist die Fuge zwischen den Reihen so breit wie die daneben.
const COLS = 7.5;
const HEX_W = 0.92;
const HEX_H = HEX_W / 0.8660254;
const PITCH = 0.8660254;
const BOARD_H = HEX_H + 3 * PITCH;
const ROWS = boardLayout();

function prettyChar(s: string) { return s.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, ''); }

function HexBoard({
  cells, assets, pulse = false,
}: {
  cells: Map<number, string>;
  assets: TftAssetsBundle | null;
  pulse?: boolean;
}) {
  return (
    <div
      className={`relative w-full max-w-[380px] mx-auto ${pulse ? 'animate-pulse' : ''}`}
      style={{ aspectRatio: `${COLS} / ${BOARD_H}` }}
    >
      {ROWS.map((row, r) => row.cells.map((cell, col) => {
        const unit = cells.get(cell);
        const champ = unit ? findChampion(assets, unit) : null;
        const name = champ?.name || (unit ? prettyChar(unit) : '');
        const url = unit ? tftChampionTileUrl(assets, champ) : null;
        const style = {
          left: `${((col + (row.shift ? 0.5 : 0) + (1 - HEX_W) / 2) / COLS) * 100}%`,
          top: `${((r * PITCH) / BOARD_H) * 100}%`,
          width: `${(HEX_W / COLS) * 100}%`,
          height: `${(HEX_H / BOARD_H) * 100}%`,
          clipPath: HEX_CLIP,
        };
        if (!unit) {
          return <div key={cell} className="absolute bg-surface-raised" style={style} aria-hidden="true" />;
        }
        return (
          <div
            key={cell}
            className="absolute"
            style={{ ...style, backgroundColor: costColor(champ?.cost ?? 1) }}
            title={name}
          >
            <div className="absolute inset-[2px] sm:inset-[3px] bg-surface-overlay overflow-hidden" style={{ clipPath: HEX_CLIP }}>
              {url && <img src={url} alt={name} className="w-full h-full object-cover" loading="lazy" />}
              <span
                className={`absolute inset-x-0 bottom-[17%] px-0.5 text-center font-semibold leading-none text-white truncate ${
                  name.length > 8 ? 'text-[7px] sm:text-[8px]' : 'text-[8px] sm:text-[10px]'
                }`}
                style={{ textShadow: '0 1px 2px #000, 0 0 3px #000' }}
                aria-hidden="true"
              >
                {name}
              </span>
            </div>
          </div>
        );
      }))}
    </div>
  );
}

export default function CompBoardPanel({
  id, params, assets,
}: {
  id: string;
  params: CompBoardParams;
  assets: TftAssetsBundle | null;
}) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const state = useBoard(params, attempt);
  const [picked, setPicked] = useState<number | null>(null);
  const tabRefs = useRef(new Map<number, HTMLButtonElement>());

  const data = state.status === 'ready' ? state.data : null;
  const levels = data?.levels ?? [];
  const level = picked != null && levels.some(l => l.level === picked) ? picked : data?.defaultLevel ?? null;
  const cellsList = data
    ? (level != null ? data.boardsByPlayerLevel[String(level)] : null) ?? data.board
    : [];
  const cells = new Map(cellsList.map(c => [c.cell, c.unit]));

  const plan = parseLevelling(data?.levelling);
  const planLabel = plan
    ? plan.kind === 'standard'
      ? (t('tft.comp.levelling.standard') as string)
      : (t(`tft.comp.levelling.${plan.kind}`) as string).replace('{level}', String(plan.level))
    : null;
  const stepLabel = (n: number) => (t('tft.comp.levelling.step') as string).replace('{level}', String(n));

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % levels.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + levels.length) % levels.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = levels.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const lv = levels[next].level;
    setPicked(lv);
    tabRefs.current.get(lv)?.focus();
  };

  const empty = state.status === 'ready' && cells.size === 0;

  return (
    <div id={id} className="mt-1.5 mb-1 rounded-md border border-border-subtle bg-surface-base px-3 py-3 sm:px-4">
      <h3 className="text-center text-fg-primary text-sm font-medium mb-2">{t('tft.comp.positioning')}</h3>

      {state.status === 'error' ? (
        <div className="flex justify-center py-6">
          <button
            type="button"
            onClick={() => setAttempt(a => a + 1)}
            className="px-3 py-1.5 rounded border border-border-subtle bg-surface-raised text-xs text-fg-primary hover:border-accent-a60"
          >
            {t('tft.explorer.x.retry')}
          </button>
        </div>
      ) : empty ? (
        <div className="text-center text-fg-muted py-6">—</div>
      ) : (
        <>
          {levels.length > 0 && (
            <div role="tablist" aria-label={t('tft.comp.positioning')} className="flex justify-center gap-1 mb-3">
              {levels.map((l, idx) => {
                const active = l.level === level;
                return (
                  <button
                    key={l.level}
                    ref={el => { if (el) tabRefs.current.set(l.level, el); else tabRefs.current.delete(l.level); }}
                    id={`${id}-tab-${l.level}`}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    aria-controls={`${id}-board`}
                    tabIndex={active ? 0 : -1}
                    onClick={() => setPicked(l.level)}
                    onKeyDown={e => onTabKey(e, idx)}
                    className="flex flex-col items-center min-w-[4.25rem] px-2.5 pt-1 pb-1.5 border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-a60 rounded-t"
                    style={{ borderColor: active ? '#e0c75a' : 'transparent' }}
                  >
                    <span className={`text-sm font-semibold ${active ? '' : 'text-fg-primary'}`} style={active ? { color: '#e0c75a' } : undefined}>
                      {stepLabel(l.level)}
                    </span>
                    <span className="text-[11px] text-fg-muted tabular-nums">{(l.share * 100).toFixed(1)}%</span>
                  </button>
                );
              })}
            </div>
          )}

          <div
            id={`${id}-board`}
            {...(levels.length > 0 ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${level}` } : {})}
          >
            <HexBoard cells={cells} assets={assets} pulse={state.status === 'loading'} />
          </div>

          {data && (planLabel || data.levelTiming.length > 0) && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {planLabel && (
                <div className="text-sm text-fg-secondary">
                  {t('tft.comp.levelling')}: <span className="text-white font-semibold">{planLabel}</span>
                </div>
              )}
              {data.levelTiming.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {data.levelTiming.map(step => (
                    <div
                      key={step.level}
                      className="flex flex-col items-center bg-surface-level-chip border border-border-subtle rounded px-2 py-1 min-w-[3.25rem]"
                    >
                      <div className="text-white text-xs font-semibold">{stepLabel(step.level)}</div>
                      <div className="text-fg-muted text-[11px] tabular-nums">{step.stage}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

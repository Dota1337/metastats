'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { findChampion, tftChampionTileUrl } from '../../lib/tft-cdragon';
import { costColor, HEX_CLIP } from '../../lib/tft-ui';
import { boardLayout, defaultLevel } from '../../lib/tft-comp-board';
import { parseLevelling } from '../../lib/tft-comp-guides';
import { useI18n } from '../../lib/i18n';
import type { CompBoardResponse } from '../../api/tft/comps/board/route';
import type { CompanionEarlyBoard } from '../../lib/companion-types';

// Aufstellungsbrett unter einer Zeile der Comp-Liste und oben auf der
// Comp-Detailseite, aufgebaut wie die Positions-Box bei MetaTFT: Reiter je
// Endstufe (Lv 7/8/9 mit Anteil der Spiele), 4×7-Sechseck-Brett mit Portraet,
// Name und Kostenfarbe, darunter der Levelplan. Anders als MetaTFT hat jede
// Stufe ihr eigenes Brett — die Units, die auf dieser Stufe am haeufigsten
// standen.
//
// Daten: /api/tft/comps/board (ein Abruf, ~3 KB). Zwischenspeicher je Comp und
// Filter fuer die ganze Seite; der Knopf laedt beim Zeigen/Fokussieren vor.
// Die Detailseite setzt `framed` (Rahmen wie ihre anderen Boxen), blendet den
// Levelplan aus (ihre Leveln-Box zeigt ihn), zeigt ohne Brett gar nichts und
// fragt mit `early` auch die fruehen Boards der Anleitung ab (Reiter „Aufbau“).

export interface CompBoardParams {
  slug: string;
  patch: string;
  bucket: string;
  days: number;
  region: string;
  carries: string[];
  /** MetaTFT-Comp der Comp-Zeile, null = keine; undefined = noch unbekannt (Route ordnet selbst zu). */
  guide?: string | null;
  /** Auch die fruehen Boards der Anleitung (Stufe 4-7) als Reiter — nur die Detailseite. */
  early?: boolean;
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
  if (p.guide !== undefined) qs.set('guide', p.guide ?? 'none');
  if (p.early) qs.set('early', '1');
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

// key = Versuch + Adresse: ein neuer Filter oder "Erneut versuchen" gilt als
// neue Anfrage, ein alter Fehler oder ein altes Brett passt dann nicht mehr.
type State =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error' }
  | { key: string; status: 'ready'; data: BoardData };

// Laden und Zwischenspeicher-Treffer werden beim Zeichnen abgeleitet; der
// Effekt setzt den Zustand nur, wenn eine Antwort da ist (nie synchron).
function useBoard(params: CompBoardParams, attempt: number): State {
  const url = boardUrl(params);
  const key = `${attempt}|${url}`;
  const [state, setState] = useState<State | null>(null);

  useEffect(() => {
    let active = true;
    if (cache.has(url)) {
      // Das Zeichnen liefert das schon; nur falls das Vorladen zwischen
      // Zeichnen und Effekt fertig wurde, einmal nachziehen.
      const data = cache.get(url)!;
      queueMicrotask(() => { if (active) setState({ key, status: 'ready', data }); });
      return () => { active = false; };
    }
    const entry = load(url);
    entry.users++;
    entry.promise.then(
      data => { if (active) setState({ key, status: 'ready', data }); },
      () => { if (active) setState({ key, status: 'error' }); },
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
  }, [url, key]);

  if (state?.key === key) return state;
  if (cache.has(url)) return { key, status: 'ready', data: cache.get(url)! };
  return { key, status: 'loading' };
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

// Aufbau-Reiter: Stufen mit fruehem Board der Anleitung; darunter die
// meistgespielten Opener der Stufe (das erste steht auf dem Brett).
const EARLY_TAB_LEVELS = ['4', '5', '6', '7'];
const EARLY_ROWS = 3;

interface BoardTab {
  /** "e4".."e7" = Aufbau, "7".."9" = Endbrett, "all" = Gesamtbrett. */
  key: string;
  level: number | null;
  sub: string | null;
}

function byGames(list: CompanionEarlyBoard[] | undefined): CompanionEarlyBoard[] {
  return [...(list ?? [])].sort((a, b) => b.games - a.games);
}

function EarlyUnitTile({ apiName, assets }: { apiName: string; assets: TftAssetsBundle | null }) {
  const champ = findChampion(assets, apiName);
  const url = tftChampionTileUrl(assets, champ);
  const name = champ?.name || prettyChar(apiName);
  const cost = champ?.cost ?? 1;
  // Kosten 0 = keine Shop-Einheit (z. B. Pflanzen) → kein Kostenrahmen.
  return (
    <a
      href={`/tft/units/${encodeURIComponent(apiName)}`}
      className={`block w-8 h-8 rounded border-2 overflow-hidden bg-surface-overlay hover:scale-105 transition${cost === 0 ? ' border-border-subtle' : ''}`}
      style={cost === 0 ? undefined : { borderColor: costColor(cost) }}
      title={name}
    >
      {url && <img src={url} alt={name} className="w-full h-full object-cover" loading="lazy" />}
    </a>
  );
}

export default function CompBoardPanel({
  id, params, assets, framed = false, showPlan = true, hideWhenEmpty = false,
}: {
  id: string;
  params: CompBoardParams;
  assets: TftAssetsBundle | null;
  /** Rahmen und Ueberschrift wie die Boxen der Comp-Detailseite. */
  framed?: boolean;
  showPlan?: boolean;
  /** Ohne Brett nichts zeigen statt „—". */
  hideWhenEmpty?: boolean;
}) {
  const { t } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const state = useBoard(params, attempt);
  const [picked, setPicked] = useState<string | null>(null);
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const data = state.status === 'ready' ? state.data : null;
  // Aufbau (nur Detailseite): das meistgespielte fruehe Board der Anleitung je
  // Stufe 4-7. Hat eine Stufe eins, ersetzt es das Endbrett derselben Stufe —
  // bei Reroll-Comps ist Stufe 7 Aufbau, nicht Ende (User 2026-10-10).
  const earlyCells = data?.earlyBoardsByLevel ?? {};
  const earlyTabs: BoardTab[] = EARLY_TAB_LEVELS
    .filter(l => (earlyCells[l]?.length ?? 0) > 0)
    .map(l => {
      const top = byGames(data?.early?.[l])[0];
      return { key: `e${l}`, level: Number(l), sub: top?.avg != null ? `Ø ${top.avg.toFixed(2)}` : null };
    });
  const endLevels = (data?.levels ?? []).filter(l => !earlyTabs.some(e => e.level === l.level));
  const endTabs: BoardTab[] = endLevels.map(l => ({ key: String(l.level), level: l.level, sub: `${(l.share * 100).toFixed(1)}%` }));
  // Ohne Endstufe mit eigenem Brett bleibt das Gesamtbrett ueber einen eigenen Reiter erreichbar.
  if (earlyTabs.length > 0 && endTabs.length === 0 && (data?.board.length ?? 0) > 0) {
    endTabs.push({ key: 'all', level: null, sub: null });
  }
  const tabs = [...earlyTabs, ...endTabs];
  const endDefault = earlyTabs.length > 0 ? defaultLevel(endLevels) : data?.defaultLevel ?? null;
  const defaultKey = endDefault != null ? String(endDefault)
    : earlyTabs.length > 0 ? (endTabs[0] ?? earlyTabs[earlyTabs.length - 1]).key
    : null;
  const tab = tabs.find(x => x.key === picked) ?? tabs.find(x => x.key === defaultKey) ?? null;
  const isEarly = tab != null && tab.key.startsWith('e');
  const cellsList = data
    ? (tab == null ? null
      : isEarly ? earlyCells[String(tab.level)]
      : tab.key === 'all' ? data.board
      : data.boardsByPlayerLevel[tab.key]) ?? data.board
    : [];
  const cells = new Map(cellsList.map(c => [c.cell, c.unit]));
  const earlyOptions = isEarly ? byGames(data?.early?.[String(tab.level)]).slice(0, EARLY_ROWS) : [];
  const compactTabs = tabs.length > 4;

  const plan = parseLevelling(data?.levelling);
  const planLabel = plan
    ? plan.kind === 'standard'
      ? (t('tft.comp.levelling.standard') as string)
      : (t(`tft.comp.levelling.${plan.kind}`) as string).replace('{level}', String(plan.level))
    : null;
  const stepLabel = (n: number) => (t('tft.comp.levelling.step') as string).replace('{level}', String(n));

  // Pfeiltasten laufen ueber alle Reiter, auch ueber die Gruppengrenze.
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const key = tabs[next].key;
    setPicked(key);
    tabRefs.current.get(key)?.focus();
  };

  const tabButton = (x: BoardTab, idx: number) => {
    const active = x.key === tab?.key;
    return (
      <button
        key={x.key}
        ref={el => { if (el) tabRefs.current.set(x.key, el); else tabRefs.current.delete(x.key); }}
        id={`${id}-tab-${x.key}`}
        type="button"
        role="tab"
        aria-selected={active}
        aria-controls={`${id}-board`}
        tabIndex={active ? 0 : -1}
        onClick={() => setPicked(x.key)}
        onKeyDown={e => onTabKey(e, idx)}
        className={`flex flex-col items-center ${compactTabs ? 'min-w-[3.25rem] px-1.5' : 'min-w-[4.25rem] px-2.5'} pt-1 pb-1.5 border-b-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-a60 rounded-t`}
        style={{ borderColor: active ? '#e0c75a' : 'transparent' }}
      >
        <span className={`text-sm font-semibold whitespace-nowrap ${active ? '' : 'text-fg-primary'}`} style={active ? { color: '#e0c75a' } : undefined}>
          {x.level != null ? stepLabel(x.level) : t('tft.comp.positioning.finalBoard')}
        </span>
        <span className="text-[11px] text-fg-muted tabular-nums whitespace-nowrap">{x.sub ?? ' '}</span>
      </button>
    );
  };
  const groupLabel = (text: string) => (
    <div className="text-fg-muted text-[10px] uppercase tracking-widest leading-none mb-1" aria-hidden="true">{text}</div>
  );

  const empty = state.status === 'ready' && cells.size === 0;
  if (empty && hideWhenEmpty) return null;

  return (
    <div
      id={id}
      className={framed
        ? 'mt-5 bg-surface-base border border-border-subtle rounded p-4'
        : 'mt-1.5 mb-1 rounded-md border border-border-subtle bg-surface-base px-3 py-3 sm:px-4'}
    >
      {framed
        ? <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.positioning')}</h2>
        : <h3 className="text-center text-fg-primary text-sm font-medium mb-2">{t('tft.comp.positioning')}</h3>}

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
          {earlyTabs.length > 0 ? (
            // Zwei Gruppen: Aufbau (Anleitung, Stufe 4-7) und Endbrett (unsere
            // Spiele). Passt die Reihe nicht, rutscht die zweite Gruppe als
            // Ganzes in die naechste Zeile.
            <div className="flex flex-wrap justify-center items-end gap-x-5 gap-y-2 mb-3">
              <div id="cj-early" className="scroll-mt-16 flex flex-col items-center">
                {groupLabel(t('tft.comp.positioning.buildUp'))}
                <div role="tablist" aria-label={t('tft.comp.positioning.buildUp')} className="flex gap-1">
                  {earlyTabs.map((x, i) => tabButton(x, i))}
                </div>
              </div>
              {endTabs.length > 0 && (
                <div className="flex flex-col items-center">
                  {endTabs[0].key !== 'all' && groupLabel(t('tft.comp.positioning.finalBoard'))}
                  <div role="tablist" aria-label={t('tft.comp.positioning.finalBoard')} className="flex gap-1">
                    {endTabs.map((x, i) => tabButton(x, earlyTabs.length + i))}
                  </div>
                </div>
              )}
            </div>
          ) : tabs.length > 0 ? (
            <div role="tablist" aria-label={t('tft.comp.positioning')} className="flex justify-center gap-1 mb-3">
              {tabs.map((x, i) => tabButton(x, i))}
            </div>
          ) : params.early && state.status === 'loading' ? (
            // Platzhalter in Hoehe der Reiter, damit das Brett beim Laden nicht springt.
            <div className="h-[3.75rem] mb-3" aria-hidden="true" />
          ) : null}

          <div
            id={`${id}-board`}
            {...(tab ? { role: 'tabpanel', 'aria-labelledby': `${id}-tab-${tab.key}` } : {})}
          >
            <HexBoard cells={cells} assets={assets} pulse={state.status === 'loading'} />
          </div>

          {earlyOptions.length > 0 && (
            <div className="mt-3 flex flex-col items-center gap-2">
              {earlyOptions.map((o, i) => (
                <div key={i} className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
                  <div className="flex gap-1">
                    {o.units.map((u, j) => <EarlyUnitTile key={`${u}-${j}`} apiName={u} assets={assets} />)}
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-fg-muted tabular-nums whitespace-nowrap">
                    {o.avg != null && (
                      <span>{t('tft.comp.avgPlacement')} <span className="text-white font-semibold">{o.avg.toFixed(2)}</span></span>
                    )}
                    <span>{o.games.toLocaleString()} {t('tft.comp.games')}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showPlan && data && (planLabel || data.levelTiming.length > 0) && (
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

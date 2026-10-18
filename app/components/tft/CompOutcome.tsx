'use client';
// Neue Bloecke der Comp-Detailseite aus get_tft_comp_outcome (Migration 0078):
// Platzverteilung, Items je Unit mit Stufe, Unit-Wirkung, Endlevel. Die
// 3er-Kombis sind seit 2026-10-10 weg (User: die Aufstellung oben zeigt die
// Items schon) — das API-Feld `sets` bleibt. Rechnung in app/lib/tft-comp-outcome.ts — hier nur Anzeige.
// Wirkung = Ø Platz mit − Ø Platz ohne; negativ ist gut.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { tftChampionTileUrl, findChampion, type TftAssetsBundle } from '../../lib/tft-cdragon';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { costColor } from '../../lib/tft-ui';
import TftItemIcon from './TftItemIcon';
import { compEmblemsFromUnits } from '../../lib/tft-comp-outcome';
import type {
  CompEmblem, CompEmblems, CompOutcome, Effect, ItemGrade, ItemGroup, ItemOutcome, UnitOutcome,
} from '../../lib/tft-comp-outcome';

type T = (k: TranslationKey) => string;

const GOOD = '#3ecf8e';
const BAD = '#e44040';
const GOLD = '#e0c75a';
const WARN = '#e0a040';

// Embleme stehen nicht je Unit, sondern einmal fuer die ganze Comp direkt
// unter den Artefakten (User 2026-10-10) — sonst dasselbe Emblem doppelt mit
// anderer Zahl.
const GROUP_ORDER: ItemGroup[] = ['standard', 'artifact', 'radiant', 'tactician'];
const MAX_ITEMS: Record<ItemGroup, number> = { standard: 12, artifact: 6, radiant: 6, emblem: 6, tactician: 3 };
// Zugeklappt (User 2026-10-10, Detailseite kuerzer): erste Zeilen je Gruppe,
// der Rest ueber „weitere anzeigen" bis MAX_ITEMS.
const SHORT_ITEMS: Record<ItemGroup, number> = { standard: 6, artifact: 3, radiant: 3, emblem: 3, tactician: 3 };
// Unit-Wirkung zugeklappt: nur Units, die in mindestens so vielen Spielen stehen.
const UNIT_EFFECT_MIN_PRESENCE = 0.10;
// Unit-Wirkung: Units unter so vielen Spielen blass, auch aufgeklappt (User
// 2026-10-18; gleiche Grenze wie Endlevel und Carry-Sterne auf dieser Seite).
const UNIT_EFFECT_SOLID_GAMES = 30;
const MAX_UNIT_TABS = 8;
// Bis zur Unterkante auffuellen (User 2026-10-18): ab lg zeigen „Items je
// Unit“ und „Unit-Wirkung“ so viele weitere Zeilen, wie ganz in die Box
// passen; der Knopf nur fuer den Rest. false = Ablauf wie vorher.
const FILL_TO_BOTTOM = true;
const FILL_LG_QUERY = '(min-width: 64rem)';
const FILL_TOLERANCE_PX = 0.5;

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;

interface Fit { minH: number; extra: number }

/** Was die Messung ueber Durchlaeufe behaelt: Knopfzeile, seitliche
    Scrollleiste (Hoehe und ab wie vielen Zusatzzeilen sie erscheint — je
    Tabelleninhalt und Breite), Notbremse. */
interface FillMemo { toggleH: number; key: string; sbAt: number; sbH: number; t: number; n: number; stuck: boolean }

const sameFit = (a: Fit | null, b: Fit | null) =>
  a === b || (!!a && !!b && a.extra === b.extra && Math.abs(a.minH - b.minH) <= FILL_TOLERANCE_PX);

function nextFit(area: HTMLElement, wrap: HTMLElement, fit: Fit | null, hiddenTotal: number, dataKey: string, m: FillMemo): Fit | null {
  const k = fit?.extra ?? 0;
  let extraH = 0;
  wrap.querySelectorAll<HTMLElement>('[data-fill-extra]').forEach(r => { extraH += r.getBoundingClientRect().height; });
  const rowH = wrap.querySelector<HTMLElement>('[data-fill-row]')?.getBoundingClientRect().height ?? 0;
  // Knopfzeile im Fluss-Modus messen: dort ist die Flaeche genau Tabelle plus
  // Knopfzeile — und die Zeile ist hoeher als der Knopf (Schrift-Unterlaenge).
  if (!fit && area.querySelector('[data-fill-toggle]')) m.toggleH = area.offsetHeight - wrap.offsetHeight;
  // Seitliche Scrollleiste: eine weitere Unit mit langem Namen macht die
  // Tabelle breiter als die Box, dann kostet die Leiste ~15 px. Ohne dieses
  // Gedaechtnis pendelt die Zahl (mit Leiste passt die Zeile nicht, ohne
  // schon) — gemessen elderwood-draven Familie, 1700 px.
  const sbNow = wrap.offsetHeight - wrap.clientHeight;
  const key = `${dataKey}|${Math.round(wrap.clientWidth)}`;
  if (m.key !== key) { m.key = key; m.sbAt = Infinity; }
  if (sbNow > 0) { m.sbH = Math.max(m.sbH, sbNow); m.sbAt = Math.min(m.sbAt, k); }
  const contentH = wrap.clientHeight - extraH;
  if (rowH <= 0 || contentH <= 0 || m.toggleH <= 0) return null;
  const height = (n: number) => contentH + n * rowH + (n >= m.sbAt ? m.sbH : 0) + (n < hiddenTotal ? m.toggleH : 0);
  const minH = height(0);
  // Erst die (neue) Mindesthoehe setzen — die Flaeche hat ihre richtige Hoehe
  // erst im naechsten Durchlauf.
  if (!fit || Math.abs(fit.minH - minH) > FILL_TOLERANCE_PX) return { minH, extra: 0 };
  const room = area.clientHeight + FILL_TOLERANCE_PX;
  let n = hiddenTotal;
  while (n > 0 && height(n) > room) n--;
  return { minH, extra: n };
}

/** Fuellt eine Tabellen-Box bis zur Unterkante, die der Nachbar im Raster
    vorgibt. Drei Regeln, sonst haelt die Box sich mit den eigenen
    Zusatzzeilen hoch oder pendelt:
    (a) Grundhoehe = Tabelleninhalt minus der gerade gezeigten Zusatzzeilen
        (data-fill-extra), nie mit ihnen.
    (b) Die Knopfzeile steckt immer in der Mindesthoehe, auch wenn der Knopf
        wegfaellt.
    (c) Die Zahl der Zusatzzeilen haengt nur an Flaechenhoehe, Grundhoehe,
        Zeilenhoehe (data-fill-row) und der beobachteten Scrollleiste (wird
        je Inhalt und Breite nur strenger, nie lockerer), mit 0,5 px
        Toleranz; State nur bei echter Aenderung, im ResizeObserver kein
        flushSync.
    Notbremse: mehr als 30 Aenderungen in einer Sekunde → Fluss-Modus bis zum
    naechsten Laden. Im Fuell-Modus hat die Flaeche contain:size: ihre Zeilen
    zaehlen nicht zur Eigenhoehe der Box, nur die Mindesthoehe. Unter lg,
    aufgeklappt, unsichtbar (doppelte Unit-Wirkung ab 1600 px) und im
    Server-HTML gilt der Fluss-Modus = Ablauf wie vorher. Der Raster-Kommentar
    in CompDetailClient.tsx verweist hierher. */
function useFillToBottom(mounted: boolean, active: boolean, hiddenTotal: number, dataKey: string) {
  const areaRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const memo = useRef<FillMemo>({ toggleH: 0, key: '', sbAt: Infinity, sbH: 0, t: 0, n: 0, stuck: false });
  const [lg, setLg] = useState(false);
  const [fit, setFit] = useState<Fit | null>(null);
  const on = FILL_TO_BOTTOM && mounted && active && lg && hiddenTotal > 0;
  const measure = useRef<() => void>(() => {});
  // Nach jedem Render vor dem Zeichnen (Reiter, Daten, Auf-/Zuklappen); der
  // ResizeObserver ruft dieselbe, jeweils neueste Messung.
  useLayoutEffect(() => {
    measure.current = () => {
      const m = memo.current;
      const area = areaRef.current;
      const wrap = wrapRef.current;
      const next = on && !m.stuck && area && wrap && area.offsetHeight > 0
        ? nextFit(area, wrap, fit, hiddenTotal, dataKey, m)
        : null;
      if (sameFit(next, fit)) return;
      const now = performance.now();
      if (now - m.t > 1000) { m.t = now; m.n = 0; }
      if (++m.n > 30) { m.stuck = true; setFit(null); return; }
      setFit(next);
    };
    measure.current();
  });
  // Fensterbreite, Hoehe des Nachbarn, nachgeladene Teile der Box.
  useLayoutEffect(() => {
    if (!mounted) return;
    const mq = window.matchMedia(FILL_LG_QUERY);
    const onMq = () => setLg(mq.matches);
    onMq();
    mq.addEventListener('change', onMq);
    const ro = new ResizeObserver(() => measure.current());
    if (areaRef.current) ro.observe(areaRef.current);
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => { mq.removeEventListener('change', onMq); ro.disconnect(); };
  }, [mounted]);
  return {
    areaRef,
    wrapRef,
    areaClass: fit ? 'flex-1 [contain:size] overflow-hidden' : undefined,
    areaStyle: fit ? { minHeight: fit.minH } : undefined,
    extraRows: fit ? Math.min(fit.extra, hiddenTotal) : 0,
  };
}

/** „+ n weitere anzeigen" / „Weniger anzeigen" unter einer gekuerzten Liste. */
function MoreToggle({ hidden, open, onToggle, t }: { hidden: number; open: boolean; onToggle: () => void; t: T }) {
  if (!open && hidden <= 0) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      data-fill-toggle=""
      className="mt-2 text-xs text-fg-muted hover:text-white transition-colors"
    >
      {open ? t('tft.player.showLess') : t('tft.player.showMore').replace('{n}', String(hidden))}
    </button>
  );
}

function unitName(assets: TftAssetsBundle | null, cid: string) {
  return findChampion(assets, cid)?.name || cid.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/, '');
}

// 10 px wie alle Abzeichen der Detailseite (User 2026-10-18: kleine Schrift groesser).
function LowData({ t }: { t: T }) {
  return (
    <span
      className="text-[10px] uppercase tracking-wider px-1 py-[1px] rounded whitespace-nowrap"
      style={{ color: WARN, backgroundColor: 'rgba(224,160,64,0.12)', border: '1px solid rgba(224,160,64,0.35)' }}
    >
      {t('tft.comp.outcome.lowData')}
    </span>
  );
}

function EffectCell({ effect }: { effect: Effect | null }) {
  if (!effect) return <span className="text-fg-muted">—</span>;
  const sure = effect.delta + effect.ci < 0 ? GOOD : effect.delta - effect.ci > 0 ? BAD : null;
  const sign = effect.delta > 0 ? '+' : effect.delta < 0 ? '−' : '±';
  return (
    <span className="whitespace-nowrap">
      <span className="font-medium" style={{ color: sure ?? 'var(--fg-primary, #fff)' }}>
        {sign}{Math.abs(effect.delta).toFixed(2)}
      </span>
      <span className="hidden sm:inline text-fg-muted text-[11px]"> ±{effect.ci.toFixed(2)}</span>
    </span>
  );
}

function GradeChip({ grade, t }: { grade: ItemGrade; t: T }) {
  if (!grade) return <span className="text-fg-muted">—</span>;
  const color = grade === 'core' ? GOLD : grade === 'strong' ? GOOD : grade === 'weak' ? BAD : '#9aa6b2';
  const rgb = grade === 'core' ? '224,199,90' : grade === 'strong' ? '62,207,142' : grade === 'weak' ? '228,64,64' : '154,166,178';
  return (
    <span
      className="text-[10px] font-medium px-1.5 py-[1px] rounded whitespace-nowrap"
      style={{ color, backgroundColor: `rgba(${rgb},0.12)`, border: `1px solid rgba(${rgb},0.35)` }}
    >
      {t(`tft.comp.outcome.grade.${grade}` as TranslationKey)}
    </span>
  );
}

function UnitTile({ cid, assets, size = 'w-10 h-10' }: { cid: string; assets: TftAssetsBundle | null; size?: string }) {
  const ch = findChampion(assets, cid);
  const url = tftChampionTileUrl(assets, ch);
  return (
    <span
      className={`${size} rounded-md border-2 overflow-hidden block flex-shrink-0 bg-surface-overlay`}
      style={{ borderColor: costColor(ch?.cost ?? 1) }}
      title={ch?.name || cid}
    >
      {url && <img src={url} alt={ch?.name || ''} className="w-full h-full object-cover" />}
    </span>
  );
}

/** Platz 1-8 als Saeulen; Top 4 gruen, Rest grau. */
export function OutcomePlacement({ outcome, t }: { outcome: CompOutcome; t: T }) {
  const max = Math.max(...outcome.placementShare, 0);
  if (max <= 0) return null;
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-fg-secondary text-xs uppercase tracking-widest">{t('tft.comp.outcome.placement')}</h2>
        {outcome.lowData && <LowData t={t} />}
        <span className="ml-auto text-fg-muted text-xs tabular-nums">{outcome.games} {t('tft.gamesShort')}</span>
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2 items-end h-20">
        {outcome.placementShare.map((v, i) => (
          <div key={i} className="flex flex-col items-center justify-end h-full" title={`${i + 1}: ${(v * 100).toFixed(1)}%`}>
            <span className="text-xs text-fg-secondary tabular-nums mb-1">{pct(v)}</span>
            <div
              className="w-full rounded-t"
              style={{ height: `${Math.max(2, (v / max) * 100)}%`, backgroundColor: i < 4 ? GOOD : '#6b7785', opacity: i < 4 ? 0.85 : 0.6 }}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-8 gap-1.5 sm:gap-2 mt-1">
        {outcome.placementShare.map((_, i) => (
          <span key={i} className="text-center text-xs text-fg-muted tabular-nums">{i + 1}</span>
        ))}
      </div>
    </section>
  );
}

function ItemRow({ it, assets, bucket, t, extra = false }: { it: ItemOutcome; assets: TftAssetsBundle | null; bucket: string; t: T; extra?: boolean }) {
  const { withLang } = useI18n();
  const name = assets?.items[it.item]?.name || it.item.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '');
  return (
    <tr className="border-t border-border-subtle" data-fill-row="" data-fill-extra={extra ? '' : undefined}>
      <td className="py-1.5 pr-1 sm:pr-2">
        {/* flex-wrap unter lg: das Abzeichen rutscht unter das Item, statt die
            Tabelle am Handy breiter als die Box zu machen. */}
        <a href={withLang(`/tft/items/${encodeURIComponent(it.item)}?bucket=${bucket}`)} title={name} aria-label={name} className="flex flex-wrap lg:flex-nowrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1 hover:text-accent min-w-0">
          <TftItemIcon apiName={it.item} assets={assets} className="w-7 h-7 flex-shrink-0" />
          <span className="hidden sm:inline text-white truncate sm:max-w-[14rem]">{name}</span>
          {it.perCopy >= 1.5 && <span className="text-fg-muted text-[11px] tabular-nums">×{it.perCopy.toFixed(1)}</span>}
          {it.lowData && <LowData t={t} />}
        </a>
      </td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary">{pct(it.share)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-white">{it.avgPlacement.toFixed(2)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary hidden sm:table-cell">{pct(it.top4Rate)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums"><EffectCell effect={it.effect} /></td>
      <td className="py-1.5 pl-1 sm:pl-2 text-right"><GradeChip grade={it.grade} t={t} /></td>
    </tr>
  );
}

/** Ein Emblem der Comp: wer es traegt (bis 3 Units mit Anteil), wie oft, Ø Platz.
    Keine Wirkung/Stufe — das Emblem haengt am Trait, nicht an einer Unit. */
function EmblemRow({ e, basis, assets, bucket, t }: {
  e: CompEmblem; basis: CompEmblems['basis']; assets: TftAssetsBundle | null; bucket: string; t: T;
}) {
  const { withLang } = useI18n();
  const name = assets?.items[e.item]?.name || e.item.replace(/^(?:TFT\d*|Set\d+|DA)_(?:\d+_)?(?:Item_)?/, '');
  return (
    <tr className="border-t border-border-subtle">
      <td className="py-1.5 pr-1 sm:pr-2">
        {/* flex-wrap: Traeger rutschen bei wenig Platz unter den Namen, statt
            die Tabelle breiter als die Box zu machen. */}
        <div className="flex flex-wrap items-center gap-x-1.5 sm:gap-x-2 gap-y-1 min-w-0">
          <a href={withLang(`/tft/items/${encodeURIComponent(e.item)}?bucket=${bucket}`)} title={name} aria-label={name} className="flex items-center gap-1.5 sm:gap-2 hover:text-accent min-w-0">
            <TftItemIcon apiName={e.item} assets={assets} className="w-7 h-7 flex-shrink-0" />
            <span className="hidden sm:inline text-white truncate sm:max-w-[10rem]">{name}</span>
          </a>
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            {e.holders.map(h => (
              <span key={h.characterId} className="flex items-center gap-0.5" title={`${unitName(assets, h.characterId)} ${pct(h.share)}`}>
                <UnitTile cid={h.characterId} assets={assets} size="w-5 h-5" />
                <span className="text-fg-muted text-[11px] tabular-nums">{pct(h.share)}</span>
              </span>
            ))}
          </span>
          {e.lowData && <LowData t={t} />}
        </div>
      </td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary">
        {basis === 'games' && e.share != null ? pct(e.share) : (
          // Zahl und Wort untereinander — nebeneinander macht es die Spalte am
          // Handy so breit, dass rechts die Stufen abgeschnitten werden.
          <>
            <span className="block">{e.count}</span>
            <span className="block text-[11px] text-fg-muted leading-tight">{t('tft.comp.outcome.copies')}</span>
          </>
        )}
      </td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-white">{e.avgPlacement.toFixed(2)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right tabular-nums text-fg-secondary hidden sm:table-cell">{pct(e.top4Rate)}</td>
      <td className="py-1.5 px-1 sm:px-2 text-right text-fg-muted">—</td>
      <td className="py-1.5 pl-1 sm:pl-2 text-right text-fg-muted">—</td>
    </tr>
  );
}

const showsItems = (u: UnitOutcome) => u.itemCopies > 0 && u.items.length > 0;

/** Ob „Items je Unit“ etwas zeigt — die Detailseite stellt danach den
    Varianten-Umschalter in diese Box oder an seinen eigenen Platz. */
export function hasItemsPerUnit(outcome: CompOutcome | null | undefined): boolean {
  return !!outcome && outcome.units.some(showsItems);
}

/** Items je Unit: Unit waehlen, darunter Items nach Gruppe; die Embleme der
    Comp stehen in jedem Reiter gleich unter den Artefakten. */
export function OutcomeItems({ outcome, assets, bucket, t, leadUnits = [], itemCarriers = [], header = null }: {
  outcome: CompOutcome; assets: TftAssetsBundle | null; bucket: string; t: T;
  /** Fest vorn in dieser Reihenfolge (Detailseite: der Haupt-Carry). */
  leadUnits?: readonly string[];
  /** Weitere Item-Traeger der Comp — danach, nach Item-Kopien; dann der Rest. */
  itemCarriers?: readonly string[];
  /** Ganz oben in der Box (Detailseite: der Varianten-Umschalter). */
  header?: ReactNode;
}) {
  // Reihenfolge nach Wichtigkeit in der Comp (User 2026-10-10), innerhalb
  // einer Stufe nach Item-Kopien.
  const rank = (cid: string) => {
    const i = leadUnits.indexOf(cid);
    return i >= 0 ? i : itemCarriers.includes(cid) ? leadUnits.length : leadUnits.length + 1;
  };
  const units = outcome.units
    .filter(showsItems)
    .sort((a, b) => rank(a.characterId) - rank(b.characterId) || b.itemCopies - a.itemCopies)
    .slice(0, MAX_UNIT_TABS);
  const [selected, setSelected] = useState<string | null>(null);
  const [allItems, setAllItems] = useState(false);
  const unit: UnitOutcome | undefined = units.find(u => u.characterId === selected) ?? units[0];
  const totalOf = (g: ItemGroup) => (unit ? Math.min(unit.items.filter(i => i.group === g).length, MAX_ITEMS[g]) : 0);
  const hiddenItems = GROUP_ORDER.reduce((n, g) => n + Math.max(0, totalOf(g) - SHORT_ITEMS[g]), 0);
  const { areaRef, wrapRef, areaClass, areaStyle, extraRows } = useFillToBottom(units.length > 0, !allItems, hiddenItems, unit ? `${unit.characterId}:${unit.games}` : '');
  if (!unit) return null;
  // Gespeicherte Antworten von vor 0091 haben das Feld nicht — dann der
  // Uebergang aus den Items je Unit.
  const emblems = outcome.emblems === undefined ? compEmblemsFromUnits(outcome.units) : outcome.emblems;
  // Aufgefuellte Zeilen von oben nach unten: erst Standard bis 12, dann
  // Artefakte, dann Radiant (Taktiker ist schon voll).
  const cap = {} as Record<ItemGroup, number>;
  let left = extraRows;
  for (const g of GROUP_ORDER) {
    const more = allItems ? MAX_ITEMS[g] - SHORT_ITEMS[g] : Math.min(Math.max(0, totalOf(g) - SHORT_ITEMS[g]), left);
    if (!allItems) left -= more;
    cap[g] = SHORT_ITEMS[g] + more;
  }

  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4 lg:flex lg:flex-col">
      {header}
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.items')}</h2>
      <div className="flex flex-wrap gap-1.5 mb-3" role="tablist">
        {units.map(u => {
          const active = u.characterId === unit.characterId;
          return (
            <button
              key={u.characterId}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setSelected(u.characterId)}
              className={`flex items-center gap-1.5 pl-1 pr-2 py-1 rounded border text-xs transition-colors ${active ? 'border-accent bg-surface-raised text-white' : 'border-border-subtle text-fg-secondary hover:text-white'}`}
            >
              <UnitTile cid={u.characterId} assets={assets} size="w-7 h-7" />
              <span className="hidden sm:inline">{unitName(assets, u.characterId)}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-xs tabular-nums">
        <span className="text-white font-medium">{unitName(assets, unit.characterId)}</span>
        <span className="text-fg-muted">{unit.games} {t('tft.gamesShort')}</span>
        <span><span className="text-fg-muted">{t('tft.avgPlacement')} </span><span className="text-white">{unit.avgPlacement.toFixed(2)}</span></span>
        {unit.lowData && <LowData t={t} />}
      </div>

      <div ref={areaRef} className={areaClass} style={areaStyle}>
      <div ref={wrapRef} className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-muted text-[11px] uppercase tracking-widest">
              <th className="text-left font-normal pb-1 pr-1 sm:pr-2">{t('tft.comp.outcome.item')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.share')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2"><span className="sm:hidden">{t('tft.comp.outcome.avgShort')}</span><span className="hidden sm:inline">{t('tft.avgPlacement')}</span></th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2 hidden sm:table-cell">{t('tft.top4')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.effect')}</th>
              <th className="text-right font-normal pb-1 pl-1 sm:pl-2">{t('tft.comp.outcome.grade')}</th>
            </tr>
          </thead>
          {GROUP_ORDER.flatMap(g => {
            const rows = unit.items.filter(i => i.group === g).slice(0, cap[g]);
            const block = rows.length === 0 ? null : (
              <tbody key={g}>
                {g !== 'standard' && (
                  <tr>
                    <td colSpan={6} className="pt-3 pb-1 text-fg-muted text-[11px] uppercase tracking-widest">
                      {t(`tft.comp.outcome.group.${g}` as TranslationKey)}
                    </td>
                  </tr>
                )}
                {rows.map((it, i) => <ItemRow key={it.item} it={it} assets={assets} bucket={bucket} t={t} extra={!allItems && i >= SHORT_ITEMS[g]} />)}
              </tbody>
            );
            if (g !== 'artifact' || !emblems) return [block];
            return [block, (
              <tbody key="compEmblem">
                <tr>
                  <td colSpan={6} className="pt-3 pb-1 text-fg-muted text-[11px] uppercase tracking-widest">
                    {t('tft.comp.outcome.group.compEmblem')}
                    {emblems.basis === 'games' && (
                      <span className="normal-case tracking-normal tabular-nums"> · {emblems.games} {t('tft.gamesShort')}</span>
                    )}
                  </td>
                </tr>
                {emblems.rows.map(e => <EmblemRow key={e.item} e={e} basis={emblems.basis} assets={assets} bucket={bucket} t={t} />)}
              </tbody>
            )];
          })}
        </table>
      </div>
      <MoreToggle hidden={hiddenItems - extraRows} open={allItems} onToggle={() => setAllItems(v => !v)} t={t} />
      </div>
    </section>
  );
}

/** Unit-Wirkung: nur Units, fuer die es eine Ohne-Seite gibt; beste zuerst. */
/** Ob die Unit-Wirkung etwas zeigt — die Detailseite richtet danach ihr
    Raster aus (ab 1600 px steht die Box neben den Items). */
export function hasUnitEffect(outcome: CompOutcome | null | undefined): boolean {
  return !!outcome && outcome.units.some(u => u.effect != null);
}

export function OutcomeUnitEffect({ outcome, assets, bucket, t }: {
  outcome: CompOutcome; assets: TftAssetsBundle | null; bucket: string; t: T;
}) {
  const { withLang } = useI18n();
  const [showAll, setShowAll] = useState(false);
  const has = hasUnitEffect(outcome);
  const all = outcome.units
    .filter(u => u.effect != null)
    .sort((a, b) => a.effect!.delta - b.effect!.delta);
  const main = all.filter(u => u.presence >= UNIT_EFFECT_MIN_PRESENCE);
  // Steht keine Unit ueber der Schwelle, nicht kuerzen — sonst bliebe die Box leer.
  const short = new Set(main.length > 0 ? main : all);
  const { areaRef, wrapRef, areaClass, areaStyle, extraRows } = useFillToBottom(has, !showAll, all.length - short.size, String(outcome.games));
  if (!has) return null;
  // Aufgefuellt wird nach Anwesenheit (belastbarste zuerst); jede Unit steht
  // an ihrer Stelle in der Wirkungs-Sortierung, wie aufgeklappt.
  const filled = new Set(all.filter(u => !short.has(u)).sort((a, b) => b.presence - a.presence).slice(0, extraRows));
  const rows = showAll ? all : all.filter(u => short.has(u) || filled.has(u));
  return (
    <section className="mt-5 bg-surface-base border border-border-subtle rounded p-4 lg:flex lg:flex-col">
      <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.unitEffect')}</h2>
      <div ref={areaRef} className={areaClass} style={areaStyle}>
      <div ref={wrapRef} className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-fg-muted text-[11px] uppercase tracking-widest">
              <th className="text-left font-normal pb-1 pr-2" />
              <th className="text-right font-normal pb-1 px-1 sm:px-2">{t('tft.comp.outcome.presence')}</th>
              <th className="text-right font-normal pb-1 px-1 sm:px-2"><span className="sm:hidden">{t('tft.comp.outcome.avgShort')}</span><span className="hidden sm:inline">{t('tft.avgPlacement')}</span></th>
              <th className="text-right font-normal pb-1 pl-2">{t('tft.comp.outcome.effect')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(u => (
              <tr
                key={u.characterId}
                className="border-t border-border-subtle"
                data-fill-row=""
                data-fill-extra={!showAll && filled.has(u) ? '' : undefined}
                style={u.games < UNIT_EFFECT_SOLID_GAMES ? { opacity: 0.55 } : undefined}
              >
                <td className="py-1.5 pr-2">
                  <a href={withLang(`/tft/units/${encodeURIComponent(u.characterId)}?bucket=${bucket}`)} className="flex items-center gap-2 hover:text-accent">
                    <UnitTile cid={u.characterId} assets={assets} size="w-7 h-7" />
                    <span className="text-white truncate max-w-[9rem] sm:max-w-none">{unitName(assets, u.characterId)}</span>
                    {u.lowData && <LowData t={t} />}
                  </a>
                </td>
                <td className="py-1.5 px-2 text-right tabular-nums text-fg-secondary">{pct(u.presence)}</td>
                <td className="py-1.5 px-2 text-right tabular-nums text-white">{u.avgPlacement.toFixed(2)}</td>
                <td className="py-1.5 pl-2 text-right tabular-nums"><EffectCell effect={u.effect} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <MoreToggle hidden={all.length - short.size - extraRows} open={showAll} onToggle={() => setShowAll(v => !v)} t={t} />
      </div>
    </section>
  );
}

/** Endlevel der Boards, die Stage 5 erreicht haben. */
// bare: ohne eigene Box, als Teil der Leveln-Box der Detailseite.
export function OutcomeEndLevel({ outcome, t, bare = false }: { outcome: CompOutcome; t: T; bare?: boolean }) {
  const rows = outcome.levelsStage5;
  if (rows.length < 2) return null;
  const best = Math.min(...rows.filter(r => r.games >= 30).map(r => r.avgPlacement));
  const Wrap = bare ? 'div' : 'section';
  return (
    <Wrap className={bare ? '' : 'mt-5 bg-surface-base border border-border-subtle rounded p-4'}>
      {bare
        ? <div className="text-fg-muted text-[11px] uppercase tracking-widest mb-1">{t('tft.comp.outcome.endLevel')}</div>
        : <h2 className="text-fg-secondary text-xs uppercase tracking-widest mb-3">{t('tft.comp.outcome.endLevel')}</h2>}
      <table className="w-full text-xs">
        <thead>
          <tr className="text-fg-muted text-[11px] uppercase tracking-widest whitespace-nowrap">
            <th className="text-left font-normal pb-1 pr-2">{t('tft.comp.outcome.level')}</th>
            <th className="text-left font-normal pb-1 px-2 w-1/3">{t('tft.comp.outcome.share')}</th>
            {/* bare = schmale Spalte: kurze Ueberschrift auch auf breiten Bildschirmen */}
            <th className="text-right font-normal pb-1 px-2"><span className={bare ? '' : 'sm:hidden'}>{t('tft.comp.outcome.avgShort')}</span>{!bare && <span className="hidden sm:inline">{t('tft.avgPlacement')}</span>}</th>
            <th className="text-right font-normal pb-1 px-2">{t('tft.top4')}</th>
            <th className="text-right font-normal pb-1 pl-2 hidden sm:table-cell">{t('tft.top1')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.level} className="border-t border-border-subtle" style={{ opacity: r.games < 30 ? 0.55 : 1 }}>
              <td className="py-1.5 pr-2 text-white font-medium tabular-nums">{r.level}</td>
              <td className="py-1.5 px-2">
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-overlay rounded overflow-hidden">
                    <div className="h-full bg-accent" style={{ width: `${r.share * 100}%` }} />
                  </div>
                  <span className="text-fg-secondary tabular-nums w-9 text-right">{pct(r.share)}</span>
                </div>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums font-medium" style={{ color: r.avgPlacement === best ? GOOD : undefined }}>
                <span className={r.avgPlacement === best ? '' : 'text-white'}>{r.avgPlacement.toFixed(2)}</span>
              </td>
              <td className="py-1.5 px-2 text-right tabular-nums text-fg-secondary">{pct(r.top4Rate)}</td>
              <td className="py-1.5 pl-2 text-right tabular-nums text-fg-secondary hidden sm:table-cell">{pct(r.top1Rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Wrap>
  );
}

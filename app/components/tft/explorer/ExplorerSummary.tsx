'use client';
import { useI18n } from '../../../lib/i18n';
import { showTop1, showTop4, type ExplorerResponse } from '../../../lib/tft-explorer-query';
import { fmtAvg, fmtDelta, fmtPct } from './explorer-options';

// Farbe einer Abweichung beim Platz: kleiner = besser. Schliesst der
// Vertrauensbereich die Null ein, bleibt sie neutral (Tabelle: heller).
export function deltaClass(d: number | null, half: number | null, neutral = 'text-fg-muted'): string {
  if (d == null) return neutral;
  if (half != null && Math.abs(d) <= half) return neutral;
  return d < 0 ? 'text-pos-win' : 'text-pos-loss';
}

type Props = {
  hasFilters: boolean;
  /** Platzspanne der geladenen Daten; macht Top 4 / Sieg ggf. bedeutungslos. */
  place: [number, number] | null;
};

export default function ExplorerSummary({ data, ...rest }: Props & { data: ExplorerResponse }) {
  return <SummaryBox data={data} {...rest} />;
}

// Ladeplatzhalter: derselbe Aufbau mit unsichtbarem Inhalt im pulsierenden
// Rahmen, damit er bei jeder Breite und Zellenzahl genau so hoch ist wie die Box.
export function ExplorerSummarySkeleton(props: Props) {
  return <SummaryBox data={null} {...props} />;
}

// Halbe Hoehe (25.10.2026, User „Hälfte der aktuellen Höhe", Variante H2): ab lg
// eine Zahlenreihe, Rest in der Zusatzzeile von Δ, Platzverteilung mit
// Ueberschrift darueber und Balken bis 16 px (~84 statt 167 px bei 1440).
function SummaryBox({ data, hasFilters, place }: Props & { data: ExplorerResponse | null }) {
  const { t, lang } = useI18n();
  const s = data?.summary ?? null;
  // Δ = Auswahl gegen die Boards der Grundmenge OHNE sie (Plan 19.10.2026, C3);
  // darunter steht genau dieser Rest, damit sich die Zahl nachrechnen laesst.
  const d = data?.headDelta?.dOut ?? null;
  const dh = data?.headDelta?.dOutHalf ?? null;
  const restGames = data && s ? data.base.games - s.games : 0;
  const restAvg = data && s && restGames > 0 && data.base.avg != null && s.avg != null
    ? (data.base.avg * data.base.games - s.avg * s.games) / restGames : null;
  // Platzhalter: volle Balken, damit er so hoch ist wie die Grafik mit Daten.
  const hist = s?.hist ?? [1, 1, 1, 1, 1, 1, 1, 1];
  const maxH = Math.max(1, ...hist);
  const num = (v: number) => v.toLocaleString(lang === 'de' ? 'de-DE' : lang);
  const hide = data ? '' : 'invisible';
  // Platzhalter: unsichtbare Musterzahlen in den Zusatzzeilen, sonst ist er am
  // Handy niedriger als die Box (gemessen 199 statt 232 px).
  const ph = !data;

  const stat = (label: string, value: React.ReactNode, sub?: React.ReactNode, valueCls = 'text-fg-bright') => (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className={`${valueCls} text-lg font-semibold tabular-nums leading-tight`}>{value}</div>
      {sub && <div className="text-[11px] text-fg-faint tabular-nums lg:whitespace-nowrap">{sub}</div>}
    </div>
  );

  return (
    <div aria-hidden={data ? undefined : true}
      className={`rounded-xl border border-border-subtle bg-surface-base p-3 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 md:gap-8 ${data ? '' : 'animate-pulse'}`}>
      {/* Handy bis md: Raster mit 3 Spalten; ab lg eine Reihe, links buendig mit fester
          Luecke (User 25.10.2026 „näher zusammen", dann zweimal mehr Abstand → 64 px ab xl;
          72 px schoebe bei 1280 px und allen Patches die Grafik raus). Darunter 16 px: bei 1024 px und allen Patches (16,5 Mio Bretter)
          schoebe mehr die Grafik ueber den Rand (gemessen schon mit 24 px 599 statt 573 px).
          Δ steht am Ende, sonst reisst seine lange Zusatzzeile eine Luecke in die Reihe. */}
      <div className={`grid grid-cols-3 gap-x-4 gap-y-3 lg:grid-cols-none lg:grid-flow-col lg:auto-cols-max xl:gap-x-16 ${hide}`}>
        {stat(t('tft.explorer.sort.games'), s ? num(s.games) : '—',
          hasFilters ? (s && data?.base.games ? fmtPct(s.games / data.base.games) : ph ? '00.0%' : undefined) : undefined)}
        {stat(t('tft.explorer.x.matches'), s ? num(s.matches) : '—')}
        {stat(t('tft.explorer.sort.avg'), fmtAvg(s?.avg ?? null), s?.half != null ? `±${s.half.toFixed(2)}` : ph ? '±0.00' : undefined)}
        {showTop4(place) && stat(t('tft.explorer.sort.top4'), s ? fmtPct(s.top4) : '—')}
        {showTop1(place) && stat(t('tft.explorer.sort.top1'), s ? fmtPct(s.top1) : '—')}
        {hasFilters && stat(t('tft.explorer.x.delta'), fmtDelta(d), (
          <>
            {(dh != null || ph) && <>{'±'}{(dh ?? 0).toFixed(2)}{' · '}</>}
            <span className="text-fg-muted">
              {t('tft.explorer.x.rest')}: {restAvg != null ? `${fmtAvg(restAvg)} · ${num(restGames)}` : ph ? '0.00 · 000.000' : '—'}
            </span>
          </>
        ), deltaClass(d, dh))}
      </div>
      <div className={hide}>
        <div className="text-[11px] leading-none text-fg-muted mb-1">{t('tft.explorer.x.placeDist')}</div>
        {/* Feldhoehe ergibt sich aus %-Zahl + Balken + Ziffer; die Balkenhoehe kommt als Anteil (--r). */}
        <div className="flex items-end gap-1 lg:gap-1.5">
          {hist.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5 w-7 lg:w-9">
              <span className="text-[9px] lg:text-[11px] leading-none text-fg-faint tabular-nums">{s?.games ? Math.round((h / s.games) * 100) : 0}%</span>
              <div className={`w-full rounded-sm h-[max(2px,calc(var(--r)*16px))] ${i < 4 ? 'bg-accent-a60' : 'bg-accent-a20'}`}
                style={{ '--r': h / maxH } as React.CSSProperties} />
              <span className="text-[10px] lg:text-xs leading-none text-fg-muted tabular-nums">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

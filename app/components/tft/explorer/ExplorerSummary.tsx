'use client';
import { useI18n } from '../../../lib/i18n';
import { showTop1, showTop4, type ExplorerResponse } from '../../../lib/tft-explorer-query';
import { fmtAvg, fmtDelta, fmtPct } from './explorer-options';

// Farbe einer Abweichung beim Platz: kleiner = besser. Schliesst der
// Vertrauensbereich die Null ein, bleibt sie neutral.
export function deltaClass(d: number | null, half: number | null): string {
  if (d == null) return 'text-fg-muted';
  if (half != null && Math.abs(d) <= half) return 'text-fg-muted';
  return d < 0 ? 'text-pos-win' : 'text-pos-loss';
}

export default function ExplorerSummary({
  data, hasFilters, place,
}: {
  data: ExplorerResponse;
  hasFilters: boolean;
  /** Platzspanne der geladenen Daten; macht Top 4 / Sieg ggf. bedeutungslos. */
  place: [number, number] | null;
}) {
  const { t, lang } = useI18n();
  const s = data.summary;
  // Δ = Auswahl gegen die Boards der Grundmenge OHNE sie (Plan 19.10.2026, C3);
  // daneben steht genau dieser Rest, damit sich die Zahl nachrechnen laesst.
  const d = data.headDelta?.dOut ?? null;
  const dh = data.headDelta?.dOutHalf ?? null;
  const restGames = data.base.games - s.games;
  const restAvg = restGames > 0 && data.base.avg != null && s.avg != null
    ? (data.base.avg * data.base.games - s.avg * s.games) / restGames : null;
  const maxH = Math.max(1, ...s.hist);
  const num = (v: number) => v.toLocaleString(lang === 'de' ? 'de-DE' : lang);

  const stat = (label: string, value: React.ReactNode, sub?: React.ReactNode) => (
    <div className="min-w-0">
      <div className="text-[11px] text-fg-muted">{label}</div>
      <div className="text-fg-bright text-lg font-semibold tabular-nums leading-tight">{value}</div>
      {sub && <div className="text-[11px] text-fg-faint tabular-nums">{sub}</div>}
    </div>
  );

  return (
    <div className="rounded-xl border border-border-subtle bg-surface-base p-4 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 md:gap-8">
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-4">
        {stat(t('tft.explorer.sort.games'), num(s.games), hasFilters && data.base.games ? fmtPct(s.games / data.base.games) : undefined)}
        {stat(t('tft.explorer.x.matches'), num(s.matches))}
        {stat(t('tft.explorer.sort.avg'), fmtAvg(s.avg), s.half != null ? `±${s.half.toFixed(2)}` : undefined)}
        {showTop4(place) && stat(t('tft.explorer.sort.top4'), fmtPct(s.top4))}
        {showTop1(place) && stat(t('tft.explorer.sort.top1'), fmtPct(s.top1))}
        {hasFilters && (
          <div className="col-span-3 sm:col-span-5 flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-border-subtle">
            <div>
              <span className="text-[11px] text-fg-muted mr-2">{t('tft.explorer.x.delta')}</span>
              <span className={`text-lg font-semibold tabular-nums ${deltaClass(d, dh)}`}>{fmtDelta(d)}</span>
              {dh != null && <span className="text-[11px] text-fg-faint tabular-nums ml-1">{'±'}{dh.toFixed(2)}</span>}
            </div>
            <span className="text-[11px] text-fg-muted tabular-nums">
              {t('tft.explorer.x.rest')}: {restAvg != null ? `${fmtAvg(restAvg)} · ${num(restGames)}` : '—'}
            </span>
          </div>
        )}
      </div>
      <div>
        <div className="text-[11px] text-fg-muted mb-1">{t('tft.explorer.x.placeDist')}</div>
        {/* Ab lg groesser; die Balkenhoehe kommt als Anteil (--r), der Massstab aus der Klasse. */}
        <div className="flex items-end gap-1 lg:gap-1.5 h-20 lg:h-28">
          {s.hist.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5 w-7 lg:w-9">
              <span className="text-[9px] lg:text-[11px] text-fg-faint tabular-nums">{s.games ? Math.round((h / s.games) * 100) : 0}%</span>
              <div className={`w-full rounded-sm h-[max(2px,calc(var(--r)*52px))] lg:h-[max(2px,calc(var(--r)*76px))] ${i < 4 ? 'bg-accent-a60' : 'bg-accent-a20'}`}
                style={{ '--r': h / maxH } as React.CSSProperties} />
              <span className="text-[10px] lg:text-xs text-fg-muted tabular-nums">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

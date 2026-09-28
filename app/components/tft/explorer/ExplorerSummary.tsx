'use client';
import { useI18n } from '../../../lib/i18n';
import type { ExplorerResponse } from '../../../lib/tft-explorer-query';
import { fmtAvg, fmtDelta, fmtPct } from './explorer-options';

export type DeltaMode = 'base' | 'out';

// Farbe einer Abweichung beim Platz: kleiner = besser. Schliesst der
// Vertrauensbereich die Null ein, bleibt sie neutral.
export function deltaClass(d: number | null, half: number | null): string {
  if (d == null) return 'text-fg-muted';
  if (half != null && Math.abs(d) <= half) return 'text-fg-muted';
  return d < 0 ? 'text-pos-win' : 'text-pos-loss';
}

export default function ExplorerSummary({
  data, deltaMode, setDeltaMode, hasFilters,
}: {
  data: ExplorerResponse;
  deltaMode: DeltaMode;
  setDeltaMode: (m: DeltaMode) => void;
  hasFilters: boolean;
}) {
  const { t, lang } = useI18n();
  const s = data.summary;
  const hd = data.headDelta;
  const d = hd ? (deltaMode === 'base' ? hd.dBase : hd.dOut) : null;
  const dh = hd ? (deltaMode === 'base' ? hd.dBaseHalf : hd.dOutHalf) : null;
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
        {stat(t('tft.explorer.sort.top4'), fmtPct(s.top4))}
        {stat(t('tft.explorer.sort.top1'), fmtPct(s.top1))}
        {hasFilters && (
          <div className="col-span-3 sm:col-span-5 flex flex-wrap items-center gap-x-4 gap-y-2 pt-3 border-t border-border-subtle">
            <div>
              <span className="text-[11px] text-fg-muted mr-2">{t('tft.explorer.x.delta')}</span>
              <span className={`text-lg font-semibold tabular-nums ${deltaClass(d, dh)}`}>{fmtDelta(d)}</span>
              {dh != null && <span className="text-[11px] text-fg-faint tabular-nums ml-1">{'±'}{dh.toFixed(2)}</span>}
            </div>
            <DeltaToggle mode={deltaMode} set={setDeltaMode} />
            <span className="text-[11px] text-fg-muted tabular-nums">
              {t('tft.explorer.x.base')}: {fmtAvg(data.base.avg)} {'·'} {num(data.base.games)}
            </span>
          </div>
        )}
      </div>
      <div>
        <div className="text-[11px] text-fg-muted mb-1">{t('tft.explorer.x.placeDist')}</div>
        <div className="flex items-end gap-1 h-20">
          {s.hist.map((h, i) => (
            <div key={i} className="flex flex-col items-center gap-0.5 w-7">
              <span className="text-[9px] text-fg-faint tabular-nums">{s.games ? Math.round((h / s.games) * 100) : 0}%</span>
              <div className={`w-full rounded-sm ${i < 4 ? 'bg-accent-a60' : 'bg-accent-a20'}`} style={{ height: `${Math.max(2, (h / maxH) * 52)}px` }} />
              <span className="text-[10px] text-fg-muted tabular-nums">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DeltaToggle({ mode, set }: { mode: DeltaMode; set: (m: DeltaMode) => void }) {
  const { t } = useI18n();
  const seg = (on: boolean) =>
    `px-2 py-0.5 text-[11px] ${on ? 'bg-accent-a20 text-fg-bright' : 'text-fg-secondary hover:text-fg-primary'}`;
  return (
    <div className="inline-flex rounded-md border border-border-subtle overflow-hidden">
      <button type="button" className={seg(mode === 'base')} onClick={() => set('base')}>{t('tft.explorer.x.deltaMode.base')}</button>
      <button type="button" className={seg(mode === 'out')} onClick={() => set('out')}>{t('tft.explorer.x.deltaMode.out')}</button>
    </div>
  );
}

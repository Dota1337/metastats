'use client';
import type { ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { tftPatchLabel } from '../../lib/tft-patch-label';
import type { PatchDelta, PatchDeltaPair } from '../../lib/tft-patch-delta';

type T = (k: any) => string;

/** Kopf der Vergleichs-Spalte: „Δ vs 18.3b". */
export function deltaHeader(t: T, pair: PatchDeltaPair | null): string {
  return pair ? t('tft.delta.vsPatch').replace('{patch}', tftPatchLabel(pair.prev)) : t('tft.filter.velocity');
}

/** Tooltip einer Vergleichs-Zelle: Richtung bzw. Grund fuer „—", dazu beide
 *  Patches mit Ø-Platz und Spielzahl, damit die Zahl im Kontext steht. */
export function deltaTooltip(delta: PatchDelta | null, pair: PatchDeltaPair | null, t: T, lang: string): string {
  if (!delta || !pair) return t('tft.velocity.notEnough');
  const avg = (v: number | null) => (v != null ? v.toFixed(2) : '—');
  const detail = t('tft.delta.tooltipDetail')
    .replace('{now}', tftPatchLabel(pair.patch))
    .replace('{nowAvg}', avg(delta.avgPlaceNow))
    .replace('{nowGames}', delta.gamesNow.toLocaleString(lang))
    .replace('{prev}', tftPatchLabel(pair.prev))
    .replace('{prevAvg}', avg(delta.avgPlacePrev))
    .replace('{prevGames}', delta.gamesPrev.toLocaleString(lang));
  const head = delta.isNew ? t('tft.velocity.newComp')
    : delta.deltaAvgPlace == null ? t('tft.velocity.notEnough')
    : delta.deltaAvgPlace < 0 ? t('tft.velocity.better') : t('tft.velocity.worse');
  return `${head} — ${detail}`;
}

/** Vergleichs-Zelle der Units- und Traits-Liste: lila Beschriftung auf dem
 *  Handy, gruener/roter Pfeil mit Wert, „NEU" fuer Zeilen ohne Vorpatch.
 *  Waehrend des Ladens leer (die Liste steht schon, die Spalte fuellt sich). */
export default function PatchDeltaCell({ delta, pair, loading, label }: {
  delta: PatchDelta | null;
  pair: PatchDeltaPair | null;
  loading: boolean;
  label: string;
}) {
  const { t, lang } = useI18n();
  const render = (content: ReactNode, title?: string) => (<>
    <div className="md:hidden" title={title}>
      <div className="text-[#c39bff] text-[9px] uppercase tracking-widest leading-tight">{label}</div>
      <div className="tabular-nums leading-tight">{content}</div>
    </div>
    <div className="hidden md:block text-right tabular-nums" title={title}>{content}</div>
  </>);
  if (loading) return render(null);
  const tip = deltaTooltip(delta, pair, t, lang);
  if (delta?.isNew) {
    return render(<span className="text-[#c39bff] font-semibold">{t('tft.velocity.newComp')}</span>, tip);
  }
  if (delta?.deltaAvgPlace == null) {
    return render(<span className="text-fg-faint">—</span>, tip);
  }
  const better = delta.deltaAvgPlace < 0;
  return render(
    <span style={{ color: better ? '#3ecf8e' : '#e44040' }} className="font-medium">
      {better ? '▲' : '▼'} {Math.abs(delta.deltaAvgPlace).toFixed(2)}
    </span>,
    tip,
  );
}

'use client';
// Kopf der Comp-Liste (Spaltennamen + Core/Flex-Legende) — gemeinsam fuer den
// Comps-Reiter und "Comps mit dieser Unit" auf der Unit-Detailseite, damit
// beide Listen gleich aussehen (User 19.10.2026). Spalten wie CompFamilyRow.
import type { TranslationKey } from '../../lib/i18n';
import { coreFlexFrame } from '../../lib/tft-ui';
import { deltaHeader } from './PatchDeltaCell';
import type { DeltaView } from './CompRow';

export default function CompFamilyListHeader({ t, deltaView = null }: { t: (k: TranslationKey) => string; deltaView?: DeltaView | null }) {
  return (
    <>
      {/* Handy: der Tabellenkopf mit der Legende ist dort ausgeblendet —
          Legende als eigene Zeile (User 2026-10-10). */}
      <div className="sm:hidden mb-2 px-1 text-[11px]">
        <CoreFlexLegend t={t} />
      </div>
      <div className={`hidden sm:grid items-center gap-3 px-3.5 py-2 text-[11px] text-fg-secondary font-semibold whitespace-nowrap ${
        deltaView
          ? 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_3.75rem_9.125rem]'
          : 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_9.125rem]'
      }`}>
        <div></div>
        <div></div>
        <div>{t('nav.comps')}</div>
        {/* Legende zu den Core/Flex-Rahmen der Unit-Reihe (User 2026-10-10). */}
        <CoreFlexLegend t={t} />
        <div className="text-center">{t('tft.avgPlacement')}</div>
        <div className="text-right">{t('tft.top4')}</div>
        <div className="text-right">{t('tft.top1')}</div>
        <div className="text-right">{t('tft.pickRate')}</div>
        <div className="text-right">{t('tft.gamesShort')}</div>
        {deltaView && (
          <div className="text-right text-[#c39bff]">
            {deltaHeader(t, deltaView.pair)}
          </div>
        )}
        <div></div>
      </div>
    </>
  );
}

// Legende zu den Core/Flex-Rahmen: Mini-Rahmen im Stil der Gruppen (coreFlexFrame).
export function CoreFlexLegend({ t }: { t: (k: TranslationKey) => string }) {
  return (
    <div className="flex items-center gap-3 font-normal text-fg-muted">
      {(['core', 'flex'] as const).map(k => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[3px]" style={coreFlexFrame(k)} aria-hidden="true" />
          {t(`tft.comp.board.${k}`)}
        </span>
      ))}
    </div>
  );
}

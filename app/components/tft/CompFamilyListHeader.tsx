'use client';
// Kopf der Comp-Liste (Spaltennamen) — gemeinsam fuer den Comps-Reiter und
// "Comps mit dieser Unit" auf der Unit-Detailseite, damit beide Listen gleich
// aussehen (User 19.10.2026). Spalten wie CompFamilyRow. Die Core/Flex-Legende
// ist seit 19.10.2026 weg: jeder Rahmen traegt sein Label selbst (CoreFlexGroups).
import type { TranslationKey } from '../../lib/i18n';
import { deltaHeader } from './PatchDeltaCell';
import type { DeltaView } from './CompRow';

export default function CompFamilyListHeader({ t, deltaView = null }: { t: (k: TranslationKey) => string; deltaView?: DeltaView | null }) {
  return (
    <>
      <div className={`hidden sm:grid items-center gap-3 px-3.5 py-2 text-[11px] text-fg-secondary font-semibold whitespace-nowrap ${
        deltaView
          ? 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_3.75rem_9.125rem]'
          : 'grid-cols-[1.5rem_1.75rem_minmax(13rem,1fr)_minmax(0,auto)_5rem_3.5rem_3.5rem_3.5rem_3.5rem_9.125rem]'
      }`}>
        <div></div>
        <div></div>
        <div>{t('nav.comps')}</div>
        <div></div>
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

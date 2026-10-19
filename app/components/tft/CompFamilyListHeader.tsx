'use client';
// Kopf der Comp-Liste (Spaltennamen) — gemeinsam fuer den Comps-Reiter und
// "Comps mit dieser Unit" auf der Unit-Detailseite, damit beide Listen gleich
// aussehen (User 19.10.2026). Raster aus compListGrid, wie die Zeile; erst ab
// 768 px, darunter hat die Zeile keine Spalten. Units- und Knopf-Zelle nur,
// wenn die Zeile einzeilig ist — sonst stehen beide in der zweiten Zeile und
// belegen hier keinen Platz. Die Core/Flex-Legende ist seit 19.10.2026 weg:
// jeder Rahmen traegt sein Label selbst (CoreFlexGroups).
import type { TranslationKey } from '../../lib/i18n';
import { deltaHeader } from './PatchDeltaCell';
import { compListGrid, type DeltaView } from './CompRow';

export default function CompFamilyListHeader({ t, deltaView = null }: { t: (k: TranslationKey) => string; deltaView?: DeltaView | null }) {
  const grid = compListGrid(!!deltaView);
  return (
    <>
      <div className={`hidden md:grid items-center gap-3 px-3.5 py-2 text-[11px] text-fg-secondary font-semibold whitespace-nowrap ${grid.cols}`}>
        <div></div>
        <div></div>
        <div>{t('nav.comps')}</div>
        <div className={grid.oneLineOnly}></div>
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
        <div className={grid.oneLineOnly}></div>
      </div>
    </>
  );
}

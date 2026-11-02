'use client';
// Kopf der Comp-Liste (Spaltennamen) — gemeinsam fuer den Comps-Reiter und
// "Comps mit dieser Unit" auf der Unit-Detailseite, damit beide Listen gleich
// aussehen (User 19.10.2026). Raster aus compListGrid, wie die Zeile; erst ab
// 768 px, darunter hat die Zeile keine Spalten. Units- und Knopf-Zelle nur,
// wenn die Zeile einzeilig ist — sonst stehen beide in der zweiten Zeile und
// belegen hier keinen Platz. Die Core/Flex-Legende ist seit 19.10.2026 weg:
// jeder Rahmen traegt sein Label selbst (CoreFlexGroups).
//
// Seit 03.11.2026 13 px und Spiele/Pickrate in einer Spalte (Raster compListGrid).
//
// Mit `onSort` (Item-Detailseite, User 02.11.2026) sind die Spaltennamen Knoepfe:
// Klick ordnet die Liste nach dieser Spalte, „Comps" stellt die Standardreihenfolge
// der Seite wieder her (sort null). Ohne `onSort` unveraendert reiner Text.
import type { TranslationKey } from '../../lib/i18n';
import { deltaHeader } from './PatchDeltaCell';
import { compListGrid, type DeltaView } from './CompRow';

export type CompHeaderSort = 'avg' | 'top4' | 'win' | 'pick' | 'games';

export default function CompFamilyListHeader({
  t,
  deltaView = null,
  sort = null,
  onSort,
}: {
  t: (k: TranslationKey) => string;
  deltaView?: DeltaView | null;
  sort?: CompHeaderSort | null;
  onSort?: (next: CompHeaderSort | null) => void;
}) {
  const grid = compListGrid(!!deltaView);
  const label = (key: CompHeaderSort | null, text: string) => {
    if (!onSort) return text;
    const active = sort === key;
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSort(key)}
        // min-h-6: 24 px Tippflaeche auf dem Tablet, auch fuer die zwei
        // uebereinander stehenden Knoepfe Spiele/Pickrate.
        className={`min-h-6 font-semibold transition-colors hover:text-white ${active ? 'text-white underline underline-offset-4 decoration-accent' : ''}`}
      >
        {text}
      </button>
    );
  };
  // 13 px wie die Zahlen darunter (User 03.11.2026, vorher 11 px). Spiele und
  // Pickrate teilen sich eine Spalte: Spiele oben, Pickrate darunter.
  return (
    <>
      <div className={`hidden md:grid items-center gap-3 px-3.5 py-2 text-[13px] leading-tight text-fg-secondary font-semibold whitespace-nowrap ${grid.cols}`}>
        <div></div>
        <div></div>
        <div>{label(null, t('nav.comps'))}</div>
        <div className={grid.oneLineOnly}></div>
        {/* flex statt text-center: „Avg Placement" ist bei 13 px breiter als die
            80-px-Spalte; text-center schiebt den Ueberhang nur nach rechts,
            flex verteilt ihn auf beide Seiten. */}
        <div className="flex justify-center">{label('avg', t('tft.avgPlacement'))}</div>
        <div className="text-right">{label('top4', t('tft.top4'))}</div>
        <div className="text-right">{label('win', t('tft.top1'))}</div>
        <div className="flex flex-col items-end">
          <span>{label('games', t('tft.gamesShort'))}</span>
          <span>{label('pick', t('tft.pickRate'))}</span>
        </div>
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

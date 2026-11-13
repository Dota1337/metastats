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
  const label = (key: CompHeaderSort | null, text: string, stack?: 'top' | 'bottom') => {
    if (!onSort) return text;
    const active = sort === key;
    // 24 px Tippflaeche auf dem Tablet. Spiele/Pickrate stehen so eng wie die
    // Zahlen darunter (16 px, User 03.11.2026): ihre Flaeche waechst nur nach
    // aussen in das py-2 des Kopfs, sonst ueberlappen sich die zwei Knoepfe.
    const hit = stack === 'top'
      ? 'relative before:absolute before:inset-x-0 before:-top-2 before:bottom-0'
      : stack === 'bottom'
        ? 'relative before:absolute before:inset-x-0 before:top-0 before:-bottom-2'
        : 'min-h-6';
    return (
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSort(key)}
        className={`${hit} font-semibold transition-colors hover:text-white ${active ? 'text-white underline underline-offset-4 decoration-accent' : ''}`}
      >
        {text}
      </button>
    );
  };
  // 13 px wie die Zahlen darunter (User 03.11.2026, vorher 11 px). Spiele und
  // Pickrate teilen sich eine Spalte: Spiele oben, Pickrate darunter.
  // Eigene Box (User 13.11.2026), direkt am md:grid-Element — eine Huelle
  // darum stuende auf dem Handy leer da. Lila Rand + hellere Flaeche, damit
  // der Kopf nicht wie eine weitere Comp-Zeile aussieht (User-Wahl „lila +
  // andere Flaeche“). 1 px Rand + px-3.5 wie die Zeile (CompRow), damit die
  // Spalten genau ueber den Zahlen bleiben. Kein overflow-hidden und py-2
  // bleibt: die Tippflaechen der sortierbaren Koepfe (Item-Seite) reichen
  // 8 px in den Innenabstand.
  return (
    <>
      <div className={`hidden md:grid items-center gap-3 px-3.5 py-2 mb-2 rounded-lg border border-accent-a60 bg-surface-raised text-[13px] leading-tight text-fg-secondary font-semibold whitespace-nowrap ${grid.cols}`}>
        <div></div>
        <div></div>
        <div>{label(null, t('nav.comps'))}</div>
        <div className={grid.oneLineOnly}></div>
        {/* Alle Werte-Spalten gleich breit und zentriert (User 03.11.2026). flex
            statt text-center: „Avg. Place" ist bei 13 px breiter als die
            56-px-Spalte; text-center schiebt den Ueberhang nur nach rechts,
            flex verteilt ihn auf beide Seiten. */}
        <div className="flex justify-center">{label('avg', t('tft.avgPlacement'))}</div>
        <div className="flex justify-center">{label('top4', t('tft.top4'))}</div>
        <div className="flex justify-center">{label('win', t('tft.top1'))}</div>
        <div className="flex flex-col items-center">
          <span>{label('games', t('tft.gamesShort'), 'top')}</span>
          <span>{label('pick', t('tft.pickRate'), 'bottom')}</span>
        </div>
        {deltaView && (
          <div className="flex justify-center text-[#c39bff]">
            {deltaHeader(t, deltaView.pair)}
          </div>
        )}
        <div className={grid.oneLineOnly}></div>
      </div>
    </>
  );
}

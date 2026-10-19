'use client';
import { useId, type ReactNode } from 'react';
import { useI18n } from '../../lib/i18n';
import { splitCoreFlex, type CoreFlexKind } from '../../lib/tft-comp-roles';
import { coreFlexFrame } from '../../lib/tft-ui';

// Unit-Reihe mit je einem Rahmen fuer Core und Flex (User 2026-10-10), fuer
// Comp-Liste und Comp-DNA. Sortiert nicht selbst: die Reihenfolge kommt vom
// Aufrufer und gilt innerhalb jeder Gruppe. Aussen und innen wird umgebrochen —
// passt die Reihe nicht, rutscht erst der Flex-Rahmen als Ganzes in die zweite
// Zeile (User: „Flex in zweite Zeile"), erst danach brechen Kacheln im Rahmen
// um. 5 px Innenabstand, damit 3★-/×2-Badges und das Vergroessern beim Zeigen
// nicht auf der Linie liegen. Rahmen ohne Klick-Handler: in der role=link-Zeile
// fuehrt ein Klick aufs Polster zur Detailseite wie die Luecken bisher.
// Seit 19.10.2026 (User: „nur noch die obere Linie … Bezeichnung … darüber und
// jeweils mittig"): Linie nur oben, „Core"/„Flex" steht mittig ueber der Box.
// Label und Box stecken in einer Huelle, damit sie gemeinsam umbrechen; die
// Huelle benennt die Gruppe per aria-labelledby (vorher fieldset/legend).
export default function CoreFlexGroups<T extends { characterId: string }>({
  units, kinds, forceCore = [], renderUnit, className = '',
}: {
  units: readonly T[];
  kinds: Readonly<Record<string, CoreFlexKind>> | null | undefined;
  forceCore?: readonly string[];
  renderUnit: (u: T) => ReactNode;
  className?: string;
}) {
  const { t } = useI18n();
  const id = useId();
  const groups = splitCoreFlex(units, kinds, forceCore);
  return (
    <div className={`flex flex-wrap items-start gap-1.5 ${className}`}>
      {(['core', 'flex'] as const).map(k => {
        const frame = coreFlexFrame(k);
        return groups[k].length > 0 && frame && (
          <div key={k} role="group" aria-labelledby={`${id}-${k}`} className="min-w-0 flex flex-col">
            <div id={`${id}-${k}`} className="mb-0.5 text-center text-[10px] leading-3 text-fg-muted whitespace-nowrap">
              {t(`tft.comp.board.${k}`)}
            </div>
            <div
              className="flex flex-wrap items-start gap-1.5 px-[5px] pb-[5px] pt-1"
              style={{ borderTop: frame.border, background: frame.background }}
            >
              {groups[k].map(renderUnit)}
            </div>
          </div>
        );
      })}
      {groups.rest.map(renderUnit)}
    </div>
  );
}

'use client';
import type { ReactNode } from 'react';
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
// Seit 19.10.2026 (User: „entferne die untere Linie … Core + Flex Beschreibung
// über jede Box"): Linie nur oben/links/rechts, „Core"/„Flex" sitzt als legend
// in der oberen Linie (fieldset benennt die Gruppe, daher kein aria-label).
// Das Label steht im fieldset, damit es mit seinem Rahmen umbricht.
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
  const groups = splitCoreFlex(units, kinds, forceCore);
  return (
    <div className={`flex flex-wrap items-start gap-1.5 ${className}`}>
      {(['core', 'flex'] as const).map(k => {
        const frame = coreFlexFrame(k);
        return groups[k].length > 0 && frame && (
          <fieldset
            key={k}
            className="min-w-0 rounded-t-lg px-[5px] pb-[5px] pt-1"
            style={{ borderTop: frame.border, borderLeft: frame.border, borderRight: frame.border, background: frame.background }}
          >
            <legend className="ml-1 px-1 text-[10px] leading-3 text-fg-muted whitespace-nowrap">
              {t(`tft.comp.board.${k}`)}
            </legend>
            <div className="flex flex-wrap items-start gap-1.5">
              {groups[k].map(renderUnit)}
            </div>
          </fieldset>
        );
      })}
      {groups.rest.map(renderUnit)}
    </div>
  );
}

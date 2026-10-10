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
      {(['core', 'flex'] as const).map(k => groups[k].length > 0 && (
        <div
          key={k}
          role="group"
          aria-label={t(`tft.comp.board.${k}`)}
          className="flex flex-wrap items-start gap-1.5 rounded-lg p-[5px]"
          style={coreFlexFrame(k)}
        >
          {groups[k].map(renderUnit)}
        </div>
      ))}
      {groups.rest.map(renderUnit)}
    </div>
  );
}

'use client';
import { useMemo } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftIconUrl } from '../../lib/tft-cdragon';
import { computeActiveTraits, activeTraitStyleColor } from '../../lib/tft-active-traits';

// Active-Traits-Mini-Strip pro Boards-by-Activation-Card. Berechnet die
// Synergien aus den row-spezifischen typicalUnits — Spieler sieht „bei
// Aktivierungs-Stufe 6 sind diese Traits aktiv". Kompakt: nur Icon +
// Count + Style-Color, kein Name, kein Drill-Down (wäre zu dicht).

export default function CompLevelActiveTraits({
  typicalUnits,
  clusterKey,
  assets,
}: {
  typicalUnits: Array<{ characterId: string; count?: number | unknown }>;
  clusterKey: string;
  assets: TftAssetsBundle | null;
}) {
  const traits = useMemo(
    () => computeActiveTraits(typicalUnits, clusterKey, assets),
    [typicalUnits, clusterKey, assets],
  );
  if (traits.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-2 pt-2 border-t border-[#1e2a3a]">
      {traits.map(tr => {
        const color = activeTraitStyleColor(tr.style);
        const iconUrl = tr.icon ? tftIconUrl(assets, tr.icon) : null;
        return (
          <div
            key={tr.apiName}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#0a0e1a] border"
            style={{ borderColor: `${color}55` }}
            title={`${tr.count} ${tr.displayName}`}
          >
            {iconUrl ? (
              <img
                src={iconUrl}
                alt=""
                className="w-3.5 h-3.5"
                style={{ filter: `drop-shadow(0 0 1px ${color})` }}
              />
            ) : (
              <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: `${color}33` }} />
            )}
            <span
              className="text-[10px] font-bold tabular-nums"
              style={{ color }}
            >
              {tr.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

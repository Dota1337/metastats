'use client';
import { useEffect, useState } from 'react';
import type { TftAssetsBundle } from '../../lib/tft-cdragon';
import { tftChampionTileUrl } from '../../lib/tft-cdragon';

// Per-unit board heatmap for /tft/comps/[slug]. Fetches position data
// aggregated from the Overwolf companion app's submissions and shows a
// mini 4×7 hex grid per typical unit, with the cells the unit is most
// often placed on highlighted by frequency.
//
// TFT board layout — matches the in-game player POV:
//   data row 0 (back)  cells 0–6   → visual BOTTOM row
//   data row 1         cells 7–13
//   data row 2         cells 14–20
//   data row 3 (front) cells 21–27 → visual TOP row
// Rows are rendered top-down with data-row 3 first, so the frontline
// appears at the top of the heatmap, exactly like the player sees their
// own board in-game.
//
// Hex stagger: odd data-rows (1, 3) shift half a cell to the right —
// after flipping, this lands on visual rows 0 and 2 (top and middle),
// matching the in-game board silhouette.
//
// If the API returns hasData=false (no observations yet) the component
// renders nothing — empty state stays mute, no info text.

const ROWS = 4;
const COLS = 7;

interface CellShare { cell: number; observations: number; share: number }

interface Props {
  units: { characterId: string; count?: number | unknown }[];
  carryCharacterId?: string;
  clusterKey?: string;
  assets: TftAssetsBundle | null;
}

export default function PositionHeatmap({ units, carryCharacterId, clusterKey, assets }: Props) {
  const [data, setData] = useState<Record<string, CellShare[]>>({});
  const [hasData, setHasData] = useState<boolean>(false);
  const [source, setSource] = useState<'comp' | 'global'>('global');

  useEffect(() => {
    const ids = units.map(u => u.characterId).filter(Boolean);
    if (ids.length === 0) return;
    const qs = `units=${ids.join(',')}${clusterKey ? `&cluster=${encodeURIComponent(clusterKey)}` : ''}`;
    fetch(`/api/tft/positions/by-units?${qs}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return;
        setHasData(!!j.hasData);
        setData(j.units || {});
        setSource(j.source || 'global');
      })
      .catch(() => {});
  }, [units, clusterKey]);

  if (!hasData) return null;

  // Sort: carry first, then by count desc (already pre-sorted upstream)
  const ordered = [...units].sort((a, b) => {
    if (a.characterId === carryCharacterId) return -1;
    if (b.characterId === carryCharacterId) return 1;
    return 0;
  });

  return (
    <section className="mt-5 bg-[#0d1526] border border-[#1e2a3a] rounded p-4">
      <h2 className="text-[#a0b0c5] text-xs uppercase tracking-widest mb-3">
        Positionierung
        {source === 'global' && (
          <span className="text-[#5a6a80] text-[10px] normal-case tracking-normal ml-2">(global)</span>
        )}
      </h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {ordered.map(u => {
          const cells = data[u.characterId];
          if (!cells || cells.length === 0) return null;
          const ch = assets?.champions[u.characterId];
          const url = tftChampionTileUrl(assets, ch);
          const isCarry = u.characterId === carryCharacterId;
          // Build a quick lookup: cell-index → share
          const shareByCell = new Map<number, number>();
          for (const c of cells) shareByCell.set(c.cell, c.share);
          const maxShare = Math.max(...cells.map(c => c.share));

          return (
            <div key={u.characterId} className="bg-[#0a0e1a] border border-[#1e2a3a] rounded p-2.5">
              <div className="flex items-center gap-2 mb-2">
                {url && (
                  <img
                    src={url}
                    alt={ch?.name || ''}
                    className="w-8 h-8 rounded border-2 object-cover"
                    style={{ borderColor: isCarry ? '#c39bff' : '#1e2a3a' }}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-white text-xs font-medium truncate">{ch?.name || u.characterId}</div>
                  {isCarry && <div className="text-[#a892ff] text-[10px] uppercase tracking-widest">Carry</div>}
                </div>
              </div>
              <div className="flex flex-col gap-0.5">
                {Array.from({ length: ROWS }).map((_, visualRowIdx) => {
                  // Flip vertically so data-row 3 (frontline) renders at the
                  // visual top — player POV matches in-game board.
                  const dataRowIdx = ROWS - 1 - visualRowIdx;
                  return (
                  <div
                    key={visualRowIdx}
                    className="flex gap-0.5"
                    style={{ paddingLeft: dataRowIdx % 2 === 1 ? '8px' : '0' }}
                  >
                    {Array.from({ length: COLS }).map((__, colIdx) => {
                      const cellIdx = dataRowIdx * COLS + colIdx;
                      const share = shareByCell.get(cellIdx) ?? 0;
                      const intensity = maxShare > 0 ? share / maxShare : 0;
                      return (
                        <div
                          key={colIdx}
                          className="w-3 h-3 rounded-sm"
                          style={{
                            backgroundColor: intensity > 0
                              ? `rgba(195, 155, 255, ${0.15 + 0.7 * intensity})`
                              : '#10182a',
                            border: intensity > 0.7 ? '1px solid #c39bff' : '1px solid #1a2438',
                          }}
                          title={`Cell ${cellIdx} · ${(share * 100).toFixed(0)}%`}
                        />
                      );
                    })}
                  </div>
                );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

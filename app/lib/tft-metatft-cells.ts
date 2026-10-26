// Feld-Zahlen je Unit fuer den Comp-Builder, aus public/tft-metatft-cells-{set}.json.
//
// Die Datei baut scripts/refresh-metatft-cells.mjs aus MetaTFTs Positionsdaten
// (Gatter und Bedeutung der Felder: scripts/lib/metatft-cells.mjs). Muster wie
// tft-item-texts.ts: eigener Abruf, Ergebnis gecacht, bei jedem Fehler null —
// dann zeigt der Builder einfach keine Zahlen.

import { CURRENT_SET } from './current-set';

export interface CellStat {
  /** Anteil der Beobachtungen der Unit auf diesem Feld, Promille */
  freq: number;
  /** Top-4-Quote auf diesem Feld, Promille; null bei zu wenig Beobachtungen */
  top4: number | null;
}

export interface UnitCellStats {
  /** Feld (0-basiert, row*7+col, Reihe 0 hinten) → Werte */
  cells: Map<number, CellStat>;
  /** hoechste Haeufigkeit der Unit, Bezug fuer die Einfaerbung */
  maxFreq: number;
}

export type MetatftCells = Map<string, UnitCellStats>;

// Zielfarbe der Einfaerbung (MetaTFT-Builder: rgb(203,180,108)). Die Flaeche
// darunter bleibt --surface-sunken; eine Ebene in dieser Farbe mit der Deckkraft
// √(Anteil/Maximum) ergibt denselben Verlauf wie dort.
export const CELL_HEAT_COLOR = 'rgb(203, 180, 108)';

export function cellHeatOpacity(stat: CellStat, unit: UnitCellStats): number {
  return unit.maxFreq > 0 ? Math.sqrt(stat.freq / unit.maxFreq) : 0;
}

/** Promille → "37.9%" (eine Nachkommastelle wie MetaTFT) */
export function formatPermille(v: number): string {
  return `${(v / 10).toFixed(1)}%`;
}

let cached: Promise<MetatftCells | null> | null = null;

export function loadMetatftCells(): Promise<MetatftCells | null> {
  if (!cached) {
    cached = fetch(`/tft-metatft-cells-${CURRENT_SET}.json`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && Array.isArray(j.units) ? parseCells(j.units) : null))
      .catch(() => null);
  }
  return cached;
}

function parseCells(units: unknown[]): MetatftCells {
  const out: MetatftCells = new Map();
  for (const u of units as Array<{ id?: unknown; cells?: unknown }>) {
    if (typeof u?.id !== 'string' || !Array.isArray(u.cells)) continue;
    const cells = new Map<number, CellStat>();
    let maxFreq = 0;
    for (const c of u.cells as unknown[]) {
      if (!Array.isArray(c)) continue;
      const [cell, freq, top4] = c;
      if (typeof cell !== 'number' || !Number.isInteger(cell) || typeof freq !== 'number') continue;
      cells.set(cell, { freq, top4: typeof top4 === 'number' ? top4 : null });
      if (freq > maxFreq) maxFreq = freq;
    }
    if (cells.size) out.set(u.id, { cells, maxFreq });
  }
  return out;
}

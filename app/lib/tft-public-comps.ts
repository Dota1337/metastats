// Veroeffentlichte Comps (Tabelle tft_public_comps, Spalte board_config):
// Form einer Unit auf dem Brett und die Pruefung beim Speichern. Geteilt von
// der Speicher-Route (app/api/tft/comps/share/route.ts), der Galerie
// (app/tft/comps/community/page.tsx) und dem Comp-Builder (Stern-Level).
//
// board_config ist jsonb und wird von der RPC get_tft_public_comps unveraendert
// ausgeliefert (Migration 0064) — ein neues Feld braucht keine Migration.
// Eintraege von vor dem 18.10.2026 haben kein `star` und gelten als 1★.

import { BOARD_CELLS, MAX_ITEMS_PER_UNIT } from './tft-board';

// 1★ wird nicht gespeichert (wie im Teilen-Link des Builders).
export type StarLevel = 2 | 3 | 4;

export interface BoardPlacement {
  cell: number;
  characterId: string;
  items: string[];
  star?: StarLevel;
}

export function toStarLevel(v: unknown): StarLevel | undefined {
  return v === 2 || v === 3 || v === 4 ? v : undefined;
}

function cleanStr(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null;
  const safe = s.trim().replace(/[<>{}]/g, '').slice(0, max);
  return safe || null;
}

// Eingehendes Brett pruefen: gueltige Felder 0–27, jedes Feld nur einmal (das
// erste gewinnt), hoechstens 3 Items, Stern-Level nur 2–4. Obergrenze ist die
// Brettgroesse, nicht die Spielregel (Tactician-Items) — die steht nur im Builder.
export function sanitizePlacements(arr: unknown): BoardPlacement[] {
  if (!Array.isArray(arr)) return [];
  const out: BoardPlacement[] = [];
  const used = new Set<number>();
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const cell = Number((p as any).cell);
    const cid = cleanStr((p as any).characterId, 80);
    if (!Number.isInteger(cell) || cell < 0 || cell >= BOARD_CELLS || !cid || used.has(cell)) continue;
    const items = Array.isArray((p as any).items)
      ? (p as any).items
          .filter((x: unknown) => typeof x === 'string')
          .slice(0, MAX_ITEMS_PER_UNIT)
          .map((x: string) => x.slice(0, 80))
      : [];
    const entry: BoardPlacement = { cell, characterId: cid, items };
    const star = toStarLevel((p as any).star);
    if (star) entry.star = star;
    used.add(cell);
    out.push(entry);
    if (out.length >= BOARD_CELLS) break;
  }
  return out;
}

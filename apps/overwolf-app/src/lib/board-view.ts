// Spielfeld: 4 Reihen a 7 Felder, jede zweite Reihe versetzt wie im Spiel.
// Feld = Reihe * 7 + Spalte, Reihe 0 = hinterste Reihe (Zaehlung des Servers).
// Gezeichnet wird aus Sicht des Spielers: hinterste Reihe unten.
import type { CompanionLookups } from '../../../../app/lib/companion-types.ts';
import { h, itemIcon } from './dom.ts';

export interface BoardUnit { cell: number; unit: string; star?: number; items?: string[] }

const COST_CLASS = ['', 'c1', 'c2', 'c3', 'c4', 'c5'];

export function boardView(units: BoardUnit[], lk: CompanionLookups | null, size: 'md' | 'sm' = 'md'): HTMLElement {
  const byCell = new Map<number, BoardUnit>();
  for (const u of units) if (u.cell >= 0 && u.cell < 28 && !byCell.has(u.cell)) byCell.set(u.cell, u);
  const rows: HTMLElement[] = [];
  for (let row = 3; row >= 0; row--) {
    const cells: HTMLElement[] = [];
    for (let col = 0; col < 7; col++) {
      const u = byCell.get(row * 7 + col);
      if (!u) { cells.push(h('div', { class: 'cell' }, h('div', { class: 'hex empty' }))); continue; }
      const c = lk?.champions[u.unit];
      const name = c?.name || u.unit.replace(/^(?:TFT\d*|DA)_(?:\d+_)?/, '');
      cells.push(h('div', { class: 'cell', title: name },
        h('div', { class: `hex ${COST_CLASS[c?.cost ?? 0] || ''}` },
          h('div', { class: 'hex-in' },
            c?.icon ? h('img', { src: c.icon, alt: name, loading: 'lazy' }) : h('span', { class: 'unit-fallback' }, name.slice(0, 3)),
          ),
        ),
        u.star && u.star >= 2 ? h('span', { class: `stars s${Math.min(u.star, 3)}` }, '★'.repeat(Math.min(u.star, 3))) : null,
        u.items?.length ? h('div', { class: 'cell-items' }, u.items.slice(0, 3).map(it => itemIcon(it, lk, 'xs'))) : null,
      ));
    }
    // Im Spiel ist die hinterste Reihe nach rechts versetzt, dann im Wechsel.
    rows.push(h('div', { class: row % 2 === 0 ? 'board-row shift' : 'board-row' }, cells));
  }
  return h('div', { class: `board ${size}` }, rows);
}

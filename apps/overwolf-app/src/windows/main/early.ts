// Aufklapp-Bereich Early Game einer Comp (Comp-Liste und Detailansicht): die
// meistgespielten fruehen Boards je Spielerstufe 4-7 (ab 50 Spielen, ohne
// Felder). Die Stufen-Zeitpunkte stehen im Positioning, nicht doppelt hier.
import type { CompanionComp } from '../../../../../app/lib/companion-types.ts';
import { t, lang } from '../../lib/i18n.ts';
import { h, unitIcon, fmtAvg, levelTabs } from '../../lib/dom.ts';
import { shownLevels } from '../../lib/plan.ts';
import { lookups, slotFallback, rerender } from './ctx.ts';
import { compDetailSlot, detailSlotKey } from './comps.ts';

// Gewaehlte Stufe; springt beim Wechsel der Comp auf deren erste Stufe mit Boards.
const ui = { key: '', level: 0 };
const LEVELS = [4, 5, 6, 7];

export function earlyPanel(c: CompanionComp): HTMLElement {
  const lk = lookups();
  const slot = compDetailSlot(c);
  if (slot.state !== 'ok') return h('div', { class: 'comp-panel' }, slotFallback(detailSlotKey(c), slot));
  const d = slot.data;
  if (ui.key !== c.key) { ui.key = c.key; ui.level = 0; }
  const shown = shownLevels(LEVELS, l => !!d.early[String(l)]?.length);
  const level = shown.includes(ui.level) ? ui.level : shown[0] ?? LEVELS[0];
  // Beschwoerungen (nicht in lookups.champions) blendet die App aus.
  const boards = (d.early[String(level)] ?? [])
    .map(b => ({ ...b, units: b.units.filter(u => !lk || lk.champions[u]) }))
    .filter(b => b.units.length > 0);

  return h('div', { class: 'comp-panel' },
    shown.length ? levelTabs(shown, level, null, l => { ui.level = l; rerender(); }) : null,
    boards.length
      ? h('table', { class: 'table' },
        h('tr', {}, h('th', {}, t('early.boards')), h('th', {}, t('comps.avg')), h('th', {}, t('comps.games'))),
        boards.map(b => h('tr', {},
          h('td', {}, h('div', { class: 'units' }, b.units.map(u => unitIcon(u, lk, { size: 'sm' })))),
          h('td', {}, fmtAvg(b.avg)),
          h('td', {}, b.games.toLocaleString(lang())),
        )),
      )
      : h('div', { class: 'empty' }, '—'),
  );
}

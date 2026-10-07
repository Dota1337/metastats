// Reiter Early Game: fuer eine Comp die meistgespielten fruehen Boards je
// Spielerstufe 4-7 (ab 50 Spielen, ohne Felder) und wann die Stufen
// typischerweise erreicht werden.
import { read } from '../../lib/store.ts';
import { t, lang } from '../../lib/i18n.ts';
import { h, unitIcon, tierBadge, fmtAvg, levelTabs } from '../../lib/dom.ts';
import { shownLevels } from '../../lib/plan.ts';
import { nav, go, lookups, comps, slotFallback, rerender } from './ctx.ts';
import { compDetailSlot, detailSlotKey } from './comps.ts';

// Gewaehlte Stufe; springt beim Wechsel der Comp auf deren erste Stufe mit Boards.
const ui = { key: '', level: 0 };
const LEVELS = [4, 5, 6, 7];

export function earlyTab(): HTMLElement {
  const all = comps();
  const lk = lookups();
  const pin = read('ms.pin');
  // Ohne Wahl: die angeheftete Comp, sonst die erste mit fruehen Boards.
  const key = nav.earlyKey ?? (pin?.hasEarly ? pin.key : null) ?? all.find(x => x.hasEarly)?.key ?? all[0]?.key ?? null;
  const c = all.find(x => x.key === key) ?? null;

  const select = h('select', {}, all.map(x => h('option', { value: x.key, selected: x.key === key }, `${x.tier ?? '—'} · ${x.name}`)));
  select.addEventListener('change', () => go('early', { earlyKey: select.value }));

  if (!c) return h('section', { class: 'panel' }, all.length ? null : h('div', { class: 'spinner' }));
  const slot = compDetailSlot(c);
  const d = slot.state === 'ok' ? slot.data : null;
  if (ui.key !== c.key) { ui.key = c.key; ui.level = 0; }
  const shown = d ? shownLevels(LEVELS, l => !!d.early[String(l)]?.length) : [];
  const level = shown.includes(ui.level) ? ui.level : shown[0] ?? LEVELS[0];
  const boards = d?.early[String(level)] ?? [];

  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' },
      h('label', { class: 'setting' }, h('span', {}, t('early.pick')), select),
      tierBadge(c.tier),
      h('button', { class: 'btn ghost', onclick: () => go('comps', { compKey: c.key }) }, t('comps.details')),
    ),
    d ? h('div', { class: 'card' },
      shown.length ? levelTabs(shown, level, null, l => { ui.level = l; rerender(); }) : null,
      h('h3', {}, t('early.boards')),
      boards.length
        ? h('table', { class: 'table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, t('comps.avg')), h('th', {}, t('comps.games'))),
          boards.map(b => h('tr', {},
            h('td', {}, h('div', { class: 'units' }, b.units.filter(u => !lk || lk.champions[u]).map(u => unitIcon(u, lk, { size: 'sm' })))),
            h('td', {}, fmtAvg(b.avg)),
            h('td', {}, b.games.toLocaleString(lang())),
          )),
        )
        : h('div', { class: 'empty' }, t('common.noData')),
      d.levelTiming.length ? h('div', {},
        h('div', { class: 'recipe-group muted' }, t('comps.reach')),
        h('div', { class: 'timing' }, d.levelTiming.map(x => h('span', {}, `${t('tools.level')} ${x.level} · ${x.stage}`))),
      ) : null,
    ) : slotFallback(detailSlotKey(c), slot),
  );
}

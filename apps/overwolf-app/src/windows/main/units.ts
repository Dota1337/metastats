// Reiter Units: Liste mit Kosten-Filter, Suche und Sortierung; Detail mit
// besten Items, Item-Kombinationen und den Comps, in denen die Unit steht.
import type { CompanionUnitDetail, CompanionUnitsResponse } from '../../../../../app/lib/companion-types.ts';
import { t, lang } from '../../lib/i18n.ts';
import { loadUnit, loadUnits } from '../../lib/api.ts';
import { h, clear, unitIcon, itemIcon, tierBadge, fmtAvg, fmtPct } from '../../lib/dom.ts';
import { nav, go, lookups, comps, unitName, backBtn, fetchSlot, slotFallback, sortHead, rerender } from './ctx.ts';
import { statLine } from './comps.ts';

type SortKey = 'avg' | 'top4' | 'win' | 'games';
const ui = { query: '', cost: 0, sort: 'avg' as SortKey };

function sortRows<T extends { avg: number | null; top4: number | null; win: number | null; games: number }>(rows: T[], key: SortKey): T[] {
  // Platz: kleiner ist besser, alles andere: groesser ist besser.
  return [...rows].sort((a, b) => key === 'avg'
    ? (a.avg ?? 9) - (b.avg ?? 9)
    : ((b[key] ?? -1) as number) - ((a[key] ?? -1) as number));
}

function listView(): HTMLElement {
  const lk = lookups();
  const slot = fetchSlot<CompanionUnitsResponse>('units', loadUnits);
  if (slot.state !== 'ok') return h('section', { class: 'panel' }, slotFallback('units', slot));
  const onSort = (k: string) => { ui.sort = k as SortKey; rerender(); };
  const tbody = h('tbody', {});
  const fill = () => {
    const q = ui.query.trim().toLowerCase();
    const rows = slot.data.units.filter(u =>
      (ui.cost === 0 || lk?.champions[u.id]?.cost === ui.cost)
      && (!q || unitName(u.id, lk).toLowerCase().includes(q)));
    clear(tbody, sortRows(rows, ui.sort).map(u => h('tr', { class: 'click', onclick: () => go('units', { unitId: u.id }) },
      h('td', {}, h('div', { class: 'name-cell' }, unitIcon(u.id, lk, { size: 'sm' }), unitName(u.id, lk))),
      h('td', {}, fmtAvg(u.avg)), h('td', {}, fmtPct(u.top4)), h('td', {}, fmtPct(u.win)),
      h('td', {}, u.games.toLocaleString(lang())),
      h('td', {}, h('div', { class: 'recipes' }, u.items.slice(0, 3).map(it => itemIcon(it, lk, 'sm')))),
    )));
  };
  fill();
  const input = h('input', { class: 'search', type: 'search', 'data-keep': 'units', placeholder: t('units.search'), value: ui.query });
  input.addEventListener('input', () => { ui.query = input.value; fill(); });
  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' },
      input,
      h('div', { class: 'chips' }, [0, 1, 2, 3, 4, 5].map(c =>
        h('button', { class: c === ui.cost ? 'chip active' : `chip c${c}`, onclick: () => { ui.cost = c; rerender(); } }, c === 0 ? t('common.all') : `${c}`),
      )),
    ),
    h('div', { class: 'card' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', {}, t('units.unit')),
          sortHead(t('comps.avg'), 'avg', ui.sort, onSort),
          sortHead(t('comps.top4'), 'top4', ui.sort, onSort),
          sortHead(t('comps.win'), 'win', ui.sort, onSort),
          sortHead(t('comps.games'), 'games', ui.sort, onSort),
          h('th', {}, t('units.bestItems')),
        )),
        tbody,
      ),
    ),
  );
}

function detailView(id: string): HTMLElement {
  const lk = lookups();
  const key = `unit|${id}`;
  const slot = fetchSlot<CompanionUnitDetail>(key, () => loadUnit(id));
  const inComps = comps().filter(c => c.units.some(u => u.id === id)).slice(0, 12);
  const d = slot.state === 'ok' ? slot.data : null;
  return h('section', { class: 'panel' },
    h('div', { class: 'detail-head' },
      backBtn(() => go('units', { unitId: null })),
      unitIcon(id, lk, { size: 'md' }),
      h('div', { class: 'comp-name' }, unitName(id, lk)),
    ),
    d ? statLine(d) : slotFallback(key, slot),
    d ? h('div', { class: 'detail-grid' },
      d.items.length ? h('div', { class: 'card' },
        h('h3', {}, t('units.bestItems')),
        h('table', { class: 'table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, t('comps.avg')), h('th', {}, t('comps.top4')), h('th', {}, t('comps.games'))),
          d.items.slice(0, 10).map(it => h('tr', { class: 'click', onclick: () => go('items', { itemId: it.id }) },
            h('td', {}, h('div', { class: 'name-cell' }, itemIcon(it.id, lk, 'sm'), lk?.items[it.id]?.name || it.id)),
            h('td', {}, fmtAvg(it.avg)), h('td', {}, fmtPct(it.top4)), h('td', {}, it.games.toLocaleString(lang())),
          )),
        ),
      ) : null,
      d.itemSets.length ? h('div', { class: 'card' },
        h('h3', {}, t('units.itemSets')),
        h('table', { class: 'table' },
          h('tr', {}, h('th', {}, ''), h('th', {}, t('comps.avg')), h('th', {}, t('comps.top4')), h('th', {}, t('comps.games'))),
          d.itemSets.slice(0, 8).map(s => h('tr', {},
            h('td', {}, h('div', { class: 'recipes' }, s.items.map(it => itemIcon(it, lk, 'sm')))),
            h('td', {}, fmtAvg(s.avg)), h('td', {}, fmtPct(s.top4)), h('td', {}, s.games.toLocaleString(lang())),
          )),
        ),
      ) : null,
    ) : null,
    inComps.length ? h('div', { class: 'card' },
      h('h3', {}, t('units.inComps')),
      h('div', { class: 'mu-list' }, inComps.map(c => h('div', { class: 'mu', onclick: () => go('comps', { compKey: c.key }) },
        tierBadge(c.tier),
        h('span', { class: 'comp-name' }, c.name),
        h('span', { class: 'muted' }, `${fmtAvg(c.avg)} ${t('comps.avg')}`),
      ))),
    ) : null,
  );
}

export function unitsTab(): HTMLElement {
  return nav.unitId ? detailView(nav.unitId) : listView();
}

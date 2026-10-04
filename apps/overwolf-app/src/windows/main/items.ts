// Reiter Items: fertige Items, Embleme und besondere Items (Artefakte,
// strahlende Items, Traenke) mit Ergebnissen; dazu Rezepte und Shop-Chancen,
// die frueher im Reiter Werkzeuge standen.
import type { CompanionItemDetail, CompanionItemsResponse, CompanionLookups } from '../../../../../app/lib/companion-types.ts';
import { read } from '../../lib/store.ts';
import { t, lang } from '../../lib/i18n.ts';
import { loadItem, loadItems } from '../../lib/api.ts';
import { levelPlan, compRecipes, groupRecipes } from '../../lib/plan.ts';
import { h, clear, unitIcon, itemIcon, fmtAvg, fmtPct } from '../../lib/dom.ts';
import { nav, go, lookups, itemName, unitName, backBtn, fetchSlot, slotFallback, sortHead, rerender } from './ctx.ts';
import { recipeRow, statLine } from './comps.ts';

type Kind = 'finished' | 'emblem' | 'special' | 'recipes' | 'odds';
type SortKey = 'avg' | 'top4' | 'win' | 'games';
const ui = { kind: 'finished' as Kind, query: '', sort: 'avg' as SortKey, level: 7 };

// Einteilung nach den Spieldaten: Embleme tragen „Emblem" in der Kennung,
// fertige Items haben ein Rezept, alles andere ist besonders.
export function itemKind(id: string, lk: CompanionLookups | null): 'finished' | 'emblem' | 'special' | 'component' {
  const it = lk?.items[id];
  if (it?.component) return 'component';
  if (/Emblem/i.test(id)) return 'emblem';
  return it?.recipe ? 'finished' : 'special';
}

function listView(): HTMLElement {
  const lk = lookups();
  const slot = fetchSlot<CompanionItemsResponse>('items', loadItems);
  if (slot.state !== 'ok') return h('div', {}, slotFallback('items', slot));
  const onSort = (k: string) => { ui.sort = k as SortKey; rerender(); };
  const tbody = h('tbody', {});
  const fill = () => {
    const q = ui.query.trim().toLowerCase();
    const rows = slot.data.items
      .filter(i => itemKind(i.id, lk) === ui.kind && (!q || itemName(i.id, lk).toLowerCase().includes(q)))
      .sort((a, b) => ui.sort === 'avg' ? (a.avg ?? 9) - (b.avg ?? 9) : ((b[ui.sort] ?? -1) as number) - ((a[ui.sort] ?? -1) as number));
    clear(tbody, rows.map(i => h('tr', { class: 'click', onclick: () => go('items', { itemId: i.id }) },
      h('td', {}, h('div', { class: 'name-cell' }, itemIcon(i.id, lk, 'md'), itemName(i.id, lk))),
      h('td', {}, fmtAvg(i.avg)), h('td', {}, fmtPct(i.top4)), h('td', {}, fmtPct(i.win)),
      h('td', {}, i.games.toLocaleString(lang())),
      h('td', {}, h('div', { class: 'recipes' }, i.users.slice(0, 4).map(u => unitIcon(u, lk, { size: 'sm' })))),
    )));
  };
  fill();
  const input = h('input', { class: 'search', type: 'search', placeholder: t('items.search'), value: ui.query });
  input.addEventListener('input', () => { ui.query = input.value; fill(); });
  return h('div', { class: 'panel' },
    h('div', { class: 'toolbar' }, input),
    h('div', { class: 'card' },
      h('table', { class: 'table' },
        h('thead', {}, h('tr', {},
          h('th', {}, ''),
          sortHead(t('comps.avg'), 'avg', ui.sort, onSort),
          sortHead(t('comps.top4'), 'top4', ui.sort, onSort),
          sortHead(t('comps.win'), 'win', ui.sort, onSort),
          sortHead(t('comps.games'), 'games', ui.sort, onSort),
          h('th', {}, t('items.bestUsers')),
        )),
        tbody,
      ),
    ),
  );
}

function recipesView(): HTMLElement {
  const lk = lookups();
  const pin = read('ms.pin');
  const own = pin ? compRecipes(pin, lk) : [];
  return h('div', { class: 'panel' },
    pin && own.length ? h('div', { class: 'card' },
      h('h3', {}, t('tools.recipes'), ' · ', pin.name),
      h('div', { class: 'recipes' }, own.map(r => recipeRow(r.item, r.parts, lk))),
    ) : null,
    h('div', { class: 'card' },
      groupRecipes(lk).flatMap(g => [
        h('div', { class: 'recipe-group muted' }, t(`recipes.${g.kind}`)),
        h('div', { class: 'recipes grid' }, g.recipes.map(r => recipeRow(r.item, r.parts, lk))),
      ]),
    ),
  );
}

function oddsView(): HTMLElement {
  const lk = lookups();
  const pin = read('ms.pin');
  const levels = Object.keys(lk?.shopOdds ?? {}).map(Number).sort((a, b) => a - b);
  const odds = lk?.shopOdds[ui.level];
  const plan = pin ? levelPlan(pin, lk) : null;
  return h('div', { class: 'card' },
    h('div', { class: 'level-pick' }, levels.map(l =>
      h('button', { class: l === ui.level ? 'chip active' : 'chip', onclick: () => { ui.level = l; rerender(); } }, String(l)),
    )),
    odds ? h('table', { class: 'odds' },
      h('tr', {}, h('th', {}, t('tools.cost')), [1, 2, 3, 4, 5].map(c => h('th', { class: `c${c}` }, String(c)))),
      h('tr', {}, h('th', {}, t('tools.odds')), odds.map((p, i) => h('td', { class: `c${i + 1}` }, `${p}%`))),
      h('tr', {}, h('th', {}, t('tools.copies')), [1, 2, 3, 4, 5].map(c => h('td', {}, lk?.bagSize[c] != null ? String(lk.bagSize[c]) : '—'))),
    ) : null,
    plan && pin ? h('p', { class: 'plan', style: 'margin-top:12px' },
      pin.name, ': ', plan.kind === 'reroll' ? t('plan.reroll', { n: plan.level }) : t(`plan.${plan.kind}`),
    ) : null,
  );
}

function detailView(id: string): HTMLElement {
  const lk = lookups();
  const key = `item|${id}`;
  const slot = fetchSlot<CompanionItemDetail>(key, () => loadItem(id));
  const d = slot.state === 'ok' ? slot.data : null;
  const recipe = lk?.items[id]?.recipe;
  return h('section', { class: 'panel' },
    h('div', { class: 'detail-head' },
      backBtn(() => go('items', { itemId: null })),
      itemIcon(id, lk, 'md'),
      h('div', { class: 'comp-name' }, itemName(id, lk)),
    ),
    d ? statLine(d) : slotFallback(key, slot),
    recipe ? h('div', { class: 'card' }, h('h3', {}, t('items.recipe')), recipeRow(id, recipe, lk)) : null,
    d?.users.length ? h('div', { class: 'card' },
      h('h3', {}, t('items.bestUsers')),
      h('table', { class: 'table' },
        h('tr', {}, h('th', {}, ''), h('th', {}, t('comps.avg')), h('th', {}, t('comps.top4')), h('th', {}, t('comps.games'))),
        d.users.slice(0, 12).map(u => h('tr', { class: 'click', onclick: () => go('units', { unitId: u.id }) },
          h('td', {}, h('div', { class: 'name-cell' }, unitIcon(u.id, lk, { size: 'sm' }), unitName(u.id, lk))),
          h('td', {}, fmtAvg(u.avg)), h('td', {}, fmtPct(u.top4)), h('td', {}, u.games.toLocaleString(lang())),
        )),
      ),
    ) : null,
  );
}

export function itemsTab(): HTMLElement {
  if (nav.itemId) return detailView(nav.itemId);
  const kinds: Array<[Kind, string]> = [
    ['finished', t('items.finished')], ['emblem', t('items.emblem')], ['special', t('items.special')],
    ['recipes', t('tools.recipes')], ['odds', t('tools.odds')],
  ];
  return h('section', { class: 'panel' },
    h('div', { class: 'chips' }, kinds.map(([k, label]) =>
      h('button', { class: k === ui.kind ? 'chip active' : 'chip', onclick: () => { ui.kind = k; rerender(); } }, label),
    )),
    ui.kind === 'recipes' ? recipesView() : ui.kind === 'odds' ? oddsView() : listView(),
  );
}

// Reiter Comps: Liste wie bisher, Klick oeffnet die Detailansicht mit
// Aufstellung, Items je Traeger, Stufenplan und Matchups.
import type { CompanionComp, CompanionCompDetail, CompanionLookups } from '../../../../../app/lib/companion-types.ts';
import { read, write } from '../../lib/store.ts';
import { t, lang } from '../../lib/i18n.ts';
import { loadCompDetail, siteUrl } from '../../lib/api.ts';
import { openExternal } from '../../lib/ow.ts';
import { levelPlan } from '../../lib/plan.ts';
import { boardView } from '../../lib/board-view.ts';
import { h, clear, unitIcon, itemIcon, tierBadge, fmtAvg, fmtPct, compUnits } from '../../lib/dom.ts';
import { nav, go, lookups, comps, backBtn, fetchSlot, slotFallback, itemName } from './ctx.ts';

export const listState = { query: '', loadFailed: false, retry: () => {} };

export function recipeRow(item: string, parts: [string, string], lk: CompanionLookups | null, size: 'sm' | 'xs' = 'sm'): HTMLElement {
  return h('div', { class: 'recipe', title: itemName(item, lk) },
    itemIcon(parts[0], lk, size), h('span', { class: 'op' }, '+'), itemIcon(parts[1], lk, size),
    h('span', { class: 'op' }, '='), itemIcon(item, lk, size === 'xs' ? 'sm' : 'md'),
  );
}

export function statLine(s: { avg: number | null; top4: number | null; win: number | null; games: number }): HTMLElement {
  return h('div', { class: 'stat-line' },
    h('span', {}, h('b', {}, fmtAvg(s.avg)), ' ', t('comps.avg')),
    h('span', {}, h('b', {}, fmtPct(s.top4)), ' ', t('comps.top4')),
    h('span', {}, h('b', {}, fmtPct(s.win)), ' ', t('comps.win')),
    h('span', {}, h('b', {}, s.games.toLocaleString(lang())), ' ', t('comps.games')),
  );
}

function pinBtn(c: CompanionComp, pinnedKey: string | null): HTMLElement {
  const pinned = c.key === pinnedKey;
  return h('button', { class: pinned ? 'btn primary' : 'btn', onclick: () => write('ms.pin', pinned ? null : c) }, pinned ? t('comps.unpin') : t('comps.pin'));
}

function compRow(c: CompanionComp, lk: CompanionLookups | null, pinnedKey: string | null): HTMLElement {
  return h('article', { class: c.key === pinnedKey ? 'comp pinned' : 'comp' },
    h('div', { class: 'comp-head' },
      tierBadge(c.tier),
      h('div', { class: 'comp-name' }, c.name),
      h('div', { class: 'comp-stats' },
        h('span', {}, h('b', {}, fmtAvg(c.avg)), ' ', t('comps.avg')),
        h('span', {}, h('b', {}, fmtPct(c.top4)), ' ', t('comps.top4')),
        h('span', {}, h('b', {}, fmtPct(c.win)), ' ', t('comps.win')),
        h('span', { class: 'muted' }, c.games.toLocaleString(lang()), ' ', t('comps.games')),
      ),
      h('div', { class: 'comp-actions' },
        h('button', { class: 'btn', onclick: () => go('comps', { compKey: c.key }) }, t('comps.details')),
        pinBtn(c, pinnedKey),
      ),
    ),
    compUnits(c, lk),
  );
}

function listView(): HTMLElement {
  const all = comps();
  const lk = lookups();
  const pin = read('ms.pin');
  const input = h('input', { class: 'search', type: 'search', placeholder: t('comps.search'), value: listState.query });
  const renderList = () => {
    const q = listState.query.trim().toLowerCase();
    const l = q
      ? all.filter(c => c.name.toLowerCase().includes(q)
        || c.units.some(u => (lk?.champions[u.id]?.name || u.id).toLowerCase().includes(q)))
      : all;
    return l.map(c => compRow(c, lk, pin?.key ?? null));
  };
  input.addEventListener('input', () => {
    listState.query = input.value;
    const body = document.getElementById('comp-list');
    if (body) clear(body, renderList());
  });
  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' }, input),
    all.length === 0
      ? listState.loadFailed
        ? h('div', { class: 'empty' }, t('common.offline'), ' ', h('button', { class: 'btn', onclick: () => listState.retry() }, t('common.retry')))
        : h('div', { class: 'spinner' })
      : null,
    h('div', { id: 'comp-list', class: 'comp-list' }, renderList()),
  );
}

export function detailSlotKey(c: CompanionComp): string {
  return `comp|${read('ms.settings').region}|${c.slug}`;
}

export function compDetailSlot(c: CompanionComp) {
  return fetchSlot<CompanionCompDetail>(detailSlotKey(c), () => loadCompDetail(c.slug, c.units.map(u => u.id)));
}

// Aufstellung mit den Items und 3-Sternen der Comp-Liste; ohne Felder vom
// Server die schlichte Unit-Reihe.
export function compBoard(c: CompanionComp, d: CompanionCompDetail | null, lk: CompanionLookups | null, size: 'md' | 'sm' = 'md'): HTMLElement {
  if (!d || d.board.length === 0) return compUnits(c, lk, size);
  const byId = new Map(c.units.map(u => [u.id, u]));
  return boardView(d.board.map(b => ({
    cell: b.cell, unit: b.unit,
    star: byId.get(b.unit)?.star3 ? 3 : undefined,
    items: byId.get(b.unit)?.items,
  })), lk, size);
}

function matchupList(c: CompanionComp, strong: boolean, lk: CompanionLookups | null): HTMLElement | null {
  const byKey = new Map(comps().map(x => [x.key, x]));
  const rows = Object.entries(c.vs ?? {})
    .filter(([k, v]) => byKey.has(k) && k !== c.key && (strong ? v[1] > 0.5 : v[1] < 0.5))
    .sort((a, b) => strong ? b[1][1] - a[1][1] : a[1][1] - b[1][1])
    .slice(0, 5);
  if (rows.length === 0) return null;
  return h('div', { class: 'mu-list' },
    h('div', { class: 'recipe-group muted' }, strong ? t('comps.strongVs') : t('comps.weakVs')),
    rows.map(([k, [games, ahead]]) => {
      const o = byKey.get(k)!;
      const face = o.carries[0] ?? o.units[0]?.id;
      return h('div', { class: 'mu', onclick: () => go('comps', { compKey: o.key }) },
        face ? unitIcon(face, lk, { size: 'sm' }) : null,
        tierBadge(o.tier),
        h('span', { class: 'comp-name' }, o.name),
        h('span', { class: strong ? 'good' : 'bad' }, t('comps.ahead', { n: Math.round(ahead * 100) })),
        h('span', { class: 'muted' }, games.toLocaleString(lang()), ' ', t('comps.games')),
      );
    }),
  );
}

function detailView(c: CompanionComp): HTMLElement {
  const lk = lookups();
  const pin = read('ms.pin');
  const slot = compDetailSlot(c);
  const d = slot.state === 'ok' ? slot.data : null;
  const plan = levelPlan(c, lk);
  const carriers = c.units.filter(u => u.items?.length);
  const strong = matchupList(c, true, lk);
  const weak = matchupList(c, false, lk);

  return h('section', { class: 'panel' },
    h('div', { class: 'detail-head' },
      backBtn(() => go('comps', { compKey: null })),
      tierBadge(c.tier),
      h('div', { class: 'comp-name' }, c.name),
      pinBtn(c, pin?.key ?? null),
      h('button', { class: 'btn ghost', onclick: () => go('early', { earlyKey: c.key }) }, t('tab.early')),
      h('button', { class: 'btn ghost', onclick: () => openExternal(siteUrl(`/tft/comps/${encodeURIComponent(c.slug)}`)) }, t('comps.open')),
    ),
    statLine(c),
    h('div', { class: 'detail-grid' },
      h('div', { class: 'card' },
        h('h3', {}, t('comps.board')),
        slot.state === 'loading' ? h('div', { class: 'spinner' }) : compBoard(c, d, lk),
      ),
      carriers.length ? h('div', { class: 'card' },
        h('h3', {}, t('comps.carriers')),
        carriers.map(u => h('div', { class: 'carrier' },
          unitIcon(u.id, lk, { star3: !!u.star3, size: 'md' }),
          h('div', { class: 'recipes' }, (u.items ?? []).map(it => {
            const r = lk?.items[it]?.recipe;
            return r ? recipeRow(it, r, lk, 'xs') : itemIcon(it, lk, 'md');
          })),
        )),
      ) : null,
    ),
    h('div', { class: 'detail-grid' },
      h('div', { class: 'card' },
        h('h3', {}, t('tools.levelPlan')),
        h('p', { class: 'plan' },
          plan.kind === 'reroll' ? t('plan.reroll', { n: plan.level }) : t(`plan.${plan.kind}`),
          plan.avgLevel != null ? h('span', { class: 'muted' }, ` · ${t('plan.avgLevel')} ${plan.avgLevel.toFixed(1)}`) : null,
        ),
        plan.kind === 'reroll'
          ? h('div', { class: 'plan-targets' }, h('span', { class: 'muted' }, t('plan.threeStar')), plan.targets.map(id => unitIcon(id, lk, { star3: true, size: 'sm' })))
          : null,
        d?.levelTiming.length ? h('div', {},
          h('div', { class: 'recipe-group muted' }, t('comps.reach')),
          h('div', { class: 'timing' }, d.levelTiming.map(x => h('span', {}, `${t('tools.level')} ${x.level} · ${x.stage}`))),
        ) : null,
        d?.levels.length ? h('div', {},
          h('div', { class: 'recipe-group muted' }, t('comps.endLevel')),
          h('table', { class: 'table' },
            h('tr', {}, h('th', {}, t('tools.level')), h('th', {}, t('comps.share')), h('th', {}, t('comps.avg')), h('th', {}, t('comps.top4')), h('th', {}, t('comps.games'))),
            d.levels.map(l => h('tr', {},
              h('td', {}, String(l.level)), h('td', {}, fmtPct(l.share)), h('td', {}, fmtAvg(l.avg)), h('td', {}, fmtPct(l.top4)),
              h('td', {}, l.games.toLocaleString(lang())),
            )),
          ),
        ) : null,
      ),
      strong || weak ? h('div', { class: 'card' }, h('h3', {}, t('comps.matchups')), strong, weak) : null,
    ),
    slot.state === 'error' ? slotFallback(detailSlotKey(c), slot) : null,
  );
}

export function compsTab(): HTMLElement {
  const c = nav.compKey ? comps().find(x => x.key === nav.compKey) : null;
  return c ? detailView(c) : listView();
}

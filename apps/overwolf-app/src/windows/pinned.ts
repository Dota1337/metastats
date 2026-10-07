// Overlay der angehefteten Comp: Aufstellung je Spielerstufe (Umschalter),
// Rezepte, Shop-Chancen auf der aktuellen Stufe und Stufenplan. Ohne
// angeheftete Comp bleibt es leer (das Hintergrundfenster blendet es dann
// aus). Liest nur aus dem gemeinsamen Speicher.
import '../styles/app.css';
import { read, write, subscribe, patchSettings } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { makeDraggable, fitSelf } from '../lib/ow.ts';
import { levelPlan, boardLevels, startLevel, shownLevels, compRecipes } from '../lib/plan.ts';
import { h, clear, unitIcon, itemIcon, compUnits, tierBadge, levelTabs } from '../lib/dom.ts';
import { boardView } from '../lib/board-view.ts';

const root = document.getElementById('app')!;
const WIDTH = 340;

// Fensterhoehe folgt dem Inhalt, damit unter dem Overlay nichts Klicks schluckt.
function fit(): void {
  const el = root.firstElementChild as HTMLElement | null;
  if (el) fitSelf(WIDTH, el.getBoundingClientRect().bottom + 2);
}

function collapseBtn(collapsed: boolean): HTMLElement {
  return h('button', { class: 'win-btn', onclick: () => patchSettings({ collapsed: !collapsed }) }, collapsed ? '▾' : '▴');
}

// Gewaehlte Stufe der Aufstellung; springt beim Wechsel der Comp auf deren Start-Stufe.
const ui = { key: '', level: 0 };

function render(): void {
  const pin = read('ms.pin');
  const lk = read('ms.lookups')?.data ?? null;
  const live = read('ms.live');
  const collapsed = read('ms.settings').collapsed;
  if (!pin) { clear(root); fit(); return; }

  const head = h('header', { class: 'ov-head' },
    tierBadge(pin.tier),
    h('div', { class: 'ov-title' }, pin.name),
    collapseBtn(collapsed),
    h('button', { class: 'win-btn close', onclick: () => write('ms.pin', null) }, '×'),
  );
  makeDraggable(head);
  if (collapsed) { clear(root, h('div', { class: 'overlay' }, head)); fit(); return; }

  const plan = levelPlan(pin, lk);
  const recipes = compRecipes(pin, lk);
  const odds = live.level != null ? lk?.shopOdds[live.level] : undefined;
  // Aufstellung und fruehes Board laedt das Hintergrundfenster; ohne sie
  // bleibt es bei der Unit-Reihe.
  const pd = read('ms.pinDetail');
  const detail = pd && pd.key === pin.key ? pd.data : null;
  const byId = new Map(pin.units.map(u => [u.id, u]));
  const { levels, start } = boardLevels(plan);
  // ui.level 0 = noch nicht gewaehlt; dann die erste Stufe mit Brett ab der Startstufe.
  if (ui.key !== pin.key) { ui.key = pin.key; ui.level = 0; }
  const hasLevel = (l: number) => !!detail?.boardsByPlayerLevel?.[String(l)]?.length;
  const shown = shownLevels(levels, hasLevel);
  const level = shown.includes(ui.level) ? ui.level : startLevel(shown, start, hasLevel);
  // Ohne Brett fuer die Stufe (zu wenig Spiele oder alter Stand): die Gesamt-Aufstellung.
  const board = detail?.boardsByPlayerLevel?.[String(level)] ?? detail?.board ?? [];
  const early = live.level != null && live.level >= 4 && live.level <= 7 ? detail?.early[String(live.level)]?.[0] : undefined;

  clear(root, h('div', { class: 'overlay' },
    head,
    detail && board.length
      ? h('div', {},
        shown.length
          ? levelTabs(shown, level, l => detail.levels.find(x => x.level === l)?.share, l => { ui.level = l; render(); })
          : h('div', { class: 'ov-label' }, t('overlay.target')),
        boardView(board.map(b => ({ cell: b.cell, unit: b.unit, star: byId.get(b.unit)?.star3 ? 3 : undefined, items: byId.get(b.unit)?.items })), lk, 'sm'),
      )
      : compUnits(pin, lk, 'sm'),
    early ? h('div', { class: 'ov-row' },
      h('span', { class: 'ov-label' }, `${t('tab.early')} · ${t('tools.level')} ${live.level}`),
      h('span', { class: 'units' }, early.units.filter(u => !lk || lk.champions[u]).map(u => unitIcon(u, lk, { size: 'sm' }))),
    ) : null,
    h('div', { class: 'ov-row' },
      h('span', { class: 'ov-label' }, t('tools.levelPlan')),
      h('span', {}, plan.kind === 'reroll' ? t('plan.reroll', { n: plan.level }) : t(`plan.${plan.kind}`)),
      plan.kind === 'reroll' ? h('span', { class: 'plan-targets' }, plan.targets.map(id => unitIcon(id, lk, { star3: true, size: 'sm' }))) : null,
    ),
    odds ? h('div', { class: 'ov-row' },
      h('span', { class: 'ov-label' }, `${t('tools.level')} ${live.level}`),
      h('span', { class: 'odds-inline' }, odds.map((p, i) => h('span', { class: `c${i + 1}` }, `${p}%`))),
    ) : null,
    recipes.length ? h('div', { class: 'recipes compact' }, recipes.map(r =>
      h('div', { class: 'recipe', title: lk?.items[r.item]?.name || r.item },
        itemIcon(r.parts[0], lk, 'xs'), h('span', { class: 'op' }, '+'), itemIcon(r.parts[1], lk, 'xs'),
        h('span', { class: 'op' }, '='), itemIcon(r.item, lk, 'sm'),
      ),
    )) : null,
  ));
  fit();
}

void boot(render);
subscribe(['ms.pin', 'ms.pinDetail', 'ms.lookups', 'ms.live', 'ms.settings'], key => {
  // Shop-Wechsel aendern hier nichts; nur die Stufe zaehlt.
  if (key === 'ms.live') {
    const l = read('ms.live').level;
    if (l === lastLevel) return;
    lastLevel = l;
  }
  if (key === 'ms.settings') {
    const c = read('ms.settings').collapsed;
    if (c === lastCollapsed) return;
    lastCollapsed = c;
  }
  render();
});
let lastLevel = read('ms.live').level;
let lastCollapsed = read('ms.settings').collapsed;

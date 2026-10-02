// Overlay der angehefteten Comp: Units mit Items, Rezepte, Shop-Chancen auf der
// aktuellen Stufe und Stufenplan. Liest nur aus dem gemeinsamen Speicher.
import '../styles/app.css';
import { read, write, subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { makeDraggable } from '../lib/ow.ts';
import { levelPlan, compRecipes } from '../lib/plan.ts';
import { h, clear, unitIcon, itemIcon, compUnits, tierBadge } from '../lib/dom.ts';

const root = document.getElementById('app')!;
let collapsed = false;

function render(): void {
  const pin = read('ms.pin');
  const lk = read('ms.lookups')?.data ?? null;
  const live = read('ms.live');
  if (!pin) { clear(root); return; }

  const head = h('header', { class: 'ov-head' },
    tierBadge(pin.tier),
    h('div', { class: 'ov-title' }, pin.name),
    h('button', { class: 'win-btn', onclick: () => { collapsed = !collapsed; render(); } }, collapsed ? '▾' : '▴'),
    h('button', { class: 'win-btn close', onclick: () => write('ms.pin', null) }, '×'),
  );
  makeDraggable(head);
  if (collapsed) { clear(root, h('div', { class: 'overlay' }, head)); return; }

  const plan = levelPlan(pin, lk);
  const recipes = compRecipes(pin, lk);
  const odds = live.level != null ? lk?.shopOdds[live.level] : undefined;

  clear(root, h('div', { class: 'overlay' },
    head,
    compUnits(pin, lk, 'sm'),
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
}

void boot(render);
subscribe(['ms.pin', 'ms.lookups', 'ms.live'], key => {
  // Shop-Wechsel aendern hier nichts; nur bei Stufenwechsel neu zeichnen.
  if (key === 'ms.live') {
    const lvl = read('ms.live').level;
    if (lvl === lastLevel) return;
    lastLevel = lvl;
  }
  render();
});
let lastLevel = read('ms.live').level;

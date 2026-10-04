// Hauptfenster (Alt+D): Kopfleiste mit Reitern, der Inhalt kommt aus den
// Reiter-Modulen unter ./main/.
import '../styles/app.css';
import { subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { loadComps, loadLookups } from '../lib/api.ts';
import { makeDraggable, minimizeSelf, closeSelf } from '../lib/ow.ts';
import { h, clear } from '../lib/dom.ts';
import { nav, TABS, setRender, go } from './main/ctx.ts';
import { compsTab, listState } from './main/comps.ts';
import { unitsTab } from './main/units.ts';
import { itemsTab } from './main/items.ts';
import { earlyTab } from './main/early.ts';
import { historyTab } from './main/history.ts';
import { settingsTab } from './main/settings.ts';

const root = document.getElementById('app')!;

function header(): HTMLElement {
  const bar = h('header', { class: 'titlebar' },
    h('div', { class: 'brand' }, h('img', { src: '../images/IconMouseOver.png', alt: '' }), 'metastats.gg'),
    h('nav', { class: 'tabs' }, TABS.map(tab =>
      // Ein Klick auf den aktiven Reiter fuehrt zurueck zur Liste.
      h('button', { class: tab === nav.tab ? 'tab active' : 'tab', onclick: () => go(tab, { compKey: null, unitId: null, itemId: null }) }, t(`tab.${tab}`)),
    )),
    h('div', { class: 'win-buttons' },
      h('button', { class: 'win-btn', 'aria-label': '—', onclick: minimizeSelf }, '–'),
      h('button', { class: 'win-btn close', 'aria-label': '×', onclick: closeSelf }, '×'),
    ),
  );
  makeDraggable(bar);
  return bar;
}

function render(): void {
  const body = nav.tab === 'comps' ? compsTab()
    : nav.tab === 'units' ? unitsTab()
      : nav.tab === 'items' ? itemsTab()
        : nav.tab === 'early' ? earlyTab()
          : nav.tab === 'history' ? historyTab()
            : settingsTab();
  // Scroll-Stand halten, wenn nur nachgeladene Daten neu gezeichnet werden.
  const top = document.querySelector('.content')?.scrollTop ?? 0;
  clear(root, header(), h('main', { class: 'content' }, body));
  document.querySelector('.content')?.scrollTo(0, top);
}

async function refresh(force = false): Promise<void> {
  const [comps] = await Promise.all([loadComps(force), loadLookups(force)]);
  listState.loadFailed = !comps;
  render();
}

listState.retry = () => void refresh(true);
setRender(render);
void boot(render).then(() => refresh());
subscribe(['ms.comps', 'ms.lookups', 'ms.pin', 'ms.settings', 'ms.me'], key => {
  // Beim Aendern der Einstellungen nicht die Auswahlfelder neu bauen.
  if (key === 'ms.settings' && nav.tab === 'settings') return;
  render();
});

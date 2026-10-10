// Hauptfenster: Seitenleiste mit Reitern links, Inhalt in der Mitte, rechts die
// Live-Spalte mit dem eigenen Profil. Die Reiter-Inhalte kommen aus ./main/.
//
// Dasselbe Fenster laeuft als main_overlay ueber dem Spiel (ein Bildschirm,
// Alt+D). Dort laedt es nie selbst: ms.comps/ms.lookups haelt das
// Hintergrundfenster aktuell, „Erneut laden“ fragt es per Nachricht.
import '../styles/app.css';
import { read, subscribe } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { loadComps, loadLookups } from '../lib/api.ts';
import { makeDraggable, minimizeSelf, closeSelf, toggleMaximizeSelf, tellBackground } from '../lib/ow.ts';
import { h, clear } from '../lib/dom.ts';
import { nav, TABS, IS_OVERLAY, setRender, go, type Tab } from './main/ctx.ts';
import { compsTab, listState } from './main/comps.ts';
import { unitsTab } from './main/units.ts';
import { itemsTab } from './main/items.ts';
import { earlyTab } from './main/early.ts';
import { historyTab, openPlayer } from './main/history.ts';
import { settingsTab } from './main/settings.ts';
import { ingameTab } from './main/ingame.ts';
import { liveColumn } from './main/live.ts';

const root = document.getElementById('app')!;

function header(): HTMLElement {
  const bar = h('header', { class: 'titlebar' },
    h('div', { class: 'brand' }, h('img', { src: '../images/IconMouseOver.png', alt: '' }), 'metastats.gg'),
    h('div', { class: 'titlebar-fill' }),
    h('div', { class: 'win-buttons' },
      IS_OVERLAY ? null : h('button', { class: 'win-btn', 'aria-label': '–', onclick: minimizeSelf }, '–'),
      IS_OVERLAY ? null : h('button', { class: 'win-btn', 'aria-label': '□', onclick: toggleMaximizeSelf }, '□'),
      h('button', { class: 'win-btn close', 'aria-label': '×', onclick: closeSelf }, '×'),
    ),
  );
  makeDraggable(bar);
  return bar;
}

const inGame = () => read('ms.live').inTft;

function sidebar(): HTMLElement {
  const btn = (tab: Tab) =>
    // Ein Klick auf den aktiven Reiter fuehrt zurueck zur Liste.
    h('button', { class: tab === nav.tab ? 'side-tab active' : 'side-tab', onclick: () => go(tab, { compKey: null, unitId: null, itemId: null }) },
      tab === 'ingame' ? h('span', { class: 'live-dot' }) : null, t(`tab.${tab}`));
  const tabs = TABS.filter(tab => tab !== 'settings' && (tab !== 'ingame' || inGame()));
  return h('nav', { class: 'sidebar' }, tabs.map(btn), h('div', { class: 'sidebar-fill' }), btn('settings'));
}

const openFromLive = (name: string) => { go('history'); void openPlayer(name); };

function render(): void {
  if (nav.tab === 'ingame' && !inGame()) nav.tab = 'comps';
  const body = nav.tab === 'ingame' ? ingameTab()
    : nav.tab === 'comps' ? compsTab()
      : nav.tab === 'units' ? unitsTab()
        : nav.tab === 'items' ? itemsTab()
          : nav.tab === 'early' ? earlyTab()
            : nav.tab === 'history' ? historyTab()
              : settingsTab();
  // Scroll-Stand halten, wenn nur nachgeladene Daten neu gezeichnet werden.
  const top = document.querySelector('.content')?.scrollTop ?? 0;
  // Ebenso Fokus und Cursor eines Suchfelds (data-keep), falls Daten waehrend
  // des Tippens ankommen.
  const active = document.activeElement instanceof HTMLInputElement ? document.activeElement : null;
  const keep = active?.dataset.keep;
  const sel = active && keep ? [active.selectionStart, active.selectionEnd] as const : null;
  clear(root, header(), h('div', { class: 'shell' },
    sidebar(),
    h('main', { class: 'content' }, body),
    liveColumn(openFromLive),
  ));
  document.querySelector('.content')?.scrollTo(0, top);
  if (keep) {
    const el = root.querySelector<HTMLInputElement>(`input[data-keep="${keep}"]`);
    el?.focus();
    if (el && sel?.[0] != null) el.setSelectionRange(sel[0], sel[1] ?? sel[0]);
  }
}

// Nur die Live-Spalte tauschen (sie allein zeigt das Profil); der Inhalt mit
// Eingaben und offenen Auswahlfeldern bleibt stehen.
function swapLive(): void {
  const old = root.querySelector('.live-col');
  const next = liveColumn(openFromLive);
  if (old && next) old.replaceWith(next);
  else if (old) old.remove();
  else if (next) root.querySelector('.shell')?.append(next);
}

async function refresh(force = false): Promise<void> {
  if (IS_OVERLAY) {
    if (force) tellBackground('refresh');
    listState.loadFailed = !read('ms.comps');
    render();
    return;
  }
  const [comps] = await Promise.all([loadComps(force), loadLookups(force)]);
  listState.loadFailed = !comps;
  render();
}

// Beginnt eine Partie, springt das Fenster einmal auf „Im Spiel“; endet sie,
// zurueck zu den Comps.
let wasInGame = inGame();
function onLive(): void {
  const now = inGame();
  if (now !== wasInGame) {
    wasInGame = now;
    if (now) go('ingame');
    else if (nav.tab === 'ingame') go('comps');
    else render();
    return;
  }
  // Waehrend der Partie zeichnet nur der Reiter „Im Spiel“ mit.
  if (nav.tab === 'ingame') render();
}

if (IS_OVERLAY) {
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSelf(); });
}

if (inGame()) nav.tab = 'ingame';
listState.retry = () => void refresh(true);
setRender(render);
void boot(render).then(() => refresh());
subscribe(['ms.comps', 'ms.lookups', 'ms.pin', 'ms.settings', 'ms.me', 'ms.profile', 'ms.lobby', 'ms.live'], key => {
  if (key === 'ms.live') { onLive(); return; }
  if (key === 'ms.profile') { swapLive(); return; }
  if (key === 'ms.lobby' && nav.tab !== 'ingame') return;
  // Die Einstellungen lesen nur ms.settings und werden nie neu gebaut, sonst
  // schliesst ein offenes Auswahlfeld; den Sprachwechsel zeichnet boot().
  if (nav.tab === 'settings') { if (key === 'ms.lookups') swapLive(); return; }
  render();
});

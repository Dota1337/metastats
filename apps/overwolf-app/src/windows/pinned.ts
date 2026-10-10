// Overlay der angehefteten Comp: Aufstellung je Spielerstufe (Umschalter),
// Rezepte, Shop-Chancen auf der aktuellen Stufe und Stufenplan.
//
// Ohne angeheftete Comp (oder nach ⇄) zeigt es die Comp-Auswahl: Suchfeld und
// Liste, oben die Comps, von denen schon Units auf dem eigenen Brett stehen
// (lib/comp-search.ts), dazu wie viele Gegner dieselben Carries spielen.
// × blendet das Overlay fuer diese Partie aus, die Comp bleibt angeheftet.
// Liest nur aus dem gemeinsamen Speicher.
import '../styles/app.css';
import { read, write, subscribe, patchSettings } from '../lib/store.ts';
import { t } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { makeDraggable, fitSelf, tellBackground } from '../lib/ow.ts';
import { compLevelling, positioningView, compRecipes } from '../lib/plan.ts';
import { rankComps, contestCount, BOARD_MIN_SCORE } from '../lib/comp-search.ts';
import { h, clear, unitIcon, itemIcon, compUnits, tierBadge, levelTabs, levellingText } from '../lib/dom.ts';
import { boardView } from '../lib/board-view.ts';
import type { CompanionComp } from '../../../../app/lib/companion-types.ts';

const root = document.getElementById('app')!;
const WIDTH = 340;
const PICKER_ROWS = 12;

// Fensterhoehe folgt dem Inhalt, damit unter dem Overlay nichts Klicks schluckt.
function fit(): void {
  const el = root.firstElementChild as HTMLElement | null;
  if (el) fitSelf(WIDTH, el.getBoundingClientRect().bottom + 2);
  else fitSelf(WIDTH, 1);
}

function collapseBtn(collapsed: boolean): HTMLElement {
  return h('button', { class: 'win-btn', onclick: () => patchSettings({ collapsed: !collapsed }) }, collapsed ? '▾' : '▴');
}

function closeBtn(): HTMLElement {
  return h('button', { class: 'win-btn close', 'aria-label': '×', onclick: () => tellBackground('dismiss', 'pinned') }, '×');
}

// Gewaehlte Stufe der Aufstellung; springt beim Wechsel der Comp auf deren Start-Stufe.
// picking: Auswahl offen, obwohl eine Comp angeheftet ist.
const ui = { key: '', level: 0, picking: false, query: '' };

// ---- Comp-Auswahl -------------------------------------------------------
// Suchfeld wird einmal gebaut und bleibt stehen, damit Fokus und Cursor beim
// Tippen und bei neuen Spieldaten erhalten bleiben; nur die Liste wird neu
// gefuellt.
const search = h('input', { class: 'picker-search', type: 'search', spellcheck: 'false' });
search.addEventListener('input', () => { ui.query = search.value; fillList(); });
search.addEventListener('keydown', e => {
  if (e.key === 'Escape' && read('ms.pin')) { ui.picking = false; ui.query = ''; search.value = ''; render(); }
});
const list = h('div', { class: 'picker-list' });

function pick(c: CompanionComp): void {
  ui.picking = false;
  ui.query = '';
  search.value = '';
  write('ms.pin', c);
}

function fillList(): void {
  const comps = read('ms.comps')?.data.comps ?? [];
  const lk = read('ms.lookups')?.data ?? null;
  const live = read('ms.live');
  const rows = rankComps(comps, live.myUnits, ui.query, lk).slice(0, PICKER_ROWS);
  clear(list, rows.map(r => {
    const c = r.comp;
    const contest = contestCount(c, live.oppBoards, comps);
    const targets = new Set(c.reroll?.targets ?? []);
    return h('button', { class: r.score >= BOARD_MIN_SCORE ? 'picker-row fits' : 'picker-row', type: 'button', onclick: () => pick(c) },
      tierBadge(c.tier),
      h('span', { class: 'picker-carries' }, c.carries.map(id => unitIcon(id, lk, { star3: targets.has(id), size: 'xs' }))),
      h('span', { class: 'picker-text' },
        h('span', { class: 'picker-name', title: c.name }, c.name),
        r.onBoard.length || contest ? h('span', { class: 'picker-chips' },
          r.onBoard.length ? h('span', { class: 'tag ok' }, t('picker.onBoard', { n: r.onBoard.length })) : null,
          contest ? h('span', { class: 'tag warn' }, t('picker.contest', { n: contest })) : null,
        ) : null,
      ),
    );
  }));
  fit();
}

function pickerView(collapsed: boolean): void {
  // Vor dem Bau der Kopfzeile merken: das Umhaengen des Suchfelds nimmt ihm
  // den Fokus, danach Cursor zurueckgeben.
  const focused = document.activeElement === search;
  const [s0, s1] = [search.selectionStart, search.selectionEnd];
  const pin = read('ms.pin');
  // Erst hier: beim Laden des Moduls steht die Sprache noch nicht fest.
  search.placeholder = t('picker.search');
  const head = h('header', { class: 'ov-head' },
    search,
    pin ? h('button', { class: 'win-btn', title: t('picker.switch'), onclick: () => { ui.picking = false; render(); } }, '⇄') : null,
    collapseBtn(collapsed),
    closeBtn(),
  );
  makeDraggable(head);
  clear(root, h('div', { class: 'overlay picker' }, head, collapsed ? null : list));
  if (focused) {
    search.focus();
    if (s0 != null) search.setSelectionRange(s0, s1 ?? s0);
  }
  if (collapsed) fit();
  else fillList();
}

// ---- angeheftete Comp ----------------------------------------------------
function render(): void {
  const pin = read('ms.pin');
  const lk = read('ms.lookups')?.data ?? null;
  const live = read('ms.live');
  const settings = read('ms.settings');
  const collapsed = settings.collapsed;
  if (!pin || ui.picking) {
    if (!settings.compPicker) { ui.picking = false; clear(root); fit(); return; }
    pickerView(collapsed);
    return;
  }

  const head = h('header', { class: 'ov-head' },
    tierBadge(pin.tier),
    h('div', { class: 'ov-title' }, pin.name),
    settings.compPicker ? h('button', { class: 'win-btn', title: t('picker.switch'), onclick: () => { ui.picking = true; render(); search.focus(); } }, '⇄') : null,
    collapseBtn(collapsed),
    closeBtn(),
  );
  makeDraggable(head);
  if (collapsed) { clear(root, h('div', { class: 'overlay' }, head)); fit(); return; }

  const recipes = compRecipes(pin, lk);
  const odds = live.level != null ? lk?.shopOdds[live.level] : undefined;
  // Aufstellung und fruehes Board laedt das Hintergrundfenster; ohne sie
  // bleibt es bei der Unit-Reihe.
  const pd = read('ms.pinDetail');
  const detail = pd && pd.key === pin.key ? pd.data : null;
  const byId = new Map(pin.units.map(u => [u.id, u]));
  // Reiter, Startstufe und Levelplan wie auf der Homepage und im Hauptfenster
  // (positioningView, compLevelling). ui.level 0 = noch nicht gewaehlt.
  if (ui.key !== pin.key) { ui.key = pin.key; ui.level = 0; }
  const view = positioningView(pin, detail, ui.level);
  const board = view.board;
  const levelling = compLevelling(pin, detail);
  const early = live.level != null && live.level >= 4 && live.level <= 7 ? detail?.early[String(live.level)]?.[0] : undefined;

  clear(root, h('div', { class: 'overlay' },
    head,
    detail && board.length
      ? h('div', {},
        view.levels.length
          ? levelTabs(view.levels, view.level, view.share, l => { ui.level = l; render(); })
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
      h('span', {}, levellingText(levelling)),
      levelling.kind === 'reroll' && pin.reroll?.targets.length
        ? h('span', { class: 'plan-targets' }, pin.reroll.targets.map(id => unitIcon(id, lk, { star3: true, size: 'sm' })))
        : null,
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

const picking = () => !read('ms.pin') || ui.picking;
// Fingerabdruck der Spieldaten, die die Auswahl-Liste beeinflussen.
const boardSig = () => {
  const l = read('ms.live');
  return JSON.stringify([l.myUnits, Object.keys(l.oppBoards).map(k => [k, l.oppBoards[k].round])]);
};
let lastLevel = read('ms.live').level;
let lastCollapsed = read('ms.settings').collapsed;
let lastPicker = read('ms.settings').compPicker;
let lastBoards = boardSig();

void boot(render);
subscribe(['ms.pin', 'ms.pinDetail', 'ms.lookups', 'ms.comps', 'ms.live', 'ms.settings'], key => {
  if (key === 'ms.live') {
    // In der Auswahl zaehlen eigenes Brett und Gegner-Bretter (nur die Liste
    // neu fuellen), sonst nur die Stufe; Shop-Wechsel aendern nichts.
    if (picking()) {
      const sig = boardSig();
      if (sig === lastBoards) return;
      lastBoards = sig;
      if (!read('ms.settings').collapsed) fillList();
      return;
    }
    const l = read('ms.live').level;
    if (l === lastLevel) return;
    lastLevel = l;
  }
  if (key === 'ms.settings') {
    const s = read('ms.settings');
    if (s.collapsed === lastCollapsed && s.compPicker === lastPicker) return;
    lastCollapsed = s.collapsed;
    lastPicker = s.compPicker;
  }
  if (key === 'ms.comps' && picking()) { fillList(); return; }
  render();
});

// Hauptfenster (Alt+D): Comps, Werkzeuge, Profil, Einstellungen.
import '../styles/app.css';
import type { CompanionComp, CompanionLookups, CompanionPlayerResponse } from '../../../../app/lib/companion-types.ts';
import { read, write, patchSettings, subscribe } from '../lib/store.ts';
import { t, lang, LANGS, type Lang } from '../lib/i18n.ts';
import { boot } from '../lib/boot.ts';
import { loadComps, loadLookups, loadPlayer, siteUrl } from '../lib/api.ts';
import { makeDraggable, minimizeSelf, closeSelf, openExternal } from '../lib/ow.ts';
import { levelPlan, compRecipes } from '../lib/plan.ts';
import { h, clear, unitIcon, itemIcon, tierBadge, fmtAvg, fmtPct, compUnits } from '../lib/dom.ts';

type Tab = 'comps' | 'tools' | 'profile' | 'settings';

const REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'] as const;

const state = {
  tab: 'comps' as Tab,
  query: '',
  toolLevel: 7,
  profileName: '',
  profile: null as CompanionPlayerResponse | null,
  profileError: null as string | null,
  profileLoading: false,
  loadFailed: false,
};

const root = document.getElementById('app')!;

function lookups(): CompanionLookups | null {
  return read('ms.lookups')?.data ?? null;
}

// ---------- Kopf ----------

function header(): HTMLElement {
  const tabs: Tab[] = ['comps', 'tools', 'profile', 'settings'];
  const bar = h('header', { class: 'titlebar' },
    h('div', { class: 'brand' }, h('img', { src: '../images/IconMouseOver.png', alt: '' }), 'metastats.gg'),
    h('nav', { class: 'tabs' }, tabs.map(tab =>
      h('button', { class: tab === state.tab ? 'tab active' : 'tab', onclick: () => { state.tab = tab; render(); } }, t(`tab.${tab}`)),
    )),
    h('div', { class: 'win-buttons' },
      h('button', { class: 'win-btn', 'aria-label': '—', onclick: minimizeSelf }, '–'),
      h('button', { class: 'win-btn close', 'aria-label': '×', onclick: closeSelf }, '×'),
    ),
  );
  makeDraggable(bar);
  return bar;
}

// ---------- Comps ----------

function compRow(c: CompanionComp, lk: CompanionLookups | null, pinnedKey: string | null): HTMLElement {
  const pinned = c.key === pinnedKey;
  return h('article', { class: pinned ? 'comp pinned' : 'comp' },
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
        h('button', { class: pinned ? 'btn primary' : 'btn', onclick: () => write('ms.pin', pinned ? null : c) }, pinned ? t('comps.unpin') : t('comps.pin')),
        h('button', { class: 'btn ghost', onclick: () => openExternal(siteUrl(`/tft/comps/${encodeURIComponent(c.slug)}`)) }, t('comps.open')),
      ),
    ),
    compUnits(c, lk),
  );
}

function compsTab(): HTMLElement {
  const comps = read('ms.comps')?.data.comps ?? [];
  const lk = lookups();
  const pin = read('ms.pin');
  const input = h('input', { class: 'search', type: 'search', placeholder: t('comps.search'), value: state.query });
  input.addEventListener('input', () => {
    state.query = input.value;
    const body = document.getElementById('comp-list');
    if (body) clear(body, renderList());
  });
  const renderList = () => {
    const qq = state.query.trim().toLowerCase();
    const l = qq
      ? comps.filter(c => c.name.toLowerCase().includes(qq)
        || c.units.some(u => (lk?.champions[u.id]?.name || u.id).toLowerCase().includes(qq)))
      : comps;
    return l.map(c => compRow(c, lk, pin?.key ?? null));
  };
  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' }, input),
    comps.length === 0
      ? state.loadFailed
        ? h('div', { class: 'empty' }, t('common.offline'), ' ', h('button', { class: 'btn', onclick: () => void refresh(true) }, t('common.retry')))
        : h('div', { class: 'spinner' })
      : null,
    h('div', { id: 'comp-list', class: 'comp-list' }, renderList()),
  );
}

// ---------- Werkzeuge ----------

function toolsTab(): HTMLElement {
  const lk = lookups();
  const pin = read('ms.pin');
  const levels = Object.keys(lk?.shopOdds ?? {}).map(Number).sort((a, b) => a - b);
  const odds = lk?.shopOdds[state.toolLevel];

  const oddsBlock = h('div', { class: 'card' },
    h('h3', {}, t('tools.odds')),
    h('div', { class: 'level-pick' }, levels.map(l =>
      h('button', { class: l === state.toolLevel ? 'chip active' : 'chip', onclick: () => { state.toolLevel = l; render(); } }, String(l)),
    )),
    odds ? h('table', { class: 'odds' },
      h('tr', {}, h('th', {}, t('tools.cost')), [1, 2, 3, 4, 5].map(c => h('th', { class: `c${c}` }, String(c)))),
      h('tr', {}, h('th', {}, t('tools.odds')), odds.map((p, i) => h('td', { class: `c${i + 1}` }, `${p}%`))),
      h('tr', {}, h('th', {}, t('tools.copies')), [1, 2, 3, 4, 5].map(c => h('td', {}, lk?.bagSize[c] != null ? String(lk.bagSize[c]) : '—'))),
    ) : null,
  );

  let planBlock: HTMLElement | null = null;
  if (pin) {
    const plan = levelPlan(pin, lk);
    planBlock = h('div', { class: 'card' },
      h('h3', {}, t('tools.levelPlan'), ' · ', pin.name),
      h('p', { class: 'plan' },
        plan.kind === 'reroll' ? t('plan.reroll', { n: plan.level }) : t(`plan.${plan.kind}`),
        plan.avgLevel != null ? h('span', { class: 'muted' }, ` · ${t('plan.avgLevel')} ${plan.avgLevel.toFixed(1)}`) : null,
      ),
      plan.kind === 'reroll'
        ? h('div', { class: 'plan-targets' }, h('span', { class: 'muted' }, t('plan.threeStar')), plan.targets.map(id => unitIcon(id, lk, { star3: true, size: 'sm' })))
        : null,
      compRecipes(pin, lk).length
        ? h('div', { class: 'plan-recipes' },
          h('span', { class: 'muted' }, t('tools.recipes')),
          h('div', { class: 'recipes' }, compRecipes(pin, lk).map(r => recipeRow(r.item, r.parts, lk))))
        : null,
    );
  }

  const allRecipes = Object.entries(lk?.items ?? {})
    .filter(([, it]) => it.recipe)
    .sort((a, b) => a[1].name.localeCompare(b[1].name, lang()));
  const recipeBlock = h('div', { class: 'card' },
    h('h3', {}, t('tools.recipes')),
    h('div', { class: 'recipes grid' }, allRecipes.map(([id, it]) => recipeRow(id, it.recipe!, lk))),
  );

  return h('section', { class: 'panel' }, planBlock, oddsBlock, recipeBlock);
}

function recipeRow(item: string, parts: [string, string], lk: CompanionLookups | null): HTMLElement {
  return h('div', { class: 'recipe', title: lk?.items[item]?.name || item },
    itemIcon(parts[0], lk, 'sm'), h('span', { class: 'op' }, '+'), itemIcon(parts[1], lk, 'sm'),
    h('span', { class: 'op' }, '='), itemIcon(item, lk, 'md'),
  );
}

// ---------- Profil ----------

async function searchProfile(name: string): Promise<void> {
  const n = name.trim();
  if (!n.includes('#')) return;
  state.profileName = n;
  state.profileLoading = true;
  state.profileError = null;
  render();
  try {
    state.profile = await loadPlayer(n);
  } catch (e) {
    state.profile = null;
    const status = (e as { status?: number }).status;
    state.profileError = status === 404 ? t('profile.notFound') : t('common.offline');
  } finally {
    state.profileLoading = false;
    render();
  }
}

function profileTab(): HTMLElement {
  const me = read('ms.me');
  const lk = lookups();
  const input = h('input', { class: 'search', type: 'search', placeholder: t('profile.placeholder'), value: state.profileName || me || '' });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') void searchProfile(input.value); });
  const p = state.profile;
  return h('section', { class: 'panel' },
    h('div', { class: 'toolbar' },
      input,
      h('button', { class: 'btn primary', onclick: () => void searchProfile(input.value) }, t('profile.search')),
      me && me !== state.profileName ? h('button', { class: 'btn ghost', onclick: () => void searchProfile(me) }, t('profile.me')) : null,
    ),
    state.profileLoading ? h('div', { class: 'spinner' }) : null,
    state.profileError ? h('div', { class: 'empty' }, state.profileError) : null,
    p && !state.profileLoading ? h('div', { class: 'profile' },
      h('div', { class: 'card profile-head' },
        p.player.icon != null ? h('img', { class: 'avatar', src: `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${p.player.icon}.jpg`, alt: '' }) : null,
        h('div', {},
          h('div', { class: 'player-name' }, p.player.name),
          h('div', { class: 'muted' },
            p.ranked?.tier
              ? `${p.ranked.tier[0]}${p.ranked.tier.slice(1).toLowerCase()} ${p.ranked.rank ?? ''} · ${p.ranked.lp ?? 0} LP · ${p.ranked.wins}–${p.ranked.losses}`
              : t('profile.unranked'),
          ),
        ),
      ),
      h('div', { class: 'matches' }, p.matches.map(m =>
        h('div', { class: `match place-${m.placement <= 4 ? 'top' : 'bot'}` },
          h('div', { class: 'match-place' }, `#${m.placement}`),
          h('div', { class: 'match-meta muted' }, new Date(m.at).toLocaleDateString(lang(), { day: '2-digit', month: '2-digit' }), m.level != null ? ` · ${t('tools.level')} ${m.level}` : ''),
          h('div', { class: 'units' }, m.units.map(u => unitIcon(u.id, lk, { star3: u.star >= 3, items: u.items, size: 'md' }))),
        ),
      )),
    ) : null,
  );
}

// ---------- Einstellungen ----------

function toggleRow(label: string, key: 'pinned' | 'shop' | 'matchups' | 'share'): HTMLElement {
  const s = read('ms.settings');
  const box = h('input', { type: 'checkbox', checked: s[key] });
  box.addEventListener('change', () => patchSettings({ [key]: box.checked }));
  return h('label', { class: 'setting' }, h('span', {}, label), box);
}

function settingsTab(): HTMLElement {
  const s = read('ms.settings');
  const regionLabel = (r: string) => r === 'all' ? t('settings.allRegions') : r === 'west' ? t('settings.west') : r === 'asia' ? t('settings.asia') : r.toUpperCase().replace(/\d$/, '');
  const region = h('select', {}, REGIONS.map(r => h('option', { value: r, selected: r === s.region }, regionLabel(r))));
  region.addEventListener('change', () => patchSettings({ region: region.value }));
  const language = h('select', {}, LANGS.map(l => h('option', { value: l.code, selected: l.code === lang() }, l.label)));
  language.addEventListener('change', () => patchSettings({ lang: language.value as Lang }));
  const hotkey = h('kbd', {}, 'Alt+D');
  try {
    overwolf.settings.hotkeys.get(r => {
      const all = [...((r as { globals?: Array<{ name: string; binding: string }> })?.globals ?? [])];
      for (const g of Object.values((r as { games?: Record<string, Array<{ name: string; binding: string }>> })?.games ?? {})) all.push(...g);
      const hk = all.find(x => x.name === 'toggle_main');
      if (hk?.binding) hotkey.textContent = hk.binding;
    });
  } catch { /* ausserhalb von Overwolf */ }
  return h('section', { class: 'panel' },
    h('div', { class: 'card settings' },
      toggleRow(t('settings.pinned'), 'pinned'),
      toggleRow(t('settings.shop'), 'shop'),
      toggleRow(t('settings.matchups'), 'matchups'),
      toggleRow(t('settings.share'), 'share'),
      h('label', { class: 'setting' }, h('span', {}, t('settings.region')), region),
      h('label', { class: 'setting' }, h('span', {}, t('settings.language')), language),
      h('div', { class: 'setting' }, h('span', {}, t('settings.hotkey')), hotkey),
    ),
  );
}

// ---------- Zeichnen ----------

function render(): void {
  const body = state.tab === 'comps' ? compsTab()
    : state.tab === 'tools' ? toolsTab()
      : state.tab === 'profile' ? profileTab()
        : settingsTab();
  clear(root, header(), h('main', { class: 'content' }, body));
}

async function refresh(force = false): Promise<void> {
  const [comps] = await Promise.all([loadComps(force), loadLookups(force)]);
  state.loadFailed = !comps;
  render();
}

void boot(render).then(() => refresh());
subscribe(['ms.comps', 'ms.lookups', 'ms.pin', 'ms.settings'], key => {
  // Beim Tippen in der Suche nicht das Eingabefeld neu bauen.
  if (key === 'ms.settings' && state.tab === 'settings') return;
  render();
});

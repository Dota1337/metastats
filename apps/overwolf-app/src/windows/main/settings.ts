// Reiter Einstellungen.
import { read, patchSettings, type Settings } from '../../lib/store.ts';
import { t, lang, LANGS, type Lang } from '../../lib/i18n.ts';
import { h } from '../../lib/dom.ts';

const REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'] as const;

function toggleRow(label: string, key: 'pinned' | 'shop' | 'opponent' | 'share'): HTMLElement {
  const s = read('ms.settings');
  const box = h('input', { type: 'checkbox', checked: s[key] });
  box.addEventListener('change', () => patchSettings({ [key]: box.checked } as Partial<Settings>));
  return h('label', { class: 'setting' }, h('span', {}, label), box);
}

// Tastenkuerzel aus Overwolf (der Nutzer kann es dort aendern), sonst der Standard.
function hotkeyKbd(name: string, fallback: string): HTMLElement {
  const kbd = h('kbd', {}, fallback);
  try {
    overwolf.settings.hotkeys.get(r => {
      const all = [...((r as { globals?: Array<{ name: string; binding: string }> })?.globals ?? [])];
      for (const g of Object.values((r as { games?: Record<string, Array<{ name: string; binding: string }>> })?.games ?? {})) all.push(...g);
      const hk = all.find(x => x.name === name);
      if (hk?.binding) kbd.textContent = hk.binding;
    });
  } catch { /* ausserhalb von Overwolf */ }
  return kbd;
}

// Verschiebe-Modus des Gegner-Overlays schaltet das Hintergrundfenster
// (wie beim Tastenkuerzel); Zuruecksetzen = Standardlage.
function moveRow(): HTMLElement {
  const move = h('button', { class: 'btn ghost', type: 'button' }, t('settings.move'));
  move.addEventListener('click', () => {
    try { overwolf.windows.sendMessage('background', 'move_matchup', '', () => {}); } catch { /* ausserhalb von Overwolf */ }
  });
  const reset = h('button', { class: 'btn ghost', type: 'button' }, t('settings.resetPos'));
  reset.addEventListener('click', () => patchSettings({ matchupPos: null }));
  return h('div', { class: 'setting' },
    h('span', {}, t('settings.moveOverlay')),
    h('div', { class: 'setting-actions' }, hotkeyKbd('move_matchup', 'Alt+M'), move, reset),
  );
}

export function settingsTab(): HTMLElement {
  const s = read('ms.settings');
  const regionLabel = (r: string) => r === 'all' ? t('settings.allRegions') : r === 'west' ? t('settings.west') : r === 'asia' ? t('settings.asia') : r.toUpperCase().replace(/\d$/, '');
  const region = h('select', {}, REGIONS.map(r => h('option', { value: r, selected: r === s.region }, regionLabel(r))));
  region.addEventListener('change', () => patchSettings({ region: region.value }));
  const language = h('select', {}, LANGS.map(l => h('option', { value: l.code, selected: l.code === lang() }, l.label)));
  language.addEventListener('change', () => patchSettings({ lang: language.value as Lang }));
  return h('section', { class: 'panel' },
    h('div', { class: 'card settings' },
      toggleRow(t('settings.pinned'), 'pinned'),
      toggleRow(t('settings.shop'), 'shop'),
      toggleRow(t('settings.matchups'), 'opponent'),
      toggleRow(t('settings.share'), 'share'),
      h('label', { class: 'setting' }, h('span', {}, t('settings.region')), region),
      h('label', { class: 'setting' }, h('span', {}, t('settings.language')), language),
      h('div', { class: 'setting' }, h('span', {}, t('settings.hotkey')), hotkeyKbd('toggle_main', 'Alt+D')),
      moveRow(),
    ),
  );
}

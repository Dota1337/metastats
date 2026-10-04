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

export function settingsTab(): HTMLElement {
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
      toggleRow(t('settings.matchups'), 'opponent'),
      toggleRow(t('settings.share'), 'share'),
      h('label', { class: 'setting' }, h('span', {}, t('settings.region')), region),
      h('label', { class: 'setting' }, h('span', {}, t('settings.language')), language),
      h('div', { class: 'setting' }, h('span', {}, t('settings.hotkey')), hotkey),
    ),
  );
}

// Reiter Einstellungen.
import { read, patchSettings, type Settings, type DisplayMode } from '../../lib/store.ts';
import { t, LANGS, type Lang } from '../../lib/i18n.ts';
import { tellBackground } from '../../lib/ow.ts';
import { h } from '../../lib/dom.ts';

const REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'] as const;
const MODES: DisplayMode[] = ['auto', 'overlay', 'desktop'];

type BoolKey = { [K in keyof Settings]: Settings[K] extends boolean ? K : never }[keyof Settings];

function toggleRow(label: string, key: BoolKey): HTMLElement {
  const s = read('ms.settings');
  const box = h('input', { type: 'checkbox', checked: s[key] });
  box.addEventListener('change', () => patchSettings({ [key]: box.checked } as Partial<Settings>));
  return h('label', { class: 'setting' }, h('span', {}, label), box);
}

function selectRow(label: string, options: Array<{ value: string; label: string }>, current: string, onPick: (v: string) => void): HTMLElement {
  const sel = h('select', {}, options.map(o => h('option', { value: o.value, selected: o.value === current }, o.label)));
  sel.addEventListener('change', () => onPick(sel.value));
  return h('label', { class: 'setting' }, h('span', {}, label), sel);
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
  move.addEventListener('click', () => tellBackground('move_matchup'));
  const reset = h('button', { class: 'btn ghost', type: 'button' }, t('settings.resetPos'));
  reset.addEventListener('click', () => patchSettings({ matchupPos: null }));
  return h('div', { class: 'setting' },
    h('span', {}, t('settings.moveOverlay')),
    h('div', { class: 'setting-actions' }, hotkeyKbd('move_matchup', 'Alt+M'), move, reset),
  );
}

export function settingsTab(): HTMLElement {
  const s = read('ms.settings');
  const regionLabel = (r: string) => r === 'all' ? t('settings.allRegions') : r === 'west' ? t('settings.west') : r === 'asia' ? t('settings.asia') : r.toUpperCase().replace(/[0-9]$/, '');
  const modeLabel = (m: DisplayMode) => m === 'auto' ? t('settings.modeAuto') : m === 'overlay' ? t('settings.modeOverlay') : t('settings.modeDesktop');
  return h('section', { class: 'panel' },
    h('div', { class: 'card settings' },
      selectRow(t('settings.mode'), MODES.map(m => ({ value: m, label: modeLabel(m) })), s.mode, v => patchSettings({ mode: v as DisplayMode })),
      toggleRow(t('settings.autoMove'), 'autoMove'),
      toggleRow(t('settings.startWithClient'), 'startWithClient'),
      toggleRow(t('settings.popupOnEnd'), 'popupOnEnd'),
      h('div', { class: 'setting' }, h('span', {}, t('settings.hotkey')), hotkeyKbd('toggle_main', 'Alt+D')),
    ),
    h('div', { class: 'card settings' },
      toggleRow(t('settings.pinned'), 'pinned'),
      toggleRow(t('settings.compPicker'), 'compPicker'),
      toggleRow(t('settings.shop'), 'shop'),
      toggleRow(t('settings.matchups'), 'opponent'),
      toggleRow(t('settings.scout'), 'scout'),
      toggleRow(t('settings.items'), 'items'),
      moveRow(),
    ),
    h('div', { class: 'card settings' },
      selectRow(t('settings.region'), REGIONS.map(r => ({ value: r, label: regionLabel(r) })), s.region, v => patchSettings({ region: v })),
      // Ohne Wahl (lang null) ist die App Englisch.
      selectRow(t('settings.language'), LANGS.map(l => ({ value: l.code, label: l.label })),
        s.lang ?? 'en', v => patchSettings({ lang: v as Lang })),
      toggleRow(t('settings.share'), 'share'),
    ),
  );
}

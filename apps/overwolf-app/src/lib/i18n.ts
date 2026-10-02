// Texte aus app/lib/i18n-companion.ts — dieselbe Datei wie auf der Seite.
import { COMPANION_TRANSLATIONS, type CompanionTranslationKey } from '../../../../app/lib/i18n-companion.ts';

export type Lang = 'de' | 'en' | 'ko' | 'zh' | 'es' | 'fr';
export const LANGS: Array<{ code: Lang; label: string }> = [
  { code: 'de', label: 'Deutsch' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
];

type ShortKey = CompanionTranslationKey extends `companion.${infer R}` ? R : never;

let current: Lang = 'en';

export function toLang(code: string | null | undefined): Lang {
  const c = (code || '').slice(0, 2).toLowerCase();
  return (LANGS.some(l => l.code === c) ? c : 'en') as Lang;
}

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
}

export function lang(): Lang {
  return current;
}

export function t(key: ShortKey, vars?: Record<string, string | number>): string {
  const entry = COMPANION_TRANSLATIONS[`companion.${key}` as CompanionTranslationKey];
  let s: string = entry ? entry[current] : key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

// Gewaehlte Sprache, sonst Overwolf-Sprache, sonst Browser-Sprache.
export function resolveLang(chosen: Lang | null): Promise<Lang> {
  if (chosen) return Promise.resolve(chosen);
  return new Promise(res => {
    try {
      overwolf.settings.language.get(r => res(toLang(r?.language || navigator.language)));
    } catch {
      res(toLang(navigator.language));
    }
  });
}

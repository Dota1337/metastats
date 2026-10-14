import { cookies, headers } from 'next/headers';
import type { Lang } from './i18n';

const LANG_COOKIE = 'metastats-lang';
const VALID_LANGS: readonly Lang[] = ['de', 'en', 'ko', 'zh', 'es', 'fr'];

/**
 * Parse an Accept-Language header like "de-DE,de;q=0.9,en;q=0.8" into a ranked
 * list of primary-subtags, then pick the first one that we actually support.
 * Returns null if none match.
 */
function pickFromAcceptLanguage(header: string | null): Lang | null {
  if (!header) return null;
  const prefs = header
    .split(',')
    .map(part => {
      const [raw, ...params] = part.trim().split(';');
      const qParam = params.find(p => p.trim().startsWith('q='));
      const q = qParam ? parseFloat(qParam.split('=')[1]) : 1;
      return { tag: raw.trim().toLowerCase(), q: isNaN(q) ? 1 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of prefs) {
    // "de-DE" → "de", "zh-Hans-CN" → "zh"
    const primary = tag.split('-')[0];
    if (VALID_LANGS.includes(primary as Lang)) return primary as Lang;
  }
  return null;
}

export async function getServerLang(): Promise<Lang> {
  try {
    // 1st preference: explicit cookie set by the user's language dropdown
    const store = await cookies();
    const saved = store.get(LANG_COOKIE)?.value as Lang | undefined;
    if (saved && VALID_LANGS.includes(saved)) return saved;

    // 2nd preference: browser Accept-Language on first visit
    const hdrs = await headers();
    const accept = hdrs.get('accept-language');
    const fromHeader = pickFromAcceptLanguage(accept);
    if (fromHeader) return fromHeader;
  } catch {}
  return 'de';
}

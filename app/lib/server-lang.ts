import { cookies, headers } from 'next/headers';
import { DEFAULT_LANG, LANG_COOKIE, LANG_HEADER, isLang, isPrefixLang, type Lang } from './lang-path';

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
    if (isLang(primary)) return primary;
  }
  return null;
}

/**
 * Sprache der Adresse (`/en/…` → 'en', ohne Vorsatz 'de'). Den Header setzt
 * nur die Middleware; einen von aussen mitgeschickten loescht sie.
 * Fuer canonical, hreflang und Links — die haengen an der Adresse, nicht am
 * Besucher.
 */
export async function getServerPathLang(): Promise<Lang> {
  try {
    const fromPath = (await headers()).get(LANG_HEADER);
    if (isPrefixLang(fromPath)) return fromPath;
  } catch {}
  return DEFAULT_LANG;
}

export async function getServerLang(): Promise<Lang> {
  try {
    const hdrs = await headers();
    // 1st: Sprach-Adresse (`/en/…`) — sie gilt vor jeder Besucher-Vorliebe.
    const fromPath = hdrs.get(LANG_HEADER);
    if (isPrefixLang(fromPath)) return fromPath;

    // 2nd: explicit cookie set by the user's language dropdown
    const store = await cookies();
    const saved = store.get(LANG_COOKIE)?.value;
    if (isLang(saved)) return saved;

    // 3rd: browser Accept-Language on first visit
    const fromHeader = pickFromAcceptLanguage(hdrs.get('accept-language'));
    if (fromHeader) return fromHeader;
  } catch {}
  return DEFAULT_LANG;
}

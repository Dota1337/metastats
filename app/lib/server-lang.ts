import { cookies, headers } from 'next/headers';
import { DEFAULT_LANG, LANG_COOKIE, LANG_HEADER, isLang, isPrefixLang, pickFromAcceptLanguage, type Lang } from './lang-path';

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

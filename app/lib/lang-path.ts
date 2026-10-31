// Sprach-Adressen (SEO Weg C, V5, 15.10.2026). Eine Quelle fuer Middleware,
// Server-Seiten, Browser-Links und Sitemap.
//
// Deutsch steht ohne Vorsatz (`/tft/comps`), die anderen fuenf Sprachen mit
// (`/en/tft/comps`). Die Middleware schreibt `/en/x` intern auf `/x` um und
// gibt die Sprache als Anfrage-Header mit; keine Seite zieht um. `/de/…` gibt
// es bewusst nicht (404) — eine zweite Adresse fuer dieselbe deutsche Seite
// waere doppelter Inhalt.
//
// Blatt-Modul: importiert nichts. i18n.tsx (466 KB, 'use client') importiert
// von hier, nie umgekehrt — die Middleware darf das Woerterbuch nicht laden.

export const LANGS = ['de', 'en', 'ko', 'zh', 'es', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

export const DEFAULT_LANG: Lang = 'de';
/** Ziel fuer Besucher, deren Sprache wir nicht haben (hreflang x-default). */
export const X_DEFAULT_LANG: Lang = 'en';
export const PREFIX_LANGS = ['en', 'ko', 'zh', 'es', 'fr'] as const;
export type PrefixLang = (typeof PREFIX_LANGS)[number];

export const LANG_COOKIE = 'metastats-lang';
/** Anfrage-Header, den NUR die Middleware setzt (fremde Werte loescht sie). */
export const LANG_HEADER = 'x-ms-lang';

/** hreflang-Codes. Chinesisch = vereinfacht, wie inLanguage im Wurzel-Layout. */
export const HREFLANG: Record<Lang, string> = {
  de: 'de', en: 'en', ko: 'ko', zh: 'zh-CN', es: 'es', fr: 'fr',
};

// Erste Pfadteile, die es als Seite gibt. Positivliste statt Ausschluss: was
// hier fehlt (api, internal, auth, companion, _next, robots.txt, sitemap.xml …),
// bekommt mit Vorsatz eine 404 und wird nie umgeschrieben — so kann ein
// Vorsatz nie an der Anmeldung von /internal vorbei. lang-path.test.mjs prueft
// die Liste gegen app/.
export const PAGE_ROOTS: ReadonlySet<string> = new Set([
  'champions', 'compare', 'datenschutz', 'impressum', 'leaderboard', 'ligen',
  'lol', 'marktwert', 'player', 'search', 'teams', 'tft',
]);

export function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v);
}

export function isPrefixLang(v: unknown): v is PrefixLang {
  return typeof v === 'string' && (PREFIX_LANGS as readonly string[]).includes(v);
}

const PREFIX_RE = new RegExp(`^/(${PREFIX_LANGS.join('|')})(?=/|$)`);

/** `/en/tft` → { lang: 'en', rest: '/tft' }; `/en` → rest '/'; sonst lang null. */
export function splitLangPrefix(pathname: string): { lang: PrefixLang | null; rest: string } {
  const m = PREFIX_RE.exec(pathname);
  if (!m) return { lang: null, rest: pathname };
  return { lang: m[1] as PrefixLang, rest: pathname.slice(m[0].length) || '/' };
}

/** Pfad ohne Sprach-Vorsatz — fuer Vergleiche („welcher Menuepunkt ist aktiv“). */
export function stripLangPrefix(pathname: string): string {
  return splitLangPrefix(pathname).rest;
}

/** Sprache der Adresse: Vorsatz-Sprache, sonst Deutsch. */
export function pathLangOf(pathname: string | null | undefined): Lang {
  return splitLangPrefix(pathname || '/').lang ?? DEFAULT_LANG;
}

function isPagePath(path: string): boolean {
  if (path === '/') return true;
  const first = path.slice(1).split('/', 1)[0];
  return PAGE_ROOTS.has(first);
}

/**
 * Internen Link in die Sprache `lang` setzen. Laesst alles unveraendert, was
 * keine Seite ist (extern, `#…`, `?…`, /api, /internal, /auth, /companion) und
 * was schon einen Vorsatz traegt (idempotent: nie `/en/en`). Deutsch = ohne.
 */
export function withLangPrefix(lang: Lang | null | undefined, href: string): string {
  if (!lang || lang === DEFAULT_LANG) return href;
  if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return href;
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const tail = cut < 0 ? '' : href.slice(cut);
  if (splitLangPrefix(path).lang) return href;
  if (!isPagePath(path)) return href;
  return `/${lang}${path === '/' ? '' : path}${tail}`;
}

/** Dieselbe Seite in einer anderen Sprache (Sprachumschalter, hreflang). */
export function switchLangPath(lang: Lang, href: string): string {
  const cut = href.search(/[?#]/);
  const path = cut < 0 ? href : href.slice(0, cut);
  const tail = cut < 0 ? '' : href.slice(cut);
  return withLangPrefix(lang, stripLangPrefix(path) + tail);
}

/** hreflang → absolute Adresse, alle 6 Sprachen plus x-default (Englisch). */
export function langAlternates(origin: string, path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of LANGS) out[HREFLANG[l]] = origin + withLangPrefix(l, path);
  out['x-default'] = origin + withLangPrefix(X_DEFAULT_LANG, path);
  return out;
}

/** Notschalter LANG_PATHS=0: Sprach-Adressen leiten (307) auf die deutsche
 *  Adresse um, Metadaten und Sitemap nennen keine Alternativen mehr. */
export function langPathsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.LANG_PATHS !== '0';
}

/**
 * Notschalter nur fuer die Weiterleitung auf die Sprach-Adresse: LANG_REDIRECT=0
 * laesst die Sprach-Adressen stehen, die deutsche Adresse zeigt dann wieder die
 * Besuchersprache. LANG_PATHS=0 schaltet sie mit ab (sonst Endlosschleife: die
 * Middleware leitet /en/x dort auf /x).
 */
export function langRedirectEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return langPathsEnabled(env) && env.LANG_REDIRECT !== '0';
}

/**
 * Accept-Language wie "de-DE,de;q=0.9,en;q=0.8" → erste Sprache, die es hier
 * gibt, nach Gewichtung. null, wenn keine passt.
 */
export function pickFromAcceptLanguage(header: string | null | undefined): Lang | null {
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
 * Soll eine deutsche Adresse auf die Sprach-Adresse weiterleiten? Damit ein
 * kopierter Link dieselbe Sprache zeigt wie die Seite, von der er stammt: die
 * Vorschau-Dienste kennen weder Cookie noch Browsersprache des Teilenden.
 *
 * - Die gespeicherte Wahl (Cookie) gilt immer; Deutsch leitet nie weiter.
 * - Die Browsersprache nur beim echten Seitenaufruf aus dem Browser, nie fuer
 *   Bots: Google und Vorschau-Dienste bekommen die deutsche Adresse deutsch.
 * - Nicht bei einem Sprung innerhalb der Seite: sonst kaeme nicht mehr auf
 *   Deutsch, wer Cookies sperrt und einen englischen Browser hat.
 */
export function langRedirectTarget(input: {
  method: string;
  pathname: string;
  cookie: string | null | undefined;
  acceptLanguage: string | null | undefined;
  fetchDest: string | null | undefined;
  fetchSite: string | null | undefined;
  isBot: boolean;
  enabled: boolean;
}): PrefixLang | null {
  if (!input.enabled) return null;
  if (input.method !== 'GET' && input.method !== 'HEAD') return null;
  if (splitLangPrefix(input.pathname).lang || !isPagePath(input.pathname)) return null;
  if (isLang(input.cookie)) return isPrefixLang(input.cookie) ? input.cookie : null;
  if (input.isBot || input.fetchDest !== 'document' || input.fetchSite === 'same-origin') return null;
  const lang = pickFromAcceptLanguage(input.acceptLanguage);
  return isPrefixLang(lang) ? lang : null;
}

export type LangRoute =
  | { kind: 'none' }
  | { kind: 'blocked'; lang: PrefixLang }
  | { kind: 'rewrite'; lang: PrefixLang; rest: string };

/**
 * Entscheidung der Middleware, als reine Funktion testbar:
 * - kein Vorsatz → none (alles wie bisher)
 * - Vorsatz vor einer Seite → rewrite auf `rest`
 * - Vorsatz vor allem anderen (api, internal, Dateien …) → blocked (404)
 */
export function langRoute(pathname: string): LangRoute {
  const { lang, rest } = splitLangPrefix(pathname);
  if (!lang) return { kind: 'none' };
  return isPagePath(rest) ? { kind: 'rewrite', lang, rest } : { kind: 'blocked', lang };
}

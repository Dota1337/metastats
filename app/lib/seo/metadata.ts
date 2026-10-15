import 'server-only';
import type { Metadata } from 'next';
import { getServerLang, getServerPathLang } from '../server-lang';
import type { Lang } from '../lang-path';
import { buildMetadata, seoText, type PageKey } from './copy';

// Seitentitel, Beschreibung und canonical in der Sprache des Besuchers.
// Google schickt weder Sprach-Cookie noch Accept-Language und bekommt damit
// den Rueckfall 'de' (server-lang.ts) — E1 im SEO-Plan.
//
// `path` ist der Pfad OHNE Query: Filter-Varianten (?bucket=…) zeigen alle auf
// dieselbe Adresse. Segmente muessen schon kodiert sein (encodeURIComponent).
// null = kein canonical (Seiten, die ohne ?region= etwas anderes zeigen).
//
// `name` darf eine Funktion der Sprache sein (Champion-Namen gibt es je
// Sprache); sie bekommt die Sprache, die auch der Titel nutzt.
//
// `noindex`: zweites Netz hinter der 404-Pruefung der Middleware
// (not-found-gate.ts). Was sie durchlaesst, das Bundle des laufenden Sets aber
// nicht kennt (moeglicherweise neue Kennung, oder ein altes Set), bekommt die
// Seite wie heute, Google aber nicht in den Index.
export async function pageMetadata(
  key: PageKey,
  path: string | null,
  name?: string | ((lang: Lang) => Promise<string> | string),
  opts?: { noindex?: boolean },
): Promise<Metadata> {
  const [lang, pathLang] = await Promise.all([getServerLang(), getServerPathLang()]);
  const resolved = typeof name === 'function' ? await name(lang) : name;
  const vars = resolved != null ? { name: resolved } : undefined;
  const meta = buildMetadata(seoText(key, lang, vars), lang, path, key.startsWith('tft.') ? 'tft' : 'lol', pathLang);
  return opts?.noindex ? { ...meta, robots: { index: false, follow: true } } : meta;
}

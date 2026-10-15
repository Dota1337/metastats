import type { Metadata } from 'next';
import HomeClient from '../HomeClient';
import { getServerPathLang } from '../lib/server-lang';
import { SITE_URL } from '../lib/site';
import { langAlternates, langPathsEnabled, withLangPrefix } from '../lib/lang-path';

// LoL-Startseite, solange TFT die Hauptseite ist (TFT_IS_HOME,
// app/lib/feature-flags.ts). Gleicher Inhalt wie app/page.tsx; Titel und
// Beschreibung kommen aus dem Wurzel-Layout. Ist der Schalter aus, leitet
// next.config.ts `/lol` per 307 auf `/` — diese Seite rendert dann nie.
export async function generateMetadata(): Promise<Metadata> {
  const pathLang = await getServerPathLang();
  return {
    alternates: {
      canonical: SITE_URL + withLangPrefix(pathLang, '/lol'),
      ...(langPathsEnabled() ? { languages: langAlternates(SITE_URL, '/lol') } : {}),
    },
  };
}

export default function Page() {
  return <HomeClient />;
}

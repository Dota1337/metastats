import type { Metadata } from 'next';
import HomeClient from './HomeClient';
import { getServerPathLang } from './lib/server-lang';
import { SITE_URL } from './lib/site';
import { langAlternates, langPathsEnabled, withLangPrefix } from './lib/lang-path';

// Startseite: Titel und Beschreibung kommen aus dem Wurzel-Layout (siteText).
// Hier nur canonical und hreflang (SEO Weg C, app/lib/lang-path.ts) — das
// Layout kann sie nicht setzen, weil es auch Seiten ohne canonical traegt
// (Spielerseiten haengen an ?region=).
export async function generateMetadata(): Promise<Metadata> {
  const pathLang = await getServerPathLang();
  return {
    alternates: {
      canonical: SITE_URL + withLangPrefix(pathLang, '/'),
      ...(langPathsEnabled() ? { languages: langAlternates(SITE_URL, '/') } : {}),
    },
  };
}

export default function Page() {
  return <HomeClient />;
}

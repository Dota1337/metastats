import type { Metadata } from 'next';
import { getServerLang, getSeoCopy } from '../server-lang';

// Seitentitel fuer Seiten, deren page.tsx eine Client-Komponente ist und
// darum selbst kein generateMetadata haben kann. Die Link-Vorschau liest den
// Titel aus dem HTML, nicht aus document.title.
//
// openGraph/twitter ersetzen die Werte der Wurzel als Ganzes (flaches
// Zusammenfuehren), deshalb steht hier alles noch einmal. Kein twitter.images:
// sonst bliebe das allgemeine Bild der Wurzel stehen — ohne Eintrag nimmt X
// das og:image aus der opengraph-image-Datei des Abschnitts.
export async function titledMetadata(name: string | null): Promise<Metadata> {
  const lang = await getServerLang();
  const seo = getSeoCopy(lang);
  if (!name) return {};
  const title = `${name} · metastats.gg`;
  return {
    title,
    openGraph: { title, description: seo.description, siteName: 'metastats.gg', type: 'website' },
    twitter: { card: 'summary_large_image', title, description: seo.description },
  };
}

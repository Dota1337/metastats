import { getServerLang } from '../../lib/server-lang';
import { decodeSlug } from '../../lib/og/slugs';
import { championDetailStart } from '../../lib/seo/lol-detail-data';
import ChampionDetailClient from './ChampionDetailClient';

// Server-Huelle der Champion-Detailseite (SEO-Plan Schritt 6): Name,
// Faehigkeiten, Tipps und Lore kommen in der Sprache des Besuchers im ersten
// HTML (Data Dragon wie im Browser). Die Builds laedt weiter der Browser — sie
// kommen aus der Datenbank. Ohne Stand (oder nach 1,5 s) laedt die Seite wie
// bisher. Titel/Beschreibung: layout.tsx.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [id, lang] = await Promise.all([params.then(p => decodeSlug(p.id)), getServerLang()]);
  return <ChampionDetailClient initial={await championDetailStart(id, lang)} />;
}

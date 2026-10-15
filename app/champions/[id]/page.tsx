import { getServerLang } from '../../lib/server-lang';
import { decodeSlug } from '../../lib/og/slugs';
import { championBuildsStart, championDetailStart } from '../../lib/seo/lol-detail-data';
import ChampionDetailClient from './ChampionDetailClient';

// Server-Huelle der Champion-Detailseite (SEO-Plan Schritt 6): Name,
// Faehigkeiten, Tipps und Lore kommen in der Sprache des Besuchers im ersten
// HTML (Data Dragon wie im Browser). Seit Nachtrag 8 auch die Builds der
// Standardansicht aus der vorgerechneten Datei (nie die Datenbank). Beide mit
// eigenem Zeitlimit von 1,5 s, parallel; ohne Stand laedt der jeweilige Teil
// wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const [id, lang] = await Promise.all([params.then(p => decodeSlug(p.id)), getServerLang()]);
  const [initial, builds] = await Promise.all([championDetailStart(id, lang), championBuildsStart(id)]);
  return <ChampionDetailClient initial={initial} builds={builds} />;
}

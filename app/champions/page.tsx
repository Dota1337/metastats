import { championListStart } from '../lib/seo/lol-data';
import ChampionsClient from './ChampionsClient';

// Server-Huelle der Champion-Liste (SEO-Plan Schritt 6): die Standardansicht
// kommt mit Namen, Zahlen und Links im ersten HTML, die Liste selbst bleibt
// die Client-Komponente von vorher. Ohne Stand (oder nach 1,5 s) laedt sie wie
// bisher im Browser. Titel/Beschreibung: layout.tsx. Gespeicherte Filter gibt
// es hier nicht — die Filter leben nur im Zustand der Seite.
export default async function Page() {
  return <ChampionsClient initial={await championListStart()} />;
}

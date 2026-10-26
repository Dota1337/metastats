import { risingStart } from '../../lib/seo/page-start-tft';
import RisingClient from './RisingClient';

// Server-Huelle der Aufsteiger (Soft-404-Plan 26.10.2026): die Standardansicht
// (1 Tag, alle Regionen) kommt aus der Datei der Box im ersten HTML, mit den
// noetigen Namen und Bildern aus dem Bundle. Ohne Datei laedt die Liste wie
// bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  return <RisingClient initial={await risingStart()} />;
}

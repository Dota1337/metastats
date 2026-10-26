import { patchWinnersStart } from '../../../lib/seo/page-start-tft';
import PatchWinnersClient from './PatchWinnersClient';

// Server-Huelle der Patch-Gewinner (Soft-404-Plan 26.10.2026): die
// Standardansicht (Units, Master+, alle Regionen) aus den Dateien der Box im
// ersten HTML — ohne Datenbank. Fehlt eine Datei, laedt die Seite wie bisher
// im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  return <PatchWinnersClient initial={await patchWinnersStart()} />;
}

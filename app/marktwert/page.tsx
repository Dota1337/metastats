import { lolMarktwertStart } from '../lib/seo/page-start-mirror';
import MarktwertClient, { type MarktwertBody } from './MarktwertClient';

// Server-Huelle des LoL-Marktwerts (Soft-404-Plan 26.10.2026): Top 100,
// Gewinner/Verlierer und Rang-Statistik ohne Filter aus der Datei der Box im
// ersten HTML. Fehlt sie, laedt die Seite wie bisher im Browser.
// Titel/Beschreibung: layout.tsx.
export default async function Page() {
  const start = await lolMarktwertStart<MarktwertBody>();
  return <MarktwertClient initial={start?.body ?? null} />;
}

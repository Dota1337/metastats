import { tftTournamentsStart } from '../../lib/seo/page-start-mirror';
import TftTournamentsClient, { type Tournament } from './TftTournamentsClient';

// Server-Huelle der TFT-Turniere (Soft-404-Plan 26.10.2026): die 200 Turniere
// ohne Filter aus der Datei der Box im ersten HTML. Fehlt sie, laedt die Seite
// wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  const start = await tftTournamentsStart<{ tournaments: Tournament[] }>();
  return <TftTournamentsClient initial={start?.body ?? null} />;
}

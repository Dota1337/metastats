import { tftLeaderboardStart } from '../../lib/seo/page-start-mirror';
import TftLeaderboardClient, { type TftLeaderboardInitial } from './TftLeaderboardClient';

// Server-Huelle der TFT-Rangliste (Soft-404-Plan 26.10.2026): die
// Standardansicht (Welt, alle Raenge, Seite 1) kommt aus der Datei der Box im
// ersten HTML. Ohne Datei laedt die Liste wie bisher im Browser.
// Titel/Beschreibung: layout.tsx.
export default async function Page() {
  const start = await tftLeaderboardStart<TftLeaderboardInitial>();
  return <TftLeaderboardClient initial={start?.body ?? null} />;
}

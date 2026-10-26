import { lolLeaderboardStart } from '../lib/seo/page-start-mirror';
import LeaderboardClient, { type LeaderboardBody } from './LeaderboardClient';

// Server-Huelle der LoL-Rangliste (Soft-404-Plan 26.10.2026): EUW Challenger
// Seite 1 aus der Datei der Box im ersten HTML (alle 30 min und nach jedem
// Key-Wechsel geschrieben). Ist sie aelter als 5 min, holt der Browser still
// die aktuelle Liste. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  return <LeaderboardClient initial={await lolLeaderboardStart<LeaderboardBody>()} />;
}

import { teamsStart } from '../lib/seo/page-start-teams';
import TeamsClient, { type TeamSummary } from './TeamsClient';

// Server-Huelle der Pro-Teams-Liste (Soft-404-Plan 26.10.2026): alle Teams aus
// public/pro-teams/listing.json im ersten HTML; Filter und Sortierung bleiben
// im Browser. Ohne Datei laedt die Liste wie bisher. Titel/Beschreibung: layout.tsx.
export default function Page() {
  return <TeamsClient initial={teamsStart<TeamSummary>()} />;
}

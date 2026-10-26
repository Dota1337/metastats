import { ligenStart } from '../lib/seo/page-start-mirror';
import LigenClient, { type LeagueInfo } from './LigenClient';

// Server-Huelle der Ligen-Uebersicht (Soft-404-Plan 26.10.2026): die Liste aller
// Ligen kommt aus der Datei der Box im ersten HTML; Spielplan und Kalender
// laedt der Browser wie bisher. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  const start = await ligenStart<{ leagues: LeagueInfo[] }>();
  return <LigenClient initialLeagues={start?.body.leagues?.length ? start.body.leagues : null} />;
}

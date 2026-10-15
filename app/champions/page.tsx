import ChampionsClient from './ChampionsClient';

// Uebergang (SEO-Plan Schritt 6): die Liste liegt jetzt in ChampionsClient.tsx.
// Diese Huelle haelt die Seite in jedem Zwischenstand erreichbar; die
// Server-Huelle mit Startdaten ersetzt sie in einem spaeteren Commit.
export default function Page() {
  return <ChampionsClient />;
}

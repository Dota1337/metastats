import ChampionDetailClient from './ChampionDetailClient';

// Uebergang (SEO-Plan Schritt 6): die Detailseite liegt jetzt in
// ChampionDetailClient.tsx. Diese Huelle haelt die Seite in jedem Zwischenstand
// erreichbar; die Server-Huelle mit Startdaten ersetzt sie in einem spaeteren Commit.
export default function Page() {
  return <ChampionDetailClient />;
}

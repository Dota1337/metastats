import CompDetailClient from './CompDetailClient';

// Uebergang (SEO-Plan Schritt 5b): die Detailseite liegt jetzt in CompDetailClient.tsx.
// Diese Huelle haelt die Seite in jedem Zwischenstand erreichbar; die
// Server-Huelle mit Startdaten ersetzt sie in einem spaeteren Commit.
export default function Page() {
  return <CompDetailClient />;
}

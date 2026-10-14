import TraitDetailClient from './TraitDetailClient';

// Uebergang (SEO-Plan Schritt 5): die Detailseite liegt jetzt in TraitDetailClient.tsx.
// Diese Huelle haelt die Seite in jedem Zwischenstand erreichbar; die
// Server-Huelle mit Startdaten ersetzt sie im naechsten Commit.
export default function Page() {
  return <TraitDetailClient />;
}

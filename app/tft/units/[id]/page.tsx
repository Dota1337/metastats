import UnitDetailClient from './UnitDetailClient';

// Uebergang (SEO-Plan Schritt 5): die Detailseite liegt jetzt in UnitDetailClient.tsx.
// Diese Huelle haelt die Seite in jedem Zwischenstand erreichbar; die
// Server-Huelle mit Startdaten ersetzt sie im naechsten Commit.
export default function Page() {
  return <UnitDetailClient />;
}

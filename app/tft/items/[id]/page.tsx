import ItemDetailClient from './ItemDetailClient';

// Uebergang (SEO-Plan Schritt 5): die Detailseite liegt jetzt in ItemDetailClient.tsx.
// Diese Huelle haelt die Seite in jedem Zwischenstand erreichbar; die
// Server-Huelle mit Startdaten ersetzt sie im naechsten Commit.
export default function Page() {
  return <ItemDetailClient />;
}

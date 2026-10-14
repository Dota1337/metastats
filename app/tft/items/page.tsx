import ItemsClient from './ItemsClient';

// Uebergang (SEO-Plan Schritt 3): die Liste liegt jetzt in ItemsClient.tsx. Diese
// Huelle haelt die Seite in jedem Zwischenstand erreichbar; die Server-Huelle
// mit Startdaten ersetzt sie im naechsten Commit.
export default function Page() {
  return <ItemsClient />;
}

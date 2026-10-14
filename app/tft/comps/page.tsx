import CompsClient from './CompsClient';

// Uebergang (SEO-Plan Schritt 4): die Liste liegt jetzt in CompsClient.tsx. Diese
// Huelle haelt die Seite in jedem Zwischenstand erreichbar; die Server-Huelle
// mit Startdaten ersetzt sie im naechsten Commit.
export default function Page() {
  return <CompsClient />;
}

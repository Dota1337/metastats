import { augmentsStart } from '../../lib/seo/page-start-tft';
import { getServerLang } from '../../lib/server-lang';
import AugmentsClient from './AugmentsClient';

// Server-Huelle des Augment-Katalogs (Soft-404-Plan 26.10.2026): Namen, Texte,
// Stufe und Stage aller aktiven Augments im ersten HTML, aus dem Bundle und in
// der Sprache, in der die Seite zeichnet (dieselbe Quelle wie das Wurzel-Layout).
// Nur Katalog, keine Statistik. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  return <AugmentsClient initial={await augmentsStart(await getServerLang())} />;
}

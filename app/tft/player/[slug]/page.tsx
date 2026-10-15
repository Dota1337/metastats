import { decodeSlug, parseTftPlayerSlug } from '../../../lib/og/slugs';
import { tftPlayerHead } from '../../../lib/seo/player-data';
import TftPlayerClient from './TftPlayerClient';

// Server-Huelle der TFT-Spielerseite (SEO-Plan Schritt 7). Wartet NICHT auf das
// Namensverzeichnis: der Client startet seinen Profil-Abruf sofort wie bisher
// und zeigt den Kopf (Name als h1) in einer eigenen Suspense, sobald die
// Abfrage da ist — im ersten HTML, aber ohne den Abruf zu verzoegern.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  return <TftPlayerClient head={gameName ? tftPlayerHead(gameName, tagLine) : null} />;
}

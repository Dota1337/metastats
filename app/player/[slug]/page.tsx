import { parseLolPlayerSlug } from '../../lib/og/slugs';
import { lolPlayerHead } from '../../lib/seo/player-data';
import PlayerClient from './PlayerClient';

// Server-Huelle der LoL-Spielerseite (SEO-Plan Schritt 7). Wartet NICHT auf die
// Quellen: der Client startet seinen Profil-Abruf sofort wie bisher und zeigt
// den Kopf (Name als h1) in einer eigenen Suspense, sobald die Abfrage da ist.
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  return <PlayerClient head={name ? lolPlayerHead(name, tag) : null} />;
}

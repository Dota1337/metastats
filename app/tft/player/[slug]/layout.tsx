import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug, parseTftPlayerSlug, tftPlayerPath } from '../../../lib/og/slugs';
import { playerCanonicalName } from '../../../lib/player-lookup';
import { headTitle, tftPlayerHead } from '../../../lib/seo/player-data';

// Titel, canonical und noindex (page.tsx ist nur eine Huelle). canonical = Pfad
// OHNE ?region=/&puuid= (die Seite findet den Server auch selbst), Schreibweise
// aus dem Namensverzeichnis, wenn es sicher denselben Spieler meint
// (playerCanonicalName). noindex nur, wenn das Namensverzeichnis sicher
// geantwortet und den Spieler nicht gefunden hat (player-lookup.ts).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  if (!gameName) return {};
  const head = await tftPlayerHead(gameName, tagLine);
  const id = playerCanonicalName(head, gameName, tagLine);
  return pageMetadata('tft.player', id ? tftPlayerPath(id.gameName, id.tagLine) : null, headTitle(head, gameName, tagLine), { noindex: head?.known === false });
}

export default function TftPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug, parseTftPlayerSlug } from '../../../lib/og/slugs';
import { headTitle, tftPlayerHead } from '../../../lib/seo/player-data';

// Titel und noindex (page.tsx ist nur eine Huelle). Kein canonical: die Seite
// haengt an ?region=. noindex nur, wenn das Namensverzeichnis sicher geantwortet
// und den Spieler nicht gefunden hat (player-lookup.ts).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  if (!gameName) return {};
  const head = await tftPlayerHead(gameName, tagLine);
  return pageMetadata('tft.player', null, headTitle(head, gameName, tagLine), { noindex: head?.known === false });
}

export default function TftPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

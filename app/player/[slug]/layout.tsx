import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';
import { lolPlayerPath, parseLolPlayerSlug } from '../../lib/og/slugs';
import { playerCanonicalName } from '../../lib/player-lookup';
import { headTitle, lolPlayerHead } from '../../lib/seo/player-data';

// Titel, canonical und noindex (page.tsx ist nur eine Huelle). canonical = Pfad
// OHNE ?region= (ohne Region springt die Seite selbst zum Server), Schreibweise
// aus der Quelle, wenn sie sicher denselben Spieler meint (playerCanonicalName).
// noindex nur, wenn alle Quellen (Profi-Liste, TFT- und LoL-Namensverzeichnis,
// players; player-lookup-server.ts) sicher geantwortet und den Spieler nicht
// gefunden haben.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  if (!name) return {};
  const head = await lolPlayerHead(name, tag);
  const id = playerCanonicalName(head, name, tag);
  return pageMetadata('lol.player', id ? lolPlayerPath(id.gameName, id.tagLine) : null, headTitle(head, name, tag), { noindex: head?.known === false });
}

export default function LolPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

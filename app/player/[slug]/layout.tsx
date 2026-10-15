import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';
import { parseLolPlayerSlug } from '../../lib/og/slugs';
import { headTitle, lolPlayerHead } from '../../lib/seo/player-data';

// Titel und noindex (page.tsx ist nur eine Huelle). Kein canonical: die Seite
// haengt an ?region=. noindex nur, wenn Profi-Liste, Namensverzeichnis und
// players alle sicher geantwortet und den Spieler nicht gefunden haben.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  if (!name) return {};
  const head = await lolPlayerHead(name, tag);
  return pageMetadata('lol.player', null, headTitle(head, name, tag), { noindex: head?.known === false });
}

export default function LolPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

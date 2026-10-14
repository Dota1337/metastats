import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';
import { parseLolPlayerSlug } from '../../lib/og/slugs';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente). Kein
// canonical: die Seite haengt an ?region=.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  if (!name) return {};
  return pageMetadata('lol.player', null, `${name}${tag ? '#' + tag : ''}`);
}

export default function LolPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

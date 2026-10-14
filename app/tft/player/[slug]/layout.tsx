import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug, parseTftPlayerSlug } from '../../../lib/og/slugs';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente). Kein
// canonical: die Seite haengt an ?region=.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  if (!gameName) return {};
  return pageMetadata('tft.player', null, `${gameName}${tagLine ? '#' + tagLine : ''}`);
}

export default function TftPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

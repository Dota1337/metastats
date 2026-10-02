import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { titledMetadata } from '../../../lib/og/metadata';
import { decodeSlug, parseTftPlayerSlug } from '../../../lib/og/slugs';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { gameName, tagLine } = parseTftPlayerSlug(decodeSlug((await params).slug));
  return titledMetadata(gameName ? `${gameName}${tagLine ? '#' + tagLine : ''}` : null);
}

export default function TftPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

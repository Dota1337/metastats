import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { titledMetadata } from '../../lib/og/metadata';
import { parseLolPlayerSlug } from '../../lib/og/slugs';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente).
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { name, tag } = parseLolPlayerSlug(String((await params).slug || ''));
  return titledMetadata(name ? `${name}${tag ? '#' + tag : ''}` : null);
}

export default function LolPlayerLayout({ children }: { children: ReactNode }) {
  return children;
}

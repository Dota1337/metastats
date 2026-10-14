import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';
import { lolChampionName } from '../../lib/seo/names';
import { decodeSlug } from '../../lib/og/slugs';

// Seitentitel mit dem Champion-Namen in der Sprache des Besuchers (Data Dragon,
// wie die Seite selbst). page.tsx ist eine Client-Komponente.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeSlug((await params).id);
  return pageMetadata('lol.champion', `/champions/${encodeURIComponent(id)}`, lang => lolChampionName(id, lang));
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

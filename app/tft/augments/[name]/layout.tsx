import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftAugmentName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel mit dem Augment-Namen (Bundle hat Namen je Sprache). page.tsx ist
// eine Client-Komponente.
export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const id = decodeSlug((await params).name);
  return pageMetadata('tft.augment', `/tft/augments/${encodeURIComponent(id)}`, lang => tftAugmentName(id, lang));
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

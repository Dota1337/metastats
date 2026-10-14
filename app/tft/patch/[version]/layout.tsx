import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel mit der Patch-Nummer (page.tsx ist eine Client-Komponente).
export async function generateMetadata({ params }: { params: Promise<{ version: string }> }) {
  const version = decodeSlug((await params).version);
  return pageMetadata('tft.patchVersion', `/tft/patch/${encodeURIComponent(version)}`, version);
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

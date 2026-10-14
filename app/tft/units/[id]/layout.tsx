import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftKnownInBundle, tftUnitName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel mit dem Unit-Namen aus dem Asset-Bundle (page.tsx ist eine
// Client-Komponente).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeSlug((await params).id);
  return pageMetadata('tft.unit', `/tft/units/${encodeURIComponent(id)}`, tftUnitName(id), {
    noindex: tftKnownInBundle('unit', id) === false,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

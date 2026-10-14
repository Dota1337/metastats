import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftItemName, tftKnownInBundle } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel mit dem Item-Namen aus dem Asset-Bundle (page.tsx ist eine
// Client-Komponente).
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeSlug((await params).id);
  return pageMetadata('tft.item', `/tft/items/${encodeURIComponent(id)}`, tftItemName(id), {
    noindex: tftKnownInBundle('item', id) === false,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

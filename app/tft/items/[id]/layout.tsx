import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftItemName, tftKnownInBundle } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftAssets } from '../../../lib/og/data';
import { itemCanonicalId } from '../../../lib/tft-item-path';

// Seitentitel mit dem Item-Namen aus dem Asset-Bundle (page.tsx ist eine
// Client-Komponente). canonical: gleichnamige Augment-/Upgrade-Variante → Grund-
// Item (tft-item-path.ts), sonst die eigene Adresse.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeSlug((await params).id);
  const canonical = itemCanonicalId(tftAssets()?.items, id);
  return pageMetadata('tft.item', `/tft/items/${encodeURIComponent(canonical)}`, lang => tftItemName(id, lang), {
    noindex: tftKnownInBundle('item', id) === false,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

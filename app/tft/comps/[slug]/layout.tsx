import type { ReactNode } from 'react';
import { compNameFromSlug } from '../../../lib/og/data';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftKnownInBundle } from '../../../lib/seo/names';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente). Name ohne
// Netz aus dem Slug, damit der Seitenaufruf nicht wartet.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeSlug((await params).slug);
  return pageMetadata('tft.comp', `/tft/comps/${encodeURIComponent(slug)}`, compNameFromSlug(slug) || slug, {
    noindex: tftKnownInBundle('comp', slug) === false,
  });
}

export default function CompDetailLayout({ children }: { children: ReactNode }) {
  return children;
}

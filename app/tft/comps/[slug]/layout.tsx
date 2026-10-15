import type { ReactNode } from 'react';
import { compNameFromSlug } from '../../../lib/og/data';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftKnownInBundle } from '../../../lib/seo/names';
import { compPath, compRouteKey } from '../../../lib/tft-comp-path';

// Nur fuer den Seitentitel (die Seite selbst ist CompDetailClient.tsx). Name
// ohne Netz aus dem Slug, damit der Seitenaufruf nicht wartet. canonical =
// lesbare Adresse (compPath), auch wenn die Kennungs-Adresse direkt kam.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const key = compRouteKey(decodeSlug((await params).slug));
  return pageMetadata('tft.comp', compPath(key), compNameFromSlug(key) || key, {
    noindex: tftKnownInBundle('comp', key) === false,
  });
}

export default function CompDetailLayout({ children }: { children: ReactNode }) {
  return children;
}

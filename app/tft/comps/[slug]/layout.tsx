import type { ReactNode } from 'react';
import { compNameFromSlug } from '../../../lib/og/data';
import { pageMetadata } from '../../../lib/seo/metadata';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftKnownInBundle } from '../../../lib/seo/names';
import { compPath, compRouteKey } from '../../../lib/tft-comp-path';
import { compKeyForDefaultView } from '../../../lib/tft-comp-catalog-resolver';
import { CURRENT_SET } from '../../../lib/current-set';

// Nur fuer den Seitentitel (die Seite selbst ist CompDetailClient.tsx). Name
// ohne Netz aus dem Slug, damit der Seitenaufruf nicht wartet. canonical =
// lesbare Adresse (compPath), auch wenn die Kennungs-Adresse direkt kam.
// Comp-Katalog: Titel und canonical nennen die Comp, zu der die Adresse fuehrt
// (eine fest zugeordnete Familie zeigt die Seite ihrer Comp); Familien ohne
// Comp haben keine Daten → noindex. Ohne Katalog-Antwort binnen 400 ms wie bisher.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const key = compRouteKey(decodeSlug((await params).slug));
  const comp = await compKeyForDefaultView(key, CURRENT_SET);
  const shown = comp ?? key;
  return pageMetadata('tft.comp', compPath(shown), compNameFromSlug(shown) || shown, {
    noindex: tftKnownInBundle('comp', key) === false || comp === null,
  });
}

export default function CompDetailLayout({ children }: { children: ReactNode }) {
  return children;
}

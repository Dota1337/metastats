import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftKnownInBundle, tftTraitName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftAssets } from '../../../lib/og/data';
import { traitIdsForParam } from '../../../lib/tft-detail-filters';

// Seitentitel mit dem Trait-Namen. Der Pfadteil ist je nach Herkunft der
// Anzeigename (Trait-Liste, Unit-Seiten) oder die Kennung (Comp-Seiten); beide
// zeigen dieselbe Seite (E4), canonical ist die Adresse mit dem Anzeigenamen
// (so steht sie auch in der Sitemap).
export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeSlug((await params).name);
  // Wie die Trait-Liste: der Name aus dem Bundle, ohne Varianten-Zusatz.
  const { display } = traitIdsForParam(tftAssets()?.traits, name);
  return pageMetadata('tft.trait', `/tft/traits/${encodeURIComponent(display)}`, tftTraitName(name), {
    noindex: tftKnownInBundle('trait', name) === false,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

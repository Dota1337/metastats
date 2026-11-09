import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftKnownInBundle, tftTraitName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';
import { tftAssets } from '../../../lib/og/data';
import { traitPath } from '../../../lib/tft-trait-path';

// Seitentitel mit dem Trait-Namen. Der Pfadteil ist der Anzeigename (alle
// Links, traitPath) oder — aus alten Links — die Kennung; beide zeigen dieselbe
// Seite (E4), canonical ist die Adresse mit dem Anzeigenamen. Dieselbe Funktion
// baut Links und Sitemap-Eintraege, sonst nennt die Seite eine andere Adresse
// als die, unter der sie verlinkt ist.
export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeSlug((await params).name);
  // Wie die Trait-Liste: der Name aus dem Bundle, ohne Varianten-Zusatz.
  return pageMetadata('tft.trait', traitPath(tftAssets()?.traits, name), lang => tftTraitName(name, lang), {
    noindex: tftKnownInBundle('trait', name) === false,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tftTraitName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel mit dem Trait-Namen. Der Pfadteil ist je nach Herkunft der
// Anzeigename (Trait-Liste) oder die Kennung (andere Seiten).
export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeSlug((await params).name);
  return pageMetadata('tft.trait', `/tft/traits/${encodeURIComponent(name)}`, tftTraitName(name));
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

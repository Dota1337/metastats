import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { TFT_WHAT_TO_BUILD_ENABLED } from '../../../lib/feature-flags';
import { pageMetadata } from '../../../lib/seo/metadata';

// Eigene Metadaten, sonst erbt die Seite die von Meta Pulse. noindex wie
// /tft/compare: ohne gewaehlte Unit ist die Seite leer (Soft 404 bei Google).
export function generateMetadata() {
  return pageMetadata('tft.whatToBuild', '/tft/meta-pulse/what-to-build', undefined, { noindex: true });
}

export default function Layout({ children }: { children: ReactNode }) {
  if (!TFT_WHAT_TO_BUILD_ENABLED) notFound();
  return children;
}

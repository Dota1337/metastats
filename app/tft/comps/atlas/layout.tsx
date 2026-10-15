import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';

// Titel, Beschreibung und canonical: app/lib/seo/copy.ts. Hier statt in
// page.tsx, das nur die Startdaten laedt und an AtlasClient weitergibt.
export function generateMetadata() {
  return pageMetadata('tft.comps.atlas', '/tft/comps/atlas');
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';

// Titel, Beschreibung und canonical: app/lib/seo/copy.ts. Hier statt in
// page.tsx, das nur die Startdaten laedt und an CompsClient weitergibt.
export function generateMetadata() {
  return pageMetadata('tft.comps', '/tft/comps');
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';

// Titel, Beschreibung und canonical: app/lib/seo/copy.ts (page.tsx ist eine
// Client-Komponente und kann selbst keine Metadaten liefern). noindex: ohne
// gewaehlte Spieler ist die Seite leer — Google wertete sie als Soft 404.
export function generateMetadata() {
  return pageMetadata('tft.compare', '/tft/compare', undefined, { noindex: true });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

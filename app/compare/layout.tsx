import type { ReactNode } from 'react';
import { pageMetadata } from '../lib/seo/metadata';

// Titel, Beschreibung und canonical: app/lib/seo/copy.ts (page.tsx ist eine
// Client-Komponente und kann selbst keine Metadaten liefern).
export function generateMetadata() {
  return pageMetadata('lol.compare', '/compare');
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

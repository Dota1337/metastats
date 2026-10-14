import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';

// Kein canonical: die Seite haengt an ?region= (Standard euw1), ohne den
// Parameter zeigt dieselbe Adresse fuer andere Regionen nichts an.
export function generateMetadata() {
  return pageMetadata('tft.match', null);
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

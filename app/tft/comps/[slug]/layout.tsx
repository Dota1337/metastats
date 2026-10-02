import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { compNameFromSlug } from '../../../lib/og/data';
import { titledMetadata } from '../../../lib/og/metadata';
import { decodeSlug } from '../../../lib/og/slugs';

// Nur fuer den Seitentitel (page.tsx ist eine Client-Komponente). Name ohne
// Netz aus dem Slug, damit der Seitenaufruf nicht wartet.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return titledMetadata(compNameFromSlug(decodeSlug((await params).slug)));
}

export default function CompDetailLayout({ children }: { children: ReactNode }) {
  return children;
}

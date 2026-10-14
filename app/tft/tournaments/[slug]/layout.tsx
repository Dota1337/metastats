import type { ReactNode } from 'react';
import { pageMetadata } from '../../../lib/seo/metadata';
import { tournamentName } from '../../../lib/seo/names';
import { decodeSlug } from '../../../lib/og/slugs';

// Seitentitel aus der Turnier-Kennung (Datenbank-Name nicht abgefragt, damit
// der Titel den Seitenaufruf nicht aufhaelt). page.tsx ist eine
// Client-Komponente.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const slug = decodeSlug((await params).slug);
  return pageMetadata('tft.tournament', `/tft/tournaments/${encodeURIComponent(slug)}`, tournamentName(slug));
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

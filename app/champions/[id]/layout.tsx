import type { ReactNode } from 'react';
import { pageMetadata } from '../../lib/seo/metadata';
import { lolChampionInfo } from '../../lib/seo/names';
import { getServerLang } from '../../lib/server-lang';
import { decodeSlug } from '../../lib/og/slugs';

// Seitentitel mit dem Champion-Namen in der Sprache des Besuchers (Data Dragon,
// wie die Seite selbst). page.tsx ist die Server-Huelle der Client-Seite.
// noindex: zweites Netz hinter der 404-Pruefung der Middleware — kennt Data
// Dragon die Kennung nicht, bleibt die Seite wie heute, aber nicht im Index.
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = decodeSlug((await params).id);
  const info = await lolChampionInfo(id, await getServerLang());
  return pageMetadata('lol.champion', `/champions/${encodeURIComponent(id)}`, info.name, { noindex: info.known === false });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}

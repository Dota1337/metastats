import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { pageMetadata } from '../../lib/seo/metadata';
import { loadTeamNames } from '../../lib/seo/names';
import { decodeSlug } from '../../lib/og/slugs';

// Echte 404 fuer unbekannte Team-IDs statt einer 200-Seite mit „nicht
// gefunden" (Suchmaschinen indexieren sonst Fantasie-URLs).
//
// Kein generateStaticParams/dynamicParams=false: das Root-Layout liest
// cookies()/headers() (server-lang.ts), jede Seite ist dynamisch, und dann
// greift dynamicParams nicht. Kein import der Liste: public/pro-teams/ entsteht
// erst im Build-Schritt (build-pro-teams-derivate.mjs), tsc in der CI laeuft
// ohne ihn. Die Datei kommt ueber outputFileTracingIncludes in next.config.ts
// in die Funktion. Ist sie nicht lesbar, wird nie 404 geantwortet — die Seite
// entscheidet dann wie bisher selbst.

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const key = decodeSlug((await params).id);
  return pageMetadata('lol.team', `/teams/${encodeURIComponent(key)}`, loadTeamNames()?.get(key) ?? key);
}

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const teams = loadTeamNames();
  if (!teams) return children;
  let key = id;
  try { key = decodeURIComponent(id); } catch { notFound(); }
  if (!teams.has(key)) notFound();
  return children;
}

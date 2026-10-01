import { readFileSync } from 'fs';
import path from 'path';
import { notFound } from 'next/navigation';

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
let teamIds: Set<string> | null | undefined;

function loadTeamIds(): Set<string> | null {
  if (teamIds !== undefined) return teamIds;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'public', 'pro-teams', 'index.json'), 'utf8');
    const data = JSON.parse(raw) as { teams?: { id?: unknown }[] };
    const ids = (data.teams || []).map(t => t.id).filter((id): id is string => typeof id === 'string');
    teamIds = ids.length > 0 ? new Set(ids) : null;
  } catch {
    teamIds = null;
  }
  return teamIds;
}

export default async function TeamLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ids = loadTeamIds();
  if (!ids) return children;
  let key = id;
  try { key = decodeURIComponent(id); } catch { notFound(); }
  if (!ids.has(key)) notFound();
  return children;
}

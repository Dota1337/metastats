import { compDetailStart } from '../../../lib/seo/comp-detail-data';
import { toSearchParams } from '../../../lib/seo/initial-data';
import { decodeSlug } from '../../../lib/og/slugs';
import CompDetailClient from './CompDetailClient';

// Server-Huelle der Comp-Detailseite (SEO-Plan Schritt 5b): Name, Zahlen und
// Links kommen mit dem ersten HTML, die Seite selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser. Titel/Beschreibung: layout.tsx.
//
// key={slug}: ein Wechsel auf eine andere Comp (Varianten, Gegner) baut die
// Seite mit deren Startdaten neu auf, statt die alte Comp stehen zu lassen.
export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const slug = decodeSlug((await params).slug);
  const initial = await compDetailStart(slug, toSearchParams(await searchParams));
  return <CompDetailClient key={slug} initial={initial} />;
}

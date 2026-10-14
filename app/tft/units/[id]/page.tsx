import { unitDetailStart } from '../../../lib/seo/detail-data';
import { toSearchParams } from '../../../lib/seo/initial-data';
import { decodeSlug } from '../../../lib/og/slugs';
import UnitDetailClient from './UnitDetailClient';

// Server-Huelle der Unit-Detailseite (SEO-Plan Schritt 5): Name, Zahlen und
// Links kommen mit dem ersten HTML, die Seite selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = decodeSlug((await params).id);
  const initial = await unitDetailStart(id, toSearchParams(await searchParams));
  return <UnitDetailClient initial={initial} />;
}

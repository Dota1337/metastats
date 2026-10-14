import { itemDetailStart } from '../../../lib/seo/detail-data';
import { toSearchParams } from '../../../lib/seo/initial-data';
import { decodeSlug } from '../../../lib/og/slugs';
import ItemDetailClient from './ItemDetailClient';

// Server-Huelle der Item-Detailseite (SEO-Plan Schritt 5): Name, Zahlen und
// Links kommen mit dem ersten HTML, die Seite selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const id = decodeSlug((await params).id);
  const initial = await itemDetailStart(id, toSearchParams(await searchParams));
  return <ItemDetailClient initial={initial} />;
}

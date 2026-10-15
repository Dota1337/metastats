import { compDetailStart } from '../../../lib/seo/comp-detail-data';
import { toSearchParams } from '../../../lib/seo/initial-data';
import { decodeSlug } from '../../../lib/og/slugs';
import { compRouteKey } from '../../../lib/tft-comp-path';
import CompDetailClient from './CompDetailClient';

// Server-Huelle der Comp-Detailseite (SEO-Plan Schritt 5b): Name, Zahlen und
// Links kommen mit dem ersten HTML, die Seite selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser. Titel/Beschreibung: layout.tsx.
//
// Der Pfadteil ist ein lesbarer Name (/tft/comps/lunar-aphelios → Familien-
// Kennung, tft-comp-path.ts) oder eine Kennung; die Seite bekommt die interne
// Kennung als Prop. key={routeKey}: ein Wechsel auf eine andere Comp (Gegner)
// baut die Seite mit deren Startdaten neu auf, statt die alte stehen zu lassen.
export default async function Page({ params, searchParams }: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const routeKey = compRouteKey(decodeSlug((await params).slug));
  const initial = await compDetailStart(routeKey, toSearchParams(await searchParams));
  return <CompDetailClient key={routeKey} routeKey={routeKey} initial={initial} />;
}

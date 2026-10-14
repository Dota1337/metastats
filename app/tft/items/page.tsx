import { itemsStart, toSearchParams } from '../../lib/seo/initial-data';
import { statsPendingCss } from '../../lib/seo/stats-pending';
import ItemsClient, { type ItemRow } from './ItemsClient';

// Server-Huelle der Items-Liste (SEO-Plan Schritt 3), wie app/tft/units/page.tsx.
// Titel/Beschreibung: layout.tsx.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const start = await itemsStart<ItemRow>(toSearchParams(await searchParams));
  return (
    <>
      {/* Gespeicherte Filter (E3), siehe app/lib/seo/stats-pending.ts. */}
      <style dangerouslySetInnerHTML={{ __html: statsPendingCss(start.filters.bucketAuto ? start.filters.bucket : null) }} />
      <ItemsClient initialFilters={start.filters} initial={start.data} />
    </>
  );
}

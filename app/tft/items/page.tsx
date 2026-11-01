import { itemsStart, toSearchParams } from '../../lib/seo/initial-data';
import { statsPendingCss } from '../../lib/seo/stats-pending';
import { itemTextsSubset } from '../../lib/tft-item-texts-server';
import { parseItemSort, parseItemTypes } from '../../lib/tft-item-tier-rows';
import ItemsClient, { type ItemRow } from './ItemsClient';

// Server-Huelle der Items-Liste (SEO-Plan Schritt 3), wie app/tft/units/page.tsx.
// Titel/Beschreibung: layout.tsx.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sp = toSearchParams(raw);
  const start = await itemsStart<ItemRow>(sp);
  // Fenster aus der Adresse: gleich offen im ersten HTML, Text nur dieses Items.
  const itemParam = sp.get('item');
  const item = itemParam && /^[\w-]{1,100}$/.test(itemParam) ? itemParam : null;
  return (
    <>
      {/* Gespeicherte Filter (E3), siehe app/lib/seo/stats-pending.ts. */}
      <style dangerouslySetInnerHTML={{ __html: statsPendingCss(start.filters.bucketAuto ? start.filters.bucket : null) }} />
      <ItemsClient
        initialFilters={start.filters}
        initial={start.data}
        initialItem={item}
        initialSort={parseItemSort(sp.get('sort'))}
        initialType={parseItemTypes(sp.get('type'))}
        initialTexts={item ? itemTextsSubset(item) : null}
      />
    </>
  );
}

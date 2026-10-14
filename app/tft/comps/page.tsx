import { compsStart, toSearchParams } from '../../lib/seo/initial-data';
import { statsPendingCss } from '../../lib/seo/stats-pending';
import type { CompApiRow } from '../../lib/tft-comp-families';
import CompsClient from './CompsClient';

// Server-Huelle der Comps-Liste (SEO-Plan Schritt 4): die Standardansicht kommt
// mit Namen, Links und Zahlen im ersten HTML — Startdaten sind die Zeilen der
// 40 gezeigten Familien, die volle Liste laedt der Browser bei Bedarf
// (useTftCompsData). Ohne vorgerechneten Stand (oder nach 1,5 s) laedt die
// Liste wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const start = await compsStart<CompApiRow>(toSearchParams(await searchParams));
  return (
    <>
      {/* Gespeicherte Filter (E3): blendet die Server-Zahlen aus, solange das
          Vorab-Skript im Wurzel-Layout ein Merkmal gesetzt hat. Als roher Text,
          damit die Anfuehrungszeichen im Selektor unveraendert ankommen. */}
      <style dangerouslySetInnerHTML={{ __html: statsPendingCss(start.filters.bucketAuto ? start.filters.bucket : null) }} />
      <CompsClient initialFilters={start.filters} initial={start.data} />
    </>
  );
}

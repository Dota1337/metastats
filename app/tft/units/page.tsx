import { unitsStart, toSearchParams } from '../../lib/seo/initial-data';
import { statsPendingCss } from '../../lib/seo/stats-pending';
import UnitsClient, { type UnitRow } from './UnitsClient';

// Server-Huelle der Units-Liste (SEO-Plan Schritt 3): die Standardansicht kommt
// mit Namen und Zahlen im ersten HTML, die Liste selbst bleibt die
// Client-Komponente von vorher. Ohne vorgerechneten Stand (oder nach 1,5 s)
// laedt sie wie bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const start = await unitsStart<UnitRow>(toSearchParams(await searchParams));
  return (
    <>
      {/* Gespeicherte Filter (E3): blendet die Server-Zahlen aus, solange das
          Vorab-Skript im Wurzel-Layout ein Merkmal gesetzt hat. Als roher Text,
          damit die Anfuehrungszeichen im Selektor unveraendert ankommen. */}
      <style dangerouslySetInnerHTML={{ __html: statsPendingCss(start.filters.bucketAuto ? start.filters.bucket : null) }} />
      <UnitsClient initialFilters={start.filters} initial={start.data} />
    </>
  );
}

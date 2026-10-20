import { compDeltaStart, compsStart, toSearchParams } from '../../../lib/seo/initial-data';
import { statsPendingCss } from '../../../lib/seo/stats-pending';
import type { CompApiRow } from '../../../lib/tft-comp-families';
import AtlasClient from './AtlasClient';

// Server-Huelle der Comp-Uebersicht (TFT-Startseite seit 15.10.2026, User
// „Übersicht + Zahlen sofort"): Kacheln, Namen und Links kommen mit dem ersten
// HTML. Dieselben Startdaten wie die Liste (compsStart, gleicher Speicher-
// Eintrag) — die Uebersicht zeigt dieselben 40 Familien ohne Doppelungen.
// Ohne vorgerechneten Stand (oder nach 1,5 s) laedt sie wie bisher im Browser.
// Titel/Beschreibung: layout.tsx.
export default async function Page({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const start = await compsStart<CompApiRow>(toSearchParams(sp));
  // Pfeile „vs Vorpatch" gleich mit (nur die gezeigten Familien, Box-Dateien).
  const delta = await compDeltaStart(start.filters, start.data);
  // Ansicht „Tier" (?group=tier) schon im ersten HTML; aendert keine Daten.
  const group = sp.group === 'tier' ? 'tier' : 'cost';
  return (
    <>
      {/* Gespeicherte Filter (E3): blendet die Server-Kacheln aus, solange das
          Vorab-Skript im Wurzel-Layout ein Merkmal gesetzt hat. */}
      <style dangerouslySetInnerHTML={{ __html: statsPendingCss(start.filters.bucketAuto ? start.filters.bucket : null) }} />
      <AtlasClient initialFilters={start.filters} initial={start.data} initialDelta={delta} initialGroup={group} />
    </>
  );
}

import { patchListStart } from '../../lib/seo/page-start-tft';
import PatchListClient from './PatchListClient';

// Server-Huelle der Patch-Uebersicht (Soft-404-Plan 26.10.2026): die Patchliste
// der letzten 180 Tage im ersten HTML. Ohne Antwort in 1,5 s laedt sie wie
// bisher im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  return <PatchListClient initialPatches={await patchListStart()} />;
}

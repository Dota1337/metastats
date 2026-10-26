import { tftMarktwertStart } from '../../lib/seo/page-start-mirror';
import TftMarktwertClient, { type LeaderboardPlayer, type TftMarktwertInitial } from './TftMarktwertClient';

// Server-Huelle des TFT-Marktwerts (Soft-404-Plan 26.10.2026): Top 100 von
// EUW samt Verlaeufen aus den Dateien der Box im ersten HTML. Fehlt ein Teil,
// laedt die Seite nur diesen im Browser. Titel/Beschreibung: layout.tsx.
export default async function Page() {
  const { list, sparks } = await tftMarktwertStart<
    { players: LeaderboardPlayer[] },
    NonNullable<TftMarktwertInitial['sparks']>
  >();
  return <TftMarktwertClient initial={{ list: list?.body ?? null, sparks: sparks?.body ?? null }} />;
}

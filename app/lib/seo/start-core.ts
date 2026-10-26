import 'server-only';
// Kern der Startdaten fuer die Uebersichtsseiten (Google „Soft 404", Plan
// 26.10.2026): Rangliste, Marktwerte, Teams, Ligen, Augments, Patches, Rising,
// Turniere, Builder und die LoL-Startseite bringen ihre Standardansicht im
// ersten HTML mit. Bewusst OHNE Daten-Importe — jede Seite zieht nur den Lader
// ihrer Quelle (page-start-mirror.ts, page-start-tft.ts, page-start-teams.ts),
// sonst kaemen die TFT-Bundles (je ~2 MB) in die LoL-Funktionen (lol-data.ts:4-5).
//
// Regeln wie bei den Detailseiten (initial-data.ts):
//   - Nur vorgerechnete Quellen (Datei der Box, Repo-Datei, Asset-Bundle),
//     nie der Live-Weg der API.
//   - Jede Stoerung, jedes Zeitlimit → null → die Seite laedt wie bisher im
//     Browser. Nie leere oder erfundene Zahlen.
//   - Notschalter: SEO_PAGE_START=0 nur fuer diese Seiten, SEO_START_DATA=0
//     fuer alle Startdaten.
export { withTimeout } from '../og/frame';

/** Hoechstens so lange je Lesevorgang (Blob ~0,1-0,25 s gemessen). */
export const PAGE_START_READ_MS = 800;
/** Hoechstens so lange fuer alle Schritte einer Seite zusammen. */
export const PAGE_START_BUDGET_MS = 1500;

export function pageStartOn(): boolean {
  return process.env.SEO_START_DATA !== '0' && process.env.SEO_PAGE_START !== '0';
}

// Treffer je Prozess kurz merken: Google ruft eine Seite oft in allen sechs
// Sprachen hintereinander ab. Nur Treffer, nie null — ein Fehlschlag wird beim
// naechsten Aufruf neu versucht.
const MEMO_TTL_MS = 60_000;
const MEMO_MAX = 32;
const memo = new Map<string, { at: number; value: unknown }>();

export async function rememberStart<T>(key: string, load: () => Promise<T | null>): Promise<T | null> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value as T;
  const value = await load();
  if (value != null) {
    memo.delete(key);
    memo.set(key, { at: Date.now(), value });
    while (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
  }
  return value;
}

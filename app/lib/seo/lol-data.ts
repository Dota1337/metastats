import 'server-only';
// Startdaten der LoL-Champion-Liste (SEO-Plan Schritt 6): Namen, Zahlen und
// Links stehen gleich im ersten HTML, statt erst nach dem Abruf im Browser.
// Die Detailseite hat ihren eigenen Lader (lol-detail-data.ts) — sonst zoege
// sie die Sammel-Dateien der Liste (2,2 MB) in ihre Funktion.
//
// Gleiche Regeln wie initial-data.ts / detail-data.ts: hoechstens 1,5 s, nie
// die Datenbank (die Builds auf der Detailseite laedt weiter der Browser),
// Notschalter SEO_START_DATA=0. Startdaten sind immer genau das, was der
// Browser selbst bekaeme — sonst springen die Zahlen.
import { withTimeout } from '../og/frame';
import { loadChampionList } from '../lol-champion-list';
import { CHAMPION_LIST_DEFAULTS, type ChampionListPayload } from '../lol-champion-filters';

const BUDGET_MS = 1500;

/** Liste in der Standardansicht (alle Raenge, alle Rollen, EUW); null = Browser laedt wie bisher. */
export async function championListStart(): Promise<ChampionListPayload | null> {
  if (process.env.SEO_START_DATA === '0') return null;
  const result = await withTimeout(loadChampionList(CHAMPION_LIST_DEFAULTS), BUDGET_MS);
  // Ein Stand ohne Zahlen ist die stille Stoerung der Route — den rendert der
  // Server nicht, der Browser fragt dann selbst (und bekommt ggf. die Meldung).
  if (!result || result.degraded) return null;
  return result.payload;
}

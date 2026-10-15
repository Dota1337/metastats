import 'server-only';
// Startdaten der LoL-Champion-Detailseite (SEO-Plan Schritt 6): Name,
// Faehigkeiten, Tipps und Lore in der Sprache des Besuchers stehen gleich im
// ersten HTML. Regeln wie lol-data.ts: hoechstens 1,5 s, nie die Datenbank
// (die Builds laedt weiter der Browser), Notschalter SEO_START_DATA=0.
import type { Lang } from '../i18n';
import { withTimeout } from '../og/frame';
import { getLatestDdragonVersion, DDRAGON_TIMEOUT_MS } from '../ddragon-version-server';
import { championDetailUrl, pickChampionDetail, type ChampionDetailStart } from '../lol-champion-detail';

const BUDGET_MS = 1500;
const CHAMPION_ID = /^[A-Za-z]+$/;

/** Champion in der Sprache des Besuchers; null = Browser laedt wie bisher. */
export async function championDetailStart(id: string, lang: Lang): Promise<ChampionDetailStart | null> {
  if (process.env.SEO_START_DATA === '0' || !CHAMPION_ID.test(id)) return null;
  const load = async (): Promise<ChampionDetailStart | null> => {
    const version = await getLatestDdragonVersion();
    if (!version) return null;
    // Data Cache: die Adresse traegt Version und Sprache, der Inhalt aendert sich nie.
    const res = await fetch(championDetailUrl(version, lang, id), {
      signal: AbortSignal.timeout(DDRAGON_TIMEOUT_MS),
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    const champion = pickChampionDetail(await res.json(), id);
    return champion ? { id, lang, version, champion } : null;
  };
  return withTimeout(load(), BUDGET_MS);
}

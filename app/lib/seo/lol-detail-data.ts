import 'server-only';
// Startdaten der LoL-Champion-Detailseite (SEO-Plan Schritt 6): Name,
// Faehigkeiten, Tipps und Lore in der Sprache des Besuchers stehen gleich im
// ersten HTML. Regeln wie lol-data.ts: hoechstens 1,5 s, nie die Datenbank,
// Notschalter SEO_START_DATA=0. Seit Nachtrag 8 auch die Builds der
// Standardansicht — aus der vorgerechneten Datei, mit eigenem Zeitlimit, damit
// ein langsamer Blob nicht auch Lore und Faehigkeiten mitreisst.
import type { Lang } from '../i18n';
import { withTimeout } from '../og/frame';
import { getLatestDdragonVersion, DDRAGON_TIMEOUT_MS } from '../ddragon-version-server';
import { championDetailUrl, pickChampionDetail, type ChampionDetailStart } from '../lol-champion-detail';
import { loadLolBuildsSnapshot } from '../lol-builds-snapshot';
import { buildsAssetsFrom, usedBuildsIds, type ChampionBuildsStart } from '../lol-builds-view';

const BUDGET_MS = 1500;
// Gleiche Form wie champion-gate.ts (ID_SHAPE).
const CHAMPION_ID = /^[A-Za-z0-9_]+$/;

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

/* eslint-disable @typescript-eslint/no-explicit-any -- rohes Data-Dragon-JSON */
/**
 * Builds der Standardansicht (euw1 + EMERALD_PLUS) samt der Namen, die sie
 * zeigt; null = der Block laedt wie bisher im Browser. Den Zahl-Key liefert
 * champion.json (en_US) — dieselbe Datei braucht der Block fuer die Konter-Namen.
 */
export async function championBuildsStart(id: string): Promise<ChampionBuildsStart | null> {
  if (process.env.SEO_START_DATA === '0' || !CHAMPION_ID.test(id)) return null;
  const load = async (): Promise<ChampionBuildsStart | null> => {
    const version = await getLatestDdragonVersion();
    if (!version) return null;
    // Data Cache wie oben: Adresse traegt die Version, der Inhalt aendert sich nie.
    const dd = async (file: string): Promise<any> => {
      const res = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/${file}`, {
        signal: AbortSignal.timeout(DDRAGON_TIMEOUT_MS),
        next: { revalidate: 86400 },
      });
      return res.ok ? res.json() : null;
    };
    const champs = await dd('champion.json');
    const key = champs?.data && Object.hasOwn(champs.data, id) ? champs.data[id]?.key : null;
    if (typeof key !== 'string') return null;
    const [data, runes, summoners] = await Promise.all([loadLolBuildsSnapshot(key), dd('runesReforged.json'), dd('summoner.json')]);
    // Ohne Namen stuenden Runen leer und Konter als Zahl da — dann lieber gar nicht.
    if (!data || !Array.isArray(runes) || !summoners?.data) return null;
    return { data, assets: buildsAssetsFrom(runes, summoners.data, champs.data, usedBuildsIds(data)) };
  };
  return withTimeout(load().catch(() => null), BUDGET_MS);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

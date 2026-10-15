// Cached Data Dragon asset lookups (rune trees + summoner spells).
// Each fetch returns the same Promise across components for a given version.
import { buildsAssetsFrom, type SummonerInfo } from './lol-builds-view';

export interface RuneInfo { name: string; icon: string }
// Zaubernamen nach derselben Regel wie der Builds-Block („Flash“, nicht „SummonerFlash“).
export type { SummonerInfo };

const runeCache: Record<string, Promise<Record<number, RuneInfo>>> = {};
const summonerCache: Record<string, Promise<Record<number, SummonerInfo>>> = {};

export function loadRuneIndex(version: string): Promise<Record<number, RuneInfo>> {
  if (!version) return Promise.resolve({});
  if (!runeCache[version]) {
    runeCache[version] = fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`)
      .then(r => r.ok ? r.json() : [])
      .then((trees: any[]) => {
        const idx: Record<number, RuneInfo> = {};
        for (const tree of trees) {
          idx[tree.id] = { name: tree.name, icon: tree.icon };
          for (const slot of tree.slots || []) {
            for (const r of slot.runes || []) {
              idx[r.id] = { name: r.name, icon: r.icon };
            }
          }
        }
        return idx;
      })
      .catch(() => ({}));
  }
  return runeCache[version];
}

export function loadSummonerIndex(version: string): Promise<Record<number, SummonerInfo>> {
  if (!version) return Promise.resolve({});
  if (!summonerCache[version]) {
    summonerCache[version] = fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`)
      .then(r => r.ok ? r.json() : null)
      // `data`, nicht die ganze Antwort — sonst bleibt die Liste still leer.
      .then((json: { data?: unknown } | null) => buildsAssetsFrom(null, json?.data, null).summoners)
      .catch(() => ({}));
  }
  return summonerCache[version];
}

export const RUNE_IMG_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/';

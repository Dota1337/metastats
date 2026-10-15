// Form der Builds-Antwort (app/api/champions/[id]/builds) und die Namen dazu
// aus Data Dragon (Runen, Zauber, Champions). Eine Regel fuer Browser
// (ChampionBuildsSection: volle Listen) und Server (seo/lol-detail-data.ts:
// nur die Eintraege, die die Startdaten wirklich zeigen — das spart im ersten
// HTML gut 20 KB). Rein, ohne Abrufe.

export interface BuildEntry { items: number[]; games: number; wins: number }
export interface ItemEntry { item: number; games: number; wins: number }
export interface RuneEntry {
  primary: number; keystone: number;
  p1: number; p2: number; p3: number;
  secondary: number; s1: number; s2: number;
  off: number; flex: number; def: number;
  games: number; wins: number;
}
export interface KeystoneEntry { id: number; games: number; wins: number }
export interface SummonerEntry { spells: number[]; games: number; wins: number }
export interface CounterEntry { enemy: string; gamesAgainst: number; lossesAgainst: number }
export type Verdict = 'core' | 'important' | 'optional' | 'weak';
export interface RoleData {
  games: number; wins: number;
  topBuilds: BuildEntry[];
  topBoots: ItemEntry[];
  topItems: ItemEntry[];
  topRunes: RuneEntry[];
  topKeystones: KeystoneEntry[];
  topSummoners: SummonerEntry[];
  counters: { strongAgainst: CounterEntry[]; weakAgainst: CounterEntry[] };
  itemVerdicts?: Record<string, { verdict: Verdict; delta: number | null }>;
}
export interface BuildsResponse {
  championKey: string;
  region: string;
  hasBuilds: boolean;
  collectedAt?: string;
  ddragonVersion?: string;
  matchesAnalyzed?: number;
  roles: Record<string, RoleData>;
  source?: 'db' | 'json';
  rank?: string | null;
  patch?: string;
}

export interface RuneInfo { name: string; icon: string }
export interface SummonerInfo { id: number; key: string; iconFile: string }
export interface ChampionInfo { key: string; id: string; name: string; image: string }
export interface BuildsAssets {
  /** Baum- und Runen-Kennung → Name + Bild */
  runeIndex: Record<number, RuneInfo>;
  /** Zahl-Key des Zaubers → Data-Dragon-Kennung + Bild */
  summoners: Record<number, SummonerInfo>;
  /** Zahl-Key des Champions → Name + Bild (Konter-Listen) */
  championMap: Record<string, ChampionInfo>;
}

/** Startdaten des Builds-Blocks: Standardansicht + die Namen, die sie zeigt. */
export interface ChampionBuildsStart { data: BuildsResponse; assets: BuildsAssets }

export const EMPTY_BUILDS_ASSETS: BuildsAssets = { runeIndex: {}, summoners: {}, championMap: {} };

/** Kennungen, die der Block fuer diese Antwort anzeigen kann. */
export function usedBuildsIds(data: BuildsResponse) {
  const runes = new Set<number>(), summoners = new Set<number>(), champions = new Set<string>();
  for (const r of Object.values(data.roles || {})) {
    for (const rune of r.topRunes || []) {
      for (const id of [rune.primary, rune.keystone, rune.p1, rune.p2, rune.p3, rune.secondary, rune.s1, rune.s2]) runes.add(id);
    }
    for (const k of r.topKeystones || []) runes.add(k.id);
    for (const s of r.topSummoners || []) for (const id of s.spells) summoners.add(id);
    for (const c of [...(r.counters?.strongAgainst || []), ...(r.counters?.weakAgainst || [])]) champions.add(String(c.enemy));
  }
  return { runes, summoners, champions };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- rohes Data-Dragon-JSON */
/**
 * Namen aus runesReforged.json, summoner.json (`data`) und champion.json
 * (`data`). Mit `only` nur die benutzten Eintraege (Server), ohne alle (Browser).
 * Kaputte Eingaben ergeben leere Teile, nie einen Fehler.
 */
export function buildsAssetsFrom(
  runeTrees: unknown, summonerData: unknown, championData: unknown,
  only?: ReturnType<typeof usedBuildsIds>,
): BuildsAssets {
  const runeIndex: Record<number, RuneInfo> = {};
  for (const tree of Array.isArray(runeTrees) ? runeTrees as any[] : []) {
    if (!only || only.runes.has(tree?.id)) runeIndex[tree.id] = { name: tree.name, icon: tree.icon };
    for (const slot of tree?.slots || []) {
      for (const r of slot?.runes || []) {
        if (!only || only.runes.has(r?.id)) runeIndex[r.id] = { name: r.name, icon: r.icon };
      }
    }
  }
  const summoners: Record<number, SummonerInfo> = {};
  for (const s of Object.values((summonerData || {}) as Record<string, any>)) {
    const id = Number(s?.key);
    if (Number.isFinite(id) && s?.image?.full && (!only || only.summoners.has(id))) {
      summoners[id] = { id, key: s.id, iconFile: s.image.full };
    }
  }
  const championMap: Record<string, ChampionInfo> = {};
  for (const c of Object.values((championData || {}) as Record<string, any>)) {
    if (typeof c?.key === 'string' && c?.image?.full && (!only || only.champions.has(c.key))) {
      championMap[c.key] = { key: c.key, id: c.id, name: c.name, image: c.image.full };
    }
  }
  return { runeIndex, summoners, championMap };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

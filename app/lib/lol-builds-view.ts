// Form der Builds-Antwort (app/api/champions/[id]/builds) und die Namen dazu
// aus Data Dragon (Runen, Zauber, Champions). Eine Regel fuer Browser
// (ChampionBuildsSection: volle Listen) und Server (seo/lol-detail-data.ts:
// nur die Eintraege, die die Startdaten wirklich zeigen — das spart im ersten
// HTML gut 20 KB). Rein, ohne Abrufe.
//
// Item-Namen gehen einen anderen Weg: sie reisen als `itemNames` in der
// Antwort selbst (Route, app/lib/lol-item-names.ts) und damit auch in der
// Blob-Datei. Die Bilder brauchen keinen Nachschlag (`item/<id>.png`), und
// item.json kostet den Browser 100 KB gzip — doppelt so viel wie die drei
// Listen oben zusammen (49 KB, gemessen 15.10.2026). Englisch wie die Runen;
// sollen die Namen je Besuchersprache kommen, muessen sie hierher umziehen.

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
  /** Item-Kennung → englischer Name, nur fuer die Items dieser Antwort. Fehlt bei Data-Dragon-Ausfall. */
  itemNames?: Record<string, string>;
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

export type ItemLists = { topBuilds?: { items?: number[] }[]; topBoots?: { item: number }[]; topItems?: { item: number }[] };

/** Item-Kennungen, deren Bild der Block zeigt (Builds, Stiefel, Items). 0 = leerer Platz. */
export function usedItemIds(data: { roles?: Record<string, ItemLists | undefined> }): Set<number> {
  const ids = new Set<number>();
  for (const r of Object.values(data.roles || {})) {
    for (const b of r?.topBuilds || []) for (const id of b.items || []) if (id > 0) ids.add(id);
    for (const e of [...(r?.topBoots || []), ...(r?.topItems || [])]) if (e.item > 0) ids.add(e.item);
  }
  return ids;
}

/**
 * Namen aus item.json (`data`) fuer genau diese Kennungen. Einige Namen tragen
 * Riots Auszeichnungen (`<rarityLegendary>…`) — die fliegen raus; leere Namen
 * fehlen, dann zeigt der Block „Item N“. Kaputte Eingaben ergeben {}.
 */
export function itemNamesFrom(itemData: unknown, ids: Iterable<number>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!itemData || typeof itemData !== 'object') return out;
  for (const id of ids) {
    const raw = (itemData as Record<string, { name?: unknown } | undefined>)[String(id)]?.name;
    const name = typeof raw === 'string' ? raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (name) out[String(id)] = name;
  }
  return out;
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

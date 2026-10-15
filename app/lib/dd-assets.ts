// Cached Data Dragon asset lookups (rune trees + summoner spells).
// Each fetch returns the same Promise across components for a given version.
import { buildsAssetsFrom, type SummonerInfo } from './lol-builds-view';

export interface RuneInfo { name: string; icon: string }
// Zaubernamen nach derselben Regel wie der Builds-Block („Flash“, nicht „SummonerFlash“).
export type { SummonerInfo };

const runeCache: Record<string, Promise<Record<number, RuneInfo>>> = {};

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

// Zauberliste: faellt ein Abruf aus, versucht der Loader es selbst erneut (nach 1, 3
// und 9 s, je Versuch 5 s Zeitlimit) — endgueltig ist nur eine 4xx-Antwort ausser 429
// (unbekannte Version = 403). Ein Fehlschlag, auch eine leere Liste, gilt 60 s; danach
// laedt der naechste Aufrufer neu, wie lol-item-names.ts. Alle Aufrufer einer Version
// teilen sich dieselbe Kette, deshalb nie das Abbruch-Signal einer Komponente hineingeben.
const RETRY_DELAYS_MS = [1000, 3000, 9000];
const TRY_TIMEOUT_MS = 5000;
const FAIL_MS = 60_000;

/** Nur fuer Tests: Uhr, Pausen und Zeitlimit ersetzbar. */
export interface LoadOpts { now?: number; delays?: number[]; timeoutMs?: number }

interface Entry<T> { value: Promise<T>; failedAt?: number }
const summonerCache = new Map<string, Entry<Record<number, SummonerInfo>>>();

/** Inhalt einer Data-Dragon-Datei, oder undefined. Wirft nie. */
async function fetchDdJson(url: string, delays: number[], timeoutMs: number): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return await res.json();
      if (res.status < 500 && res.status !== 429) return undefined;
    } catch {
      // Netzfehler, Zeitlimit, abgebrochene Antwort: noch einmal.
    }
    if (attempt >= delays.length) return undefined;
    await new Promise((r) => setTimeout(r, delays[attempt]));
  }
}

function cachedLoad<T extends object>(
  cache: Map<string, Entry<T>>, version: string, url: string, parse: (json: unknown) => T, opts: LoadOpts,
): Promise<T> {
  if (!version) return Promise.resolve({} as T);
  const hit = cache.get(version);
  const now = opts.now ?? Date.now();
  if (hit && !(hit.failedAt !== undefined && now - hit.failedAt > FAIL_MS)) return hit.value;
  const entry = {} as Entry<T>;
  entry.value = fetchDdJson(url, opts.delays ?? RETRY_DELAYS_MS, opts.timeoutMs ?? TRY_TIMEOUT_MS).then((json) => {
    let table: T | null = null;
    try { if (json !== undefined) table = parse(json); } catch { /* fremdes Format = Fehlschlag */ }
    if (table && Object.keys(table).length) return table;
    entry.failedAt = Date.now();
    return {} as T;
  });
  cache.set(version, entry);
  return entry.value;
}

export function loadSummonerIndex(version: string, opts: LoadOpts = {}): Promise<Record<number, SummonerInfo>> {
  return cachedLoad(
    summonerCache,
    version,
    `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`,
    // `data`, nicht die ganze Antwort — sonst bleibt die Liste still leer.
    (json) => buildsAssetsFrom(null, (json as { data?: unknown } | null)?.data, null).summoners,
    opts,
  );
}

export const RUNE_IMG_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/';

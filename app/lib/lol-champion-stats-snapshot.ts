import 'server-only';
// Liest die Champion-Zahlen der Box (EUW) aus dem Blob: Champion-Liste
// (lol-champion-list.ts) und LoL-Startseite (api/homepage-stats). Geschrieben
// von scripts/aggregate-lol-builds.mjs alle 6 h; Pfad und Pruefregel:
// lol-champion-stats-blob.mjs.
//
// Die Seite /champions wird nicht zwischengespeichert, jeder Aufruf kaeme sonst
// an diesem Abruf vorbei (19–186 ms gemessen). Deshalb je Prozess gemerkt:
// frisch 10 min, danach der alte Stand sofort und im Hintergrund nachgeladen;
// immer nur ein Abruf, ein Fehlschlag wird 60 s gemerkt; eigenes Zeitlimit
// 800 ms (Startdaten-Budget der Seite 1,5 s, seo/lol-data.ts).
// Notschalter LOL_CHAMPION_STATS_BOX=0: beide Leser nehmen wieder die Wochendatei.
import { isValidLolChampionStats, LOL_CHAMPION_STATS_PATH } from './lol-champion-stats-blob.mjs';
import type { ChampStat } from './champion-tier-stats';

export interface LolChampionStatsTier {
  matches: number;
  participants: number;
  banMatches: number;
  champions: Record<string, ChampStat>;
}
export interface LolChampionStatsFile {
  version: 1;
  source: 'box';
  region: string;
  builtAt: string;
  dataNewest: string;
  matchesAnalyzed: number;
  patches: { patch: string; tiers: Record<string, LolChampionStatsTier> }[];
  roles: Record<string, Record<string, number>>;
}

/** off = Notschalter; unavailable = sollte da sein, kam aber nicht (Antwort dann als degradiert markieren). */
export type LolChampionStatsResult =
  | { status: 'ok'; file: LolChampionStatsFile }
  | { status: 'off' | 'unavailable' };

const FRESH_MS = 10 * 60_000;
const FAIL_MS = 60_000;
const TIMEOUT_MS = 800;

let memo: { file: LolChampionStatsFile; at: number } | null = null;
let inflight: Promise<void> | null = null;
let failedAt = 0;

function blobOrigin(): string | null {
  try {
    const url = process.env.SNAPSHOT_MANIFEST_URL;
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const origin = blobOrigin();
  if (!origin) { failedAt = Date.now(); return; }
  try {
    const res = await fetch(`${origin}/${LOL_CHAMPION_STATS_PATH}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const body: unknown = res.ok ? await res.json() : null;
    if (isValidLolChampionStats(body)) {
      memo = { file: body as LolChampionStatsFile, at: Date.now() };
      return;
    }
  } catch {
    // Zeitlimit, Netz, kaputtes JSON: wie eine fehlende Datei
  }
  failedAt = Date.now();
}

function current(): LolChampionStatsResult {
  // Auch der gemerkte Stand altert: nach 7 Tagen nicht mehr benutzen.
  return memo && isValidLolChampionStats(memo.file) ? { status: 'ok', file: memo.file } : { status: 'unavailable' };
}

export async function loadLolChampionStats(): Promise<LolChampionStatsResult> {
  if (process.env.LOL_CHAMPION_STATS_BOX === '0') return { status: 'off' };
  const now = Date.now();
  if (memo && now - memo.at < FRESH_MS) return current();
  if (!inflight && now - failedAt >= FAIL_MS) {
    inflight = refresh().finally(() => { inflight = null; });
  }
  if (memo) return current();
  if (inflight) await inflight;
  return current();
}

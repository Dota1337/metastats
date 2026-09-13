// Server-side loader for the TFT stats and knowledge-graph JSON files. The
// crawler writes tft-stats-{region}.json + tft-graph-{region}.json into
// /public on every Saturday run; this helper reads them off disk for the
// /api/tft/* routes. In-process cache so concurrent requests don't re-read.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { CURRENT_SET } from './current-set';
import { TFT_RANK_GROUPS, tftStatsBucket } from './rank-groups';

interface CacheEntry<T> { data: T; mtime: number }
const cache = new Map<string, CacheEntry<any>>();

function readCached<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  // Cheap freshness check: re-read if file changed (mtime diff). Keeps the
  // cache valid across hot reloads without ever serving stale data.
  const fs = require('fs') as typeof import('fs');
  const stat = fs.statSync(path);
  const cached = cache.get(path);
  if (cached && cached.mtime === stat.mtimeMs) return cached.data as T;
  try {
    const data = JSON.parse(readFileSync(path, 'utf8')) as T;
    cache.set(path, { data, mtime: stat.mtimeMs });
    return data;
  } catch {
    return null;
  }
}

// Set-Waechter (2026-08-27). Die tft-stats-*.json entstehen nur im
// Wochenlauf (.github/workflows/tft-weekly-crawl.yml:78, nur euw1); der
// Tageslauf laeuft mit --no-json. Nach einem Set-Start tragen die Dateien
// deshalb tagelang das ALTE Set — gemessen am 2026-08-27: 10 von 10
// geprueften Dateien "set": 17, obwohl Set 18 am 26.08. startete.
//
// Ausgeliefert wurde das als aktuelle Statistik. Ab jetzt liefert der Loader
// in dem Fall null; die Aufrufer haben dafuer bereits einen Pfad (Rueckfall
// auf den set-korrekten RPC bzw. leerer Zustand). Lieber keine Zahl als die
// Zahl des Vorsets.
export function loadTftStats(region: string) {
  const data = readCached<any>(join(process.cwd(), 'public', `tft-stats-${region.toLowerCase()}.json`));
  if (data && typeof data.set === 'number' && data.set !== CURRENT_SET) return null;
  return data;
}

export function loadTftGraph(region: string) {
  return readCached<any>(join(process.cwd(), 'public', `tft-graph-${region.toLowerCase()}.json`));
}

export const VALID_BUCKETS = new Set([
  'all', ...Object.keys(TFT_RANK_GROUPS),
  'iron','bronze','silver','gold','platinum','emerald','diamond',
  'master','grandmaster','challenger',
]);

// Alte Links mit ?bucket=master / diamond … zeigen seit 2026-09-13 die
// Gruppe (Master+ / Diamond+ …), weil es die Einzelwahl nicht mehr gibt.
export function normalizeBucket(b: string | null): string {
  if (!b) return 'master_plus';
  const v = tftStatsBucket(b.toLowerCase());
  return VALID_BUCKETS.has(v) ? v : 'master_plus';
}

// Rang-Gruppen ausser master_plus stehen nicht als eigener Eintrag in der
// Statistik-Datei. Die Rang-Eintraege der Gruppe (z.B. byUnit[id].diamond,
// .master, .grandmaster, .challenger) werden hier zu
// einem zusammengezaehlt: Zahlen addieren, Listen je Schluessel (item,
// Item-Satz, characterId) zusammenfuehren und neu nach games sortieren.
// Verteilungen (damageByTier: p50 etc.) lassen sich nicht addieren → null.
// Die Listen sind je Rang auf Top-N gekappt, das Ende der Summe ist daher
// leicht unscharf (Plan F1, vom User freigegeben).
const NOT_SUMMABLE = new Set(['damageByTier']);
const listKey = (e: any): string | null =>
  e?.item != null ? `i:${e.item}`
  : Array.isArray(e?.items) ? `s:${e.items.join('|')}`
  : e?.characterId != null ? `c:${e.characterId}`
  : null;

export function mergeStatsEntries(a: any, b: any): any {
  if (a == null) return b ?? null;
  if (b == null) return a;
  if (typeof a === 'number' && typeof b === 'number') return a + b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const byKey = new Map<string, any>();
    for (const e of [...a, ...b]) {
      const k = listKey(e);
      if (k == null) continue;
      byKey.set(k, byKey.has(k) ? mergeStatsEntries(byKey.get(k), e) : { ...e });
    }
    return [...byKey.values()].sort((x, y) => (y.games ?? y.count ?? 0) - (x.games ?? x.count ?? 0));
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const out: any = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (NOT_SUMMABLE.has(k)) { out[k] = null; continue; }
      // Schluessel wie item/characterId/items identifizieren den Eintrag.
      if (k === 'item' || k === 'characterId' || k === 'items') { out[k] = a[k] ?? b[k]; continue; }
      out[k] = mergeStatsEntries(a[k], b[k]);
    }
    return out;
  }
  return a;
}

/** Rang-Eintrag aus byUnit/byItem lesen; eine Gruppe = Summe ihrer Einzelraenge. */
export function pickBucketEntry(buckets: any, bucket: string): any {
  if (!buckets) return null;
  // Vorhandener Eintrag (all, master_plus, Einzelrang) hat Vorrang.
  if (buckets[bucket]) return buckets[bucket];
  const members = TFT_RANK_GROUPS[bucket];
  if (members) {
    return members.reduce((acc: any, m) => mergeStatsEntries(acc, buckets[m] ?? null), null) || null;
  }
  return buckets.all || null;
}

// Number of *participants* in a tier-bucket — used as the denominator when
// turning per-unit/item/augment/trait games into a pick rate.
//
// Prefers the explicit `participantsByBucket` field if the crawler emitted it
// (added 2026-05-11; older JSONs don't have it). Falls back to summing
// byComp[…].games which is the participant-count of every classified board.
// The fallback under-counts by ~3% because byComp drops clusters below
// minCompGames=8, but it's the closest available proxy and stable across runs.
export function bucketParticipants(stats: any, bucket: string): number {
  if (stats?.participantsByBucket?.[bucket] != null) {
    return stats.participantsByBucket[bucket];
  }
  // Rang-Gruppe ohne eigenen Eintrag: Teilnehmer der Einzelraenge addieren.
  const members = TFT_RANK_GROUPS[bucket];
  if (members && stats?.participantsByBucket) {
    return members.reduce((s, m) => s + (Number(stats.participantsByBucket[m]) || 0), 0);
  }
  let total = 0;
  for (const buckets of Object.values<any>(stats?.byComp || {})) {
    const b = buckets?.[bucket];
    if (b) total += b.games;
  }
  return total;
}

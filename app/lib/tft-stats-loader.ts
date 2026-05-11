// Server-side loader for the TFT stats and knowledge-graph JSON files. The
// crawler writes tft-stats-{region}.json + tft-graph-{region}.json into
// /public on every Saturday run; this helper reads them off disk for the
// /api/tft/* routes. In-process cache so concurrent requests don't re-read.

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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

export function loadTftStats(region: string) {
  return readCached<any>(join(process.cwd(), 'public', `tft-stats-${region.toLowerCase()}.json`));
}

export function loadTftGraph(region: string) {
  return readCached<any>(join(process.cwd(), 'public', `tft-graph-${region.toLowerCase()}.json`));
}

export const VALID_BUCKETS = new Set([
  'all', 'master_plus',
  'iron','bronze','silver','gold','platinum','emerald','diamond',
  'master','grandmaster','challenger',
]);

export function normalizeBucket(b: string | null): string {
  if (!b) return 'master_plus';
  const v = b.toLowerCase();
  return VALID_BUCKETS.has(v) ? v : 'master_plus';
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
  let total = 0;
  for (const buckets of Object.values<any>(stats?.byComp || {})) {
    const b = buckets?.[bucket];
    if (b) total += b.games;
  }
  return total;
}

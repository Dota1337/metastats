// Snapshot-Lookup für vorgerenderte API-Responses.
//
// POC-Stand: ein einziger Snapshot für den Default-Filter von /api/tft/comps,
// abgelegt unter `public/snapshots/tft/comps/v1-default.json`. Beim API-Hit
// wird das File per FS-Read geliefert — kein Supabase-Roundtrip, keine schwere
// RPC. Wenn der Beweis steht, expandieren wir auf alle Hot-Path-Permutationen
// und können den Storage später auf Vercel-Blob umstellen ohne API-Änderung.

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SNAPSHOT_ROOT = path.join(process.cwd(), 'public', 'snapshots');

interface CachedSnapshot {
  payload: unknown;
  mtimeMs: number;
  readAt: number;
}

// Process-weit memoized — pro Prozess wird jedes File maximal einmal vom Disk
// gelesen. Zweiter Hit ist reiner Map-Lookup.
const cache = new Map<string, CachedSnapshot>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface CompFilterKey {
  patch: string;            // resolved patch string, z.B. "17.4"
  region: string;           // 'all' | 'west' | 'asia' | 'euw1' | ...
  days: number;             // 1..7
  bucket: string;           // 'master_plus' | 'all' | ...
  minGames: number;
  source: string;           // 'data' | 'editorial' | 'all'
  velocityShift: number;    // 0 = no velocity overlay
}

// POC: genau der Default-Filter wird vom Publisher pre-gerendert. Wenn die
// Anfrage exakt diesem Filter entspricht, gibt es einen Snapshot-Treffer.
// Velocity-Overlays und Slug-Detail-Calls werden NICHT bedient — die fallen
// auf den existierenden Live-Calc-Pfad zurück.
const POC_DEFAULT: Omit<CompFilterKey, 'patch'> = {
  region: 'all',
  days: 3,
  bucket: 'master_plus',
  minGames: 30,
  source: 'data',
  velocityShift: 0,
};

export function matchesPocDefault(key: CompFilterKey): boolean {
  return key.region === POC_DEFAULT.region
    && key.days === POC_DEFAULT.days
    && key.bucket === POC_DEFAULT.bucket
    && key.minGames === POC_DEFAULT.minGames
    && key.source === POC_DEFAULT.source
    && key.velocityShift === POC_DEFAULT.velocityShift;
}

export function readSnapshot(relativePath: string): unknown | null {
  const full = path.join(SNAPSHOT_ROOT, relativePath);
  if (!existsSync(full)) return null;
  const hit = cache.get(full);
  if (hit && Date.now() - hit.readAt < CACHE_TTL_MS) return hit.payload;
  try {
    const raw = readFileSync(full, 'utf8');
    const payload = JSON.parse(raw);
    cache.set(full, { payload, mtimeMs: 0, readAt: Date.now() });
    return payload;
  } catch {
    return null;
  }
}

export function readCompDefaultSnapshot(patch: string): { snapshot: any; tag: string } | null {
  const payload = readSnapshot(`tft/comps/v1-default.json`) as any;
  if (!payload) return null;
  // Validate that the snapshot matches the requested patch — if the crawler
  // hasn't rebuilt for the current patch yet, skip the snapshot rather than
  // serve stale data.
  if (payload?.filters?.patch && payload.filters.patch !== patch) return null;
  return { snapshot: payload, tag: 'comps-v1-default' };
}

// Liest die vorgerechneten Patch-Vergleiche fuer Meta-Pulse (region=all).
// Geschrieben von scripts/publish-meta-pulse-diffs.mjs auf der Box; Regeln
// und Pfad stehen in snapshot-matrix.ts. Jeder Fehler → null → die Route
// rechnet live wie bisher.
import {
  isValidMetaPulseDiff,
  listKey,
  metaPulseDiffPath,
  META_PULSE_DIFF_BUCKETS,
  type MetaPulseDiffRow,
} from './snapshot-matrix';

// Derselbe Blob-Speicher wie das Snapshot-Manifest.
const MANIFEST_URL = process.env.SNAPSHOT_MANIFEST_URL || '';
const FETCH_TIMEOUT_MS = 2500;

function blobOrigin(): string | null {
  try {
    return MANIFEST_URL ? new URL(MANIFEST_URL).origin : null;
  } catch {
    return null;
  }
}

export interface MetaPulsePatchInfo {
  patch: string;
  set_number: number;
  last_day: string;
  total_matches: number | string;
}

export async function loadMetaPulseDiff(o: {
  patch: MetaPulsePatchInfo;
  regionLabel: string;
  regions: ReadonlyArray<string>;
  bucketLabel: string;
  buckets: ReadonlyArray<string>;
}): Promise<MetaPulseDiffRow[] | null> {
  if (o.regionLabel !== 'all') return null;
  const groupBuckets = META_PULSE_DIFF_BUCKETS[o.bucketLabel];
  if (!groupBuckets || listKey(groupBuckets) !== listKey(o.buckets)) return null;
  const origin = blobOrigin();
  if (!origin) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const url = `${origin}/${metaPulseDiffPath(o.patch.patch, o.bucketLabel)}?_min=${Math.floor(Date.now() / 60000)}`;
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const snap: unknown = await res.json();
    const ok = isValidMetaPulseDiff(snap, {
      set: Number(o.patch.set_number),
      patch: o.patch.patch,
      lastDay: o.patch.last_day,
      totalMatches: Number(o.patch.total_matches),
      regions: o.regions,
      buckets: o.buckets,
      now: Date.now(),
    });
    return ok ? snap.rows : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

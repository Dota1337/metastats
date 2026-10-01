// Liest die vorgerechneten Meta-Pulse-Daten (region=all): Patch-Vergleiche und
// Velocity. Geschrieben von scripts/publish-meta-pulse-diffs.mjs auf der Box;
// Regeln und Pfade stehen in snapshot-matrix.ts. Jeder Fehler → null → die
// Route rechnet live wie bisher.
import {
  isValidMetaPulseDiff,
  isValidMetaPulseVelocity,
  listKey,
  metaPulseDiffPath,
  metaPulseVelocityPath,
  META_PULSE_DIFF_BUCKETS,
  type MetaPulseDiffRow,
  type MetaPulseVelocityRow,
  type MetaPulseVelocityWindow,
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

interface Scope {
  regionLabel: string;
  regions: ReadonlyArray<string>;
  bucketLabel: string;
  buckets: ReadonlyArray<string>;
}

// Nur region=all und nur eine der vorgerechneten Rang-Gruppen.
function inScope(o: Scope): boolean {
  if (o.regionLabel !== 'all') return false;
  const groupBuckets = META_PULSE_DIFF_BUCKETS[o.bucketLabel];
  return !!groupBuckets && listKey(groupBuckets) === listKey(o.buckets);
}

async function fetchBlob(path: string): Promise<unknown | null> {
  const origin = blobOrigin();
  if (!origin) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${origin}/${path}?_min=${Math.floor(Date.now() / 60000)}`, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function loadMetaPulseDiff(o: Scope & { patch: MetaPulsePatchInfo }): Promise<MetaPulseDiffRow[] | null> {
  if (!inScope(o)) return null;
  const snap = await fetchBlob(metaPulseDiffPath(o.patch.patch, o.bucketLabel));
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
}

export async function loadMetaPulseVelocity(o: Scope & {
  sel: MetaPulsePatchInfo;
  cmp: MetaPulsePatchInfo | undefined;
  previousPatch: string | null;
  window: MetaPulseVelocityWindow;
}): Promise<MetaPulseVelocityRow[] | null> {
  if (!inScope(o)) return null;
  const snap = await fetchBlob(metaPulseVelocityPath(o.sel.patch, o.bucketLabel, o.window));
  const ok = isValidMetaPulseVelocity(snap, {
    set: Number(o.sel.set_number),
    patch: o.sel.patch,
    comparePatch: o.previousPatch,
    lastDay: o.sel.last_day,
    totalMatches: Number(o.sel.total_matches),
    compareTotalMatches: o.cmp ? Number(o.cmp.total_matches) : null,
    regions: o.regions,
    buckets: o.buckets,
    window: o.window,
    now: Date.now(),
  });
  return ok ? snap.rows : null;
}

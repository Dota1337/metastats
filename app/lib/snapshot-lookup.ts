// Snapshot-Lookup für vorgerenderte API-Responses, ausgeliefert via Vercel-Blob.
//
// Pattern: der nightly Crawler-Hook auf Hetzner schreibt JSON-Files mit den
// Hot-Path-Permutationen aus snapshot-matrix.ts nach Vercel-Blob. Das Manifest
// (Liste aller verfügbaren Snapshots + Build-Time) liegt unter einer stabilen
// public URL — API-Routes laden es einmal pro Prozess (5min TTL) und fetchen
// die einzelnen Snapshots on-demand. Vercel-Edge-Cache cacht beide.
//
// Reads gehen über fetch() statt FS, weil Blob ein externer Storage ist —
// das kostet 30-80ms intra-Region (Vercel-Function → Vercel-Blob), spart aber
// jedes Mal eine schwere Supabase-RPC. Bei 6h Edge-TTL trifft das nur den
// ersten User pro Cache-Cycle.

import { snapshotKey, normalizeSnapshotRequest, type SnapshotEndpoint } from './snapshot-matrix';

const MANIFEST_URL_BASE = process.env.SNAPSHOT_MANIFEST_URL || '';
// Bei private Blob-Store werden Reads via Token authentifiziert. Der Token
// liegt server-side im Function-Env. Public-Store-Setups setzen ihn nicht.
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || '';
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const SNAPSHOT_FETCH_TIMEOUT_MS = 3000;

function blobAuthHeaders(): Record<string, string> {
  return BLOB_TOKEN ? { Authorization: `Bearer ${BLOB_TOKEN}` } : {};
}

interface ManifestEntry {
  key: string;       // logischer Pfad analog snapshotKey()
  url: string;       // public URL auf Vercel-Blob
  bytes: number;     // size, zur Diagnose
  builtAt: string;   // ISO timestamp des Publishers
}

interface SnapshotManifest {
  version: string;
  builtAt: string;
  patches: { current: string; previous: string | null };
  entries: Record<string, ManifestEntry>;
}

let _manifest: { ts: number; data: SnapshotManifest | null } | null = null;
let _inflight: Promise<SnapshotManifest | null> | null = null;

async function loadManifest(): Promise<SnapshotManifest | null> {
  if (!MANIFEST_URL_BASE) return null;
  if (_manifest && Date.now() - _manifest.ts < MANIFEST_TTL_MS) return _manifest.data;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
      // Cache-Bust per minute: edge serves stale up to a minute, the function
      // process re-validates 5min. Together: a freshly published manifest
      // propagates to all functions within ~1min.
      const sep = MANIFEST_URL_BASE.includes('?') ? '&' : '?';
      const res = await fetch(`${MANIFEST_URL_BASE}${sep}_min=${Math.floor(Date.now() / 60000)}`, {
        signal: ctrl.signal,
        cache: 'no-store',
        headers: blobAuthHeaders(),
      });
      clearTimeout(t);
      if (!res.ok) {
        _manifest = { ts: Date.now(), data: null };
        return null;
      }
      const data = (await res.json()) as SnapshotManifest;
      _manifest = { ts: Date.now(), data };
      return data;
    } catch {
      // Stale-serve: an inflight manifest fetch must never blank a stats page.
      // If we ever had a successful manifest, keep using it; otherwise null →
      // route falls through to live RPC.
      _manifest = _manifest ?? { ts: Date.now(), data: null };
      return _manifest.data;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

export interface LookupOptions {
  patch: string | null;
  region: string;
  days: number;
  bucket: string;
  minGames: number;
  // Erweiterte Felder, die das Snapshot NICHT bedient — Velocity, Slug-Detail,
  // Source=editorial. Caller setzt sie auf true wenn das Snapshot übersprungen
  // werden soll.
  skip?: boolean;
}

export interface LookupHit {
  payload: unknown;
  tag: string;       // für x-snapshot Header
  blobUrl: string;
  blobBytes: number;
}

export async function lookupSnapshot(
  endpoint: SnapshotEndpoint,
  opts: LookupOptions,
): Promise<LookupHit | null> {
  if (opts.skip) return null;
  const req = normalizeSnapshotRequest(opts);
  if (!req) return null;
  const manifest = await loadManifest();
  if (!manifest) return null;
  // Resolve patch alias against manifest — if the caller sends a literal patch
  // string, use it as-is. Otherwise check whether it matches manifest.current.
  const resolvedPatch = req.patch === manifest.patches.current
    ? req.patch
    : req.patch === manifest.patches.previous
      ? req.patch
      : req.patch;
  const key = snapshotKey(endpoint, { ...req, patch: resolvedPatch });
  const entry = manifest.entries[key];
  if (!entry) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), SNAPSHOT_FETCH_TIMEOUT_MS);
    const res = await fetch(entry.url, { signal: ctrl.signal, headers: blobAuthHeaders() });
    clearTimeout(t);
    if (!res.ok) return null;
    const payload = await res.json();
    return { payload, tag: `${endpoint}-v1`, blobUrl: entry.url, blobBytes: entry.bytes };
  } catch {
    return null;
  }
}

export function manifestStatus(): { loaded: boolean; ageMs: number | null; entries: number } {
  if (!_manifest?.data) return { loaded: false, ageMs: null, entries: 0 };
  return {
    loaded: true,
    ageMs: Date.now() - _manifest.ts,
    entries: Object.keys(_manifest.data.entries).length,
  };
}

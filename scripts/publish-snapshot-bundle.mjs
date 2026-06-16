#!/usr/bin/env node
// Publishes the Phase-1 snapshot bundle to Vercel-Blob.
//
// Strategy: ruft die existierende Live-API einmal pro Permutation (cold path),
// persistiert das Response als JSON unter `tft/<endpoint>/...json` im Blob,
// schreibt am Schluss ein Manifest mit allen Snapshot-URLs + Build-Time.
// API-Routes lesen das Manifest und liefern Snapshots aus dem Blob anstelle
// des schweren RPCs.
//
// Designed to run on the Hetzner crawler box right after the daily-crawl
// finishes — at that point all aggregates are fresh and the Vercel-Edge cache
// hasn't been hit yet for the new day.
//
// Usage:
//   node scripts/publish-snapshot-bundle.mjs [--base-url <url>] [--concurrency N]
//                                            [--endpoint comps|units|...]
//                                            [--dry-run]
//
// Env:
//   BLOB_READ_WRITE_TOKEN   Vercel-Blob token (Required, kommt aus Vercel-Env
//                           bei Connect-to-Project automatisch).
//   PUBLIC_BASE_URL         Defaults to https://www.metastats.gg

import { put } from '@vercel/blob';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BASE = process.env.PUBLIC_BASE_URL
  || (process.argv.includes('--base-url') ? process.argv[process.argv.indexOf('--base-url') + 1] : null)
  || 'https://www.metastats.gg';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const CONCURRENCY = (() => {
  const i = args.indexOf('--concurrency');
  return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 3) : 3;
})();
const ENDPOINT_FILTER = (() => {
  const i = args.indexOf('--endpoint');
  return i >= 0 ? args[i + 1] : null;
})();

// === Filter-Matrix — kopiert aus app/lib/snapshot-matrix.ts ============== //
// Bewusst dupliziert statt importiert: das App-Modul ist TypeScript mit
// path-rooted Imports und der Publisher läuft als nacktes Node-Skript.
// Single source of truth bleibt das TS-File; sync via PR-Review.

const PRIMARY_REGIONS = ['all', 'west', 'asia', 'euw1', 'na1', 'kr'];
const SECONDARY_REGIONS = ['eun1', 'br1', 'sg2', 'jp1', 'tw2'];
const PRIMARY_DAYS = [1, 3, 7];
const PRIMARY_BUCKETS = ['master_plus', 'all', 'diamond_plus'];

function buildList({ patches, regions, days, buckets, minGames }) {
  const out = [];
  for (const patch of patches) {
    for (const region of regions) {
      for (const d of days) {
        for (const bucket of buckets) {
          out.push({ patch, region, days: d, bucket, minGames });
        }
      }
    }
  }
  return out;
}

const MATRIX = {
  comps: {
    apiPath: '/api/tft/comps',
    permutations: buildList({
      patches: ['current', 'previous'],
      regions: PRIMARY_REGIONS,
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 30,
    }),
  },
  units: {
    apiPath: '/api/tft/units',
    permutations: buildList({
      patches: ['current', 'previous'],
      regions: [...PRIMARY_REGIONS, ...SECONDARY_REGIONS],
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  items: {
    apiPath: '/api/tft/items',
    permutations: buildList({
      patches: ['current', 'previous'],
      regions: [...PRIMARY_REGIONS, ...SECONDARY_REGIONS],
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  traits: {
    apiPath: '/api/tft/traits',
    permutations: buildList({
      patches: ['current', 'previous'],
      regions: PRIMARY_REGIONS,
      days: PRIMARY_DAYS,
      buckets: PRIMARY_BUCKETS,
      minGames: 0,
    }),
  },
  // augments-Endpoint wird nicht vorgerendert — Route liefert per Design
  // hasData:false (Riot-Restriction). UI rendert aus CDragon-Bundle.
};

function snapshotKey(endpoint, p) {
  const patch = p.patch.replace(/[^A-Za-z0-9._-]/g, '_');
  const region = p.region.replace(/[^a-z0-9]/gi, '_');
  const bucket = p.bucket.replace(/[^a-z0-9_]/gi, '_');
  return `${endpoint}/${patch}/${region}__${p.days}d__${bucket}__mg${p.minGames}.json`;
}

// === Helpers ============================================================ //

function ts() { return new Date().toISOString(); }

function buildUrl(apiPath, p) {
  const qs = new URLSearchParams({
    patch: p.patch,
    region: p.region,
    days: String(p.days),
    bucket: p.bucket,
    source: 'data',
  });
  if (p.minGames > 0) qs.set('minGames', String(p.minGames));
  return `${BASE}${apiPath}?${qs.toString()}`;
}

async function fetchPayload(url, attempt = 1) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 60_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      // Tell Vercel-Edge to not return a stale cached copy — we want the
      // freshest data the moment after daily-crawl completes.
      headers: { 'Cache-Control': 'no-cache', 'x-snapshot-publisher': '1' },
      redirect: 'follow',
    });
    clearTimeout(t);
    if (!res.ok) {
      if (attempt < 3 && (res.status === 502 || res.status === 503 || res.status === 504)) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
        return fetchPayload(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    clearTimeout(t);
    if (attempt < 3 && err?.name === 'AbortError') {
      return fetchPayload(url, attempt + 1);
    }
    throw err;
  }
}

// Resolved patches kommen aus dem ersten erfolgreichen comps-Call (Default-
// Filter), wo wir filters.patch ablesen können. Wird einmal pro Run gecached.
let _patchInfo = null;
async function resolvePatches() {
  if (_patchInfo) return _patchInfo;
  const currentUrl = buildUrl('/api/tft/comps', {
    patch: 'current', region: 'all', days: 3, bucket: 'master_plus', minGames: 30,
  });
  const previousUrl = buildUrl('/api/tft/comps', {
    patch: 'previous', region: 'all', days: 3, bucket: 'master_plus', minGames: 30,
  });
  const [cur, prev] = await Promise.all([
    fetchPayload(currentUrl).catch(() => null),
    fetchPayload(previousUrl).catch(() => null),
  ]);
  _patchInfo = {
    current: cur?.filters?.patch || null,
    previous: prev?.filters?.patch || null,
  };
  console.log(`[${ts()}] Resolved patches: current=${_patchInfo.current}, previous=${_patchInfo.previous}`);
  return _patchInfo;
}

async function publishPermutation(endpoint, apiPath, perm, patches) {
  const resolvedPatch = perm.patch === 'current'
    ? patches.current
    : perm.patch === 'previous' ? patches.previous : perm.patch;
  if (!resolvedPatch) {
    return { skipped: true, reason: `no resolved patch for alias ${perm.patch}` };
  }
  const url = buildUrl(apiPath, perm);
  const t0 = Date.now();
  const payload = await fetchPayload(url);
  const fetchMs = Date.now() - t0;
  if (!payload || payload.hasData === false) {
    return { skipped: true, reason: 'empty payload', fetchMs };
  }
  const key = snapshotKey(endpoint, { ...perm, patch: resolvedPatch });
  const body = JSON.stringify(payload);
  const bytes = Buffer.byteLength(body, 'utf8');
  if (DRY_RUN) {
    return { uploaded: false, key, bytes, fetchMs, builtAt: ts(), url: '(dry-run)' };
  }
  const t1 = Date.now();
  const blob = await put(key, body, {
    access: 'public',
    contentType: 'application/json',
    token: TOKEN,
    addRandomSuffix: false,
    allowOverwrite: true,
    // Cache-Control auf dem Blob: 6h hard. API-Route auf Vercel reads via
    // BLOB_READ_WRITE_TOKEN und liefert JSON aus — Vercel-Edge cached die
    // Route-Response, nicht den Blob direkt.
    cacheControlMaxAge: 21600,
  });
  const uploadMs = Date.now() - t1;
  return {
    uploaded: true,
    key,
    bytes,
    fetchMs,
    uploadMs,
    url: blob.url,
    builtAt: ts(),
  };
}

async function processWithConcurrency(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        results[i] = { error: err?.message || String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// === Main =============================================================== //

async function main() {
  if (!TOKEN && !DRY_RUN) {
    console.error('ERROR: BLOB_READ_WRITE_TOKEN env var required (set --dry-run to skip uploads).');
    process.exit(2);
  }
  console.log(`[${ts()}] publisher base=${BASE}, conc=${CONCURRENCY}, dryRun=${DRY_RUN}${ENDPOINT_FILTER ? ', endpoint=' + ENDPOINT_FILTER : ''}`);

  const patches = await resolvePatches();
  if (!patches.current) {
    console.error(`[${ts()}] FATAL: could not resolve "current" patch — aborting`);
    process.exit(3);
  }

  const manifestEntries = {};
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalBytes = 0;

  for (const [endpoint, spec] of Object.entries(MATRIX)) {
    if (ENDPOINT_FILTER && endpoint !== ENDPOINT_FILTER) continue;
    const t0 = Date.now();
    console.log(`[${ts()}] === ${endpoint}: ${spec.permutations.length} permutations ===`);

    const results = await processWithConcurrency(
      spec.permutations,
      async (perm) => publishPermutation(endpoint, spec.apiPath, perm, patches),
      CONCURRENCY,
    );

    let endpointOk = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const p = spec.permutations[i];
      if (r?.error) {
        totalErrors++;
        console.log(`  ✗ ${endpoint} ${p.patch}/${p.region}/${p.days}d/${p.bucket}: ${r.error}`);
        continue;
      }
      if (r?.skipped) {
        totalSkipped++;
        continue;
      }
      if (r?.uploaded || DRY_RUN) {
        totalUploaded += r.uploaded ? 1 : 0;
        endpointOk++;
        totalBytes += r.bytes;
        manifestEntries[r.key] = {
          key: r.key,
          url: r.url,
          bytes: r.bytes,
          builtAt: r.builtAt,
        };
      }
    }
    const dt = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`[${ts()}] ${endpoint}: ${endpointOk}/${spec.permutations.length} ok in ${dt}s`);
  }

  // Manifest schreiben — single source of truth für Lookup.
  const manifest = {
    version: 'v1',
    builtAt: ts(),
    patches,
    entries: manifestEntries,
  };
  const manifestBody = JSON.stringify(manifest);
  if (!DRY_RUN) {
    const manifestBlob = await put('tft/manifest.json', manifestBody, {
      access: 'public',
      contentType: 'application/json',
      token: TOKEN,
      addRandomSuffix: false,
      allowOverwrite: true,
      // Manifest soll häufig revalidieren — 60s edge + 5min SWR.
      cacheControlMaxAge: 60,
    });
    console.log(`[${ts()}] Manifest: ${manifestBlob.url} (${Buffer.byteLength(manifestBody)} B, ${Object.keys(manifestEntries).length} entries)`);
    console.log(`[${ts()}] >>> Set SNAPSHOT_MANIFEST_URL=${manifestBlob.url} in Vercel + .env.local <<<`);
  } else {
    console.log(`[${ts()}] DRY-RUN: manifest would contain ${Object.keys(manifestEntries).length} entries (${Buffer.byteLength(manifestBody)} B)`);
  }

  console.log(`[${ts()}] DONE: uploaded=${totalUploaded}, skipped=${totalSkipped}, errors=${totalErrors}, totalBytes=${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
  if (totalErrors > 0) process.exit(1);
}

main().catch(err => {
  console.error(`[${ts()}] FATAL:`, err);
  process.exit(1);
});

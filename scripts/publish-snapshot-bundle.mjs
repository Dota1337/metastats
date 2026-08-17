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
// Manifest write modes (Lücke B, Multi-Review 2026-06-28):
//   * full run (no filter)  -> REPLACE the manifest entries. The authoritative
//                              nightly rebuild; this is the only path that prunes
//                              stale keys (e.g. last patch's keys after a bump).
//   * partial run (--endpoint / --listing-only) -> MERGE the published keys into
//                              the existing manifest, so a quick outage-time
//                              re-publish does NOT clobber the keys it didn't
//                              build (e.g. comps-detail when re-publishing comps).
// The manifest is the source of truth for which snapshot is *lookup-able*, NOT
// for which blobs physically exist; orphan-blob cleanup is a separate prune job.
// At a Set bump a full run is REQUIRED (merge alone never prunes old-set keys).
//
// Usage:
//   node scripts/publish-snapshot-bundle.mjs [--base-url <url>] [--concurrency N]
//                                            [--endpoint comps|units|...]
//                                            [--listing-only] [--manifest-mode replace|merge]
//                                            [--dry-run]
//   --listing-only          publishes comps/units/items/traits (skips comps-detail);
//                           implies merge. The fast outage-recovery path (~2.4×).
//   --manifest-mode         override the auto-derived replace/merge decision.
//
// Env:
//   BLOB_READ_WRITE_TOKEN   Vercel-Blob token (Required, kommt aus Vercel-Env
//                           bei Connect-to-Project automatisch).
//   PUBLIC_BASE_URL         Defaults to https://www.metastats.gg
//   SNAPSHOT_MANIFEST_URL   Existing manifest (read for merge-base + patch pin).
//   PUBLISH_LOCK_PATH       Override the cross-invocation lockfile path.

import { put } from '@vercel/blob';
import { openSync, closeSync, writeSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Single-Source-of-Truth: TS-Datei app/lib/snapshot-matrix.ts wird via
// `npm run build:snapshot-matrix` (Multi-Review 2026-06-25 Option C) zu
// snapshot-matrix.generated.mjs transpiliert. Dieses File ist im Git
// committed — Hetzner-Box braucht nicht tsc bei jedem Publish zu laufen.
// Bei Änderungen an snapshot-matrix.ts MUSS regeneriert + committed werden
// (Pre-Push-Hook empfohlen). Memory: reference_dual_module_patterns.md.
import {
  SNAPSHOT_MATRIX as MATRIX,
  snapshotKey,
  compsMinGames,
  DETAIL_REGIONS,
  DETAIL_DAYS,
  DETAIL_PATCHES,
  DETAIL_BUCKETS,
  DETAIL_MIN_GAMES,
  DETAIL_TOP_N,
} from '../app/lib/snapshot-matrix.generated.mjs';

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
const LISTING_ONLY = args.includes('--listing-only');
const MANIFEST_MODE_OVERRIDE = (() => {
  const i = args.indexOf('--manifest-mode');
  const v = i >= 0 ? args[i + 1] : null;
  if (v && v !== 'replace' && v !== 'merge') {
    console.error(`ERROR: --manifest-mode must be 'replace' or 'merge', got '${v}'`);
    process.exit(2);
  }
  return v;
})();
// A partial run (endpoint-filtered or listing-only) MUST merge — it would
// otherwise clobber the keys it didn't publish. A bare full run replaces (and
// thereby prunes stale keys). --manifest-mode overrides the derivation.
const MERGE_MODE = MANIFEST_MODE_OVERRIDE
  ? MANIFEST_MODE_OVERRIDE === 'merge'
  : (Boolean(ENDPOINT_FILTER) || LISTING_ONLY);

// Cross-invocation advisory lock. The nightly systemd run and any ad-hoc manual
// run execute THIS script, so the lock lives here (systemd Conflicts= can't
// guard ad-hoc `node` calls). Without it, a merge + a concurrent replace would
// splice two writers' partial states into tft/manifest.json (Vercel-Blob has no
// CAS) — logic-flow-critic Hazard D, 2026-06-28.
const LOCK_PATH = process.env.PUBLISH_LOCK_PATH
  || (existsSync('/run/lock') ? '/run/lock/metastats-snapshot-publish.lock' : '.snapshot-publish.lock');
let lockAcquired = false;

// === Helpers ============================================================ //

function ts() { return new Date().toISOString(); }

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

// Acquire the advisory lock via exclusive-create. If the lockfile exists and its
// holder PID is still alive, another publish is running -> return false. A stale
// lock (holder dead, e.g. SIGKILL) is removed and retried.
function acquireLock() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      let holder = NaN;
      try { holder = Number(readFileSync(LOCK_PATH, 'utf8').trim()); } catch { /* race: gone */ }
      if (pidAlive(holder)) return false;
      try { unlinkSync(LOCK_PATH); } catch { /* already removed */ }
    }
  }
  return false;
}

function releaseLock() {
  try {
    const holder = Number(readFileSync(LOCK_PATH, 'utf8').trim());
    if (holder === process.pid) unlinkSync(LOCK_PATH);
  } catch { /* already gone */ }
}
// Release on every exit path, including process.exit() and SIGTERM (systemd
// stop). SIGKILL can't be caught -> the stale-PID check above reclaims it.
process.on('exit', () => { if (lockAcquired) releaseLock(); });
process.on('SIGTERM', () => process.exit(143));

// Loads the currently-published manifest ONCE per run (memoized). Both the
// patch-resolution fallback and the MERGE_MODE entry-merge read from this, so
// there is exactly one GET against the manifest blob per run. _fetchFailed is
// true ONLY when SNAPSHOT_MANIFEST_URL is set but the GET failed (distinct from
// "no URL" = legitimate first run with an empty merge base).
let _oldManifest;
let _oldManifestFetchFailed = false;
async function loadOldManifest() {
  if (_oldManifest !== undefined) return _oldManifest;
  const url = process.env.SNAPSHOT_MANIFEST_URL;
  if (!url) { _oldManifest = null; return null; }
  try {
    _oldManifest = await fetchPayload(url);
  } catch (err) {
    _oldManifest = null;
    _oldManifestFetchFailed = true;
    console.log(`[${ts()}] old-manifest fetch failed: ${err?.message || err}`);
  }
  return _oldManifest;
}

// Edge-Cache-Buster. `Cache-Control: no-cache` im REQUEST ignoriert Vercels
// Edge komplett — gemessen 2026-08-17: `X-Vercel-Cache: HIT` trotz des Headers.
// Ohne einen Parameter, der in den Cache-Key eingeht, liest der Publisher also
// die Edge-Kopie der letzten 6 h und der Route-seitige Publisher-Bypass
// (isSnapshotPublisher) kaeme nie zum Zug. Ein Wert pro Lauf reicht: innerhalb
// eines Laufs ist jede Permutation ohnehin nur einmal dran.
const RUN_ID = `${Date.now().toString(36)}`;

function buildUrl(apiPath, p) {
  const qs = new URLSearchParams({
    patch: p.patch,
    region: p.region,
    days: String(p.days),
    bucket: p.bucket,
    source: 'data',
  });
  if (p.minGames > 0) qs.set('minGames', String(p.minGames));
  qs.set('_pub', RUN_ID);
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
      if (attempt < 4 && (res.status === 502 || res.status === 503 || res.status === 504)) {
        // Backoff bewusst lang (5s / 20s / 45s statt 2s / 4s): die 502er hier
        // sind KEINE sporadischen Netzfehler, sondern serverseitige Timeouts
        // auf schweren jsonb-Aggregaten (7d-Fenster). Ein sofortiger Retry
        // faehrt in dieselbe kalte Query und timeoutet erneut — der erste
        // Versuch waermt aber Visibility-Map und Plan-Cache auf, sodass ein
        // spaeterer Versuch echte Chancen hat. Siehe
        // reference_tft_stats_vacuum_perf.md.
        const backoffMs = [5_000, 20_000, 45_000][attempt - 1];
        await new Promise(r => setTimeout(r, backoffMs));
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
// Fallback: wenn die API null returnt (get_tft_available_patches Supabase-RPC
// timeoutet), ziehen wir die Patches aus dem existierenden Manifest — das ist
// die Source-of-Truth, die wir gerade aktualisieren.
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
  let current = cur?.filters?.patch || null;
  let previous = prev?.filters?.patch || null;
  if (!current || !previous) {
    // Manifest-Fallback: wenn Supabase-RPC fuer Patches haengt, lesen wir die
    // patches aus dem zuletzt veroeffentlichten Manifest (shared memoized load).
    const m = await loadOldManifest();
    if (m?.patches) {
      if (!current && m.patches.current) current = m.patches.current;
      if (!previous && m.patches.previous) previous = m.patches.previous;
      console.log(`[${ts()}] Manifest-fallback patches: current=${current}, previous=${previous}`);
    }
  }
  _patchInfo = { current, previous };
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

async function publishDetailPermutation(perm, patches) {
  const resolvedPatch = perm.patch === 'current'
    ? patches.current
    : perm.patch === 'previous' ? patches.previous : perm.patch;
  if (!resolvedPatch) {
    return { skipped: true, reason: `no resolved patch for alias ${perm.patch}` };
  }
  const qs = new URLSearchParams({
    patch: perm.patch,
    region: perm.region,
    days: String(perm.days),
    bucket: perm.bucket,
    slug: perm.slug,
    source: 'data',
  });
  if (perm.minGames > 0) qs.set('minGames', String(perm.minGames));
  qs.set('_pub', RUN_ID);
  const url = `${BASE}/api/tft/comps?${qs.toString()}`;
  const t0 = Date.now();
  const payload = await fetchPayload(url);
  const fetchMs = Date.now() - t0;
  if (!payload || payload.hasData === false || !payload.comp) {
    return { skipped: true, reason: 'empty payload', fetchMs };
  }
  const key = snapshotKey('comps-detail', { ...perm, patch: resolvedPatch });
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
    cacheControlMaxAge: 21600,
    // Bound the upload so a hung blob PUT can't block all workers and hold the
    // publish lock indefinitely. Audit M3, 2026-06-28.
    abortSignal: AbortSignal.timeout(120_000),
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
  if (!DRY_RUN) {
    if (!acquireLock()) {
      console.log(`[${ts()}] another publish holds ${LOCK_PATH} — skipping (a concurrent publish is active)`);
      return; // benign skip, exit 0 — the active run handles this publish
    }
    lockAcquired = true;
  }
  console.log(`[${ts()}] publisher base=${BASE}, conc=${CONCURRENCY}, dryRun=${DRY_RUN}${ENDPOINT_FILTER ? ', endpoint=' + ENDPOINT_FILTER : ''}${LISTING_ONLY ? ', listing-only' : ''}`);

  let patches = await resolvePatches();

  // Merge-base load (logic-flow Blocker A/B): in MERGE_MODE read the existing
  // manifest UNCONDITIONALLY and EARLY — before any blob upload — so a partial
  // run preserves the keys it doesn't publish, and a fetch failure aborts with
  // zero side effects rather than clobbering the manifest.
  let baseEntries = {};
  if (MERGE_MODE) {
    const base = await loadOldManifest();
    if (_oldManifestFetchFailed) {
      console.error(`[${ts()}] FATAL: merge needs the existing manifest but SNAPSHOT_MANIFEST_URL fetch failed — aborting before any upload to avoid clobbering it`);
      process.exit(4);
    }
    baseEntries = (base && base.entries && typeof base.entries === 'object') ? base.entries : {};
    // Blocker C: pin patches to the merge-base so this run's new keys are built
    // under the SAME patch as the preserved keys. Otherwise a patch bump mid-run
    // would key new listing data under X while preserved detail sits under W,
    // and the manifest's top-level patches would match only one of them.
    if (base?.patches?.current) patches = base.patches;
    console.log(`[${ts()}] manifest-mode=MERGE — base ${Object.keys(baseEntries).length} entries preserved, patches pinned to base (current=${patches.current})`);
  } else {
    console.log(`[${ts()}] manifest-mode=REPLACE (full run) — manifest rebuilt from scratch, stale keys pruned`);
  }

  if (!patches.current) {
    console.error(`[${ts()}] FATAL: could not resolve "current" patch — aborting`);
    process.exit(3);
  }

  const manifestEntries = {};
  // Pro-Endpoint-Abdeckung: ein Gesamt-Fehlerquotient allein kann verbergen,
  // dass ein ganzer Endpoint komplett ausgefallen ist (z.B. alle 108 comps-
  // Permutationen tot, aber 500 units/items/traits gruen -> Quotient sieht
  // harmlos aus). Deshalb zusaetzlich pro Endpoint pruefen.
  const endpointStats = {};
  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalBytes = 0;

  for (const [endpoint, spec] of Object.entries(MATRIX)) {
    if (ENDPOINT_FILTER && endpoint !== ENDPOINT_FILTER) continue;
    // comps-detail wird separat behandelt (Top-N-Slugs aus Listing-Phase).
    if (endpoint === 'comps-detail') continue;
    if (spec.permutations.length === 0) continue;
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
    endpointStats[endpoint] = { ok: endpointOk, total: spec.permutations.length };
    console.log(`[${ts()}] ${endpoint}: ${endpointOk}/${spec.permutations.length} ok in ${dt}s`);
  }

  // Phase 2: Comp-Detail-Snapshots fuer Top-N Family-Anchors.
  // Slugs werden aus dem Default-Listing-Result extrahiert (patch=current,
  // region=all, days=3, bucket=master_plus) - das ist die UI-Default-Sicht.
  if (!LISTING_ONLY && (!ENDPOINT_FILTER || ENDPOINT_FILTER === 'comps-detail')) {
    const dT0 = Date.now();
    console.log(`[${ts()}] === comps-detail: extracting top-${DETAIL_TOP_N} slugs from listing ===`);
    let topSlugs = [];
    try {
      // Slug-Quelle: Default-Bucket der UI (diamond_plus), 3d — das 7d-Listing
      // ist ohne Snapshot nicht abrufbar (3× 502 gemessen, 8-s-RPC-Deckel).
      const listingUrl = buildUrl('/api/tft/comps', {
        patch: 'current', region: 'all', days: 3, bucket: 'diamond_plus', minGames: compsMinGames(3),
      });
      const listing = await fetchPayload(listingUrl);
      const comps = Array.isArray(listing?.comps) ? listing.comps : [];
      // Sortierung nach SPIELEN, nicht nach der Listing-Reihenfolge: das
      // Listing sortiert nach avgPlacement, die "Top-30" waren damit die 30
      // besten Platzierungen knapp ueber der minGames-Schwelle (gemessen 1d:
      // ab 85 Spielen), waehrend die meistgespielten Comps (34.886 / 31.805 /
      // 23.437 Spiele) gar keinen Detail-Snapshot bekamen. Der Cushion soll
      // die haeufigsten Detail-Aufrufe decken, nicht die besten Winrates.
      topSlugs = comps
        .filter(c => c.clusterKey)
        .slice()
        .sort((a, b) => (Number(b.games) || 0) - (Number(a.games) || 0))
        .slice(0, DETAIL_TOP_N)
        .map(c => c.clusterKey);
    } catch (err) {
      console.log(`  ✗ comps-detail: failed to extract top slugs: ${err?.message || err}`);
    }
    if (topSlugs.length === 0) {
      console.log(`[${ts()}] comps-detail: no slugs to publish, skipping`);
    } else {
      const detailPerms = [];
      for (const slug of topSlugs) {
        for (const patch of DETAIL_PATCHES) {
          for (const region of DETAIL_REGIONS) {
            for (const days of DETAIL_DAYS) {
              for (const bucket of DETAIL_BUCKETS) {
                detailPerms.push({
                  patch, region, days, bucket,
                  // Fix: NICHT compsMinGames(days). Der Detail-Key kodiert
                  // minGames nicht, die Page fragt aber mit 30 — mit 490
                  // publiziert lieferte der Snapshot eine andere
                  // Family-Aggregation als der Live-Pfad.
                  minGames: DETAIL_MIN_GAMES,
                  slug,
                });
              }
            }
          }
        }
      }
      console.log(`[${ts()}] comps-detail: ${topSlugs.length} slugs × ${detailPerms.length / topSlugs.length} axes = ${detailPerms.length} permutations`);

      const results = await processWithConcurrency(
        detailPerms,
        async (perm) => publishDetailPermutation(perm, patches),
        CONCURRENCY,
      );

      let detailOk = 0;
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const p = detailPerms[i];
        if (r?.error) {
          totalErrors++;
          console.log(`  ✗ comps-detail ${p.slug}/${p.patch}/${p.region}/${p.days}d: ${r.error}`);
          continue;
        }
        if (r?.skipped) {
          totalSkipped++;
          continue;
        }
        if (r?.uploaded || DRY_RUN) {
          totalUploaded += r.uploaded ? 1 : 0;
          detailOk++;
          totalBytes += r.bytes;
          manifestEntries[r.key] = {
            key: r.key,
            url: r.url,
            bytes: r.bytes,
            builtAt: r.builtAt,
          };
        }
      }
      const dDt = ((Date.now() - dT0) / 1000).toFixed(1);
      endpointStats['comps-detail'] = { ok: detailOk, total: detailPerms.length };
      console.log(`[${ts()}] comps-detail: ${detailOk}/${detailPerms.length} ok in ${dDt}s`);
    }
  }

  // --- Abbruch-Guards VOR dem Manifest-Write --------------------------------
  // Das Manifest ist die einzige Lookup-Wahrheit fuer den Read-Pfad. Ein
  // REPLACE-Lauf, der wenig oder nichts hochgeladen hat, wuerde den letzten
  // funktionierenden Stand clobbern und die Site auf Empty-States setzen —
  // besonders gefaehrlich in der Set-Bump-Woche, wenn die neuen Aggregate noch
  // duenn sind. Lieber gar nicht schreiben als leer schreiben.
  const attempted = totalUploaded + totalSkipped + totalErrors;
  const deadEndpoints = Object.entries(endpointStats)
    .filter(([, s]) => s.total > 0 && s.ok === 0)
    .map(([name]) => name);

  if (!DRY_RUN && !MERGE_MODE) {
    if (Object.keys(manifestEntries).length === 0) {
      console.error(`[${ts()}] ABORT: REPLACE-Lauf hat 0 Entries erzeugt — Manifest NICHT geschrieben.`);
      console.error(`[${ts()}]        Der bestehende Manifest-Stand bleibt unveraendert erhalten.`);
      process.exit(5);
    }
    // Bei einem Voll-Lauf ist ein Einbruch unter 50% der versuchten
    // Permutationen kein "Teil-Erfolg" mehr, sondern ein Systemproblem.
    if (attempted > 0 && totalUploaded / attempted < 0.5) {
      console.error(`[${ts()}] ABORT: nur ${totalUploaded}/${attempted} Permutationen erfolgreich (<50%) — Manifest NICHT geschrieben.`);
      console.error(`[${ts()}]        Tote Endpoints: ${deadEndpoints.join(', ') || '(keine, breiter Ausfall)'}`);
      process.exit(5);
    }
  }

  // Manifest schreiben — single source of truth für den Lookup-Pfad.
  // MERGE_MODE: published keys overlay the preserved base (new wins key-genau).
  // REPLACE: only this run's keys -> prunes stale keys.
  const finalEntries = MERGE_MODE ? { ...baseEntries, ...manifestEntries } : manifestEntries;
  const manifest = {
    version: 'v1',
    builtAt: ts(),
    patches,
    entries: finalEntries,
  };
  const manifestBody = JSON.stringify(manifest);
  const entryCountMsg = MERGE_MODE
    ? `${Object.keys(finalEntries).length} entries (merged: ${Object.keys(baseEntries).length} base + ${Object.keys(manifestEntries).length} new)`
    : `${Object.keys(finalEntries).length} entries (full replace)`;
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
    console.log(`[${ts()}] Manifest: ${manifestBlob.url} (${Buffer.byteLength(manifestBody)} B, ${entryCountMsg})`);
    console.log(`[${ts()}] >>> Set SNAPSHOT_MANIFEST_URL=${manifestBlob.url} in Vercel + .env.local <<<`);
  } else {
    console.log(`[${ts()}] DRY-RUN: manifest would contain ${entryCountMsg} (${Buffer.byteLength(manifestBody)} B)`);
  }

  console.log(`[${ts()}] DONE: uploaded=${totalUploaded}, skipped=${totalSkipped}, errors=${totalErrors}, totalBytes=${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

  // --- Exit-Semantik --------------------------------------------------------
  // Vorher: JEDER Fehler -> exit 1. Folge: der Service stand dauerhaft auf
  // "failed", weil reproduzierbar dieselben 5 von 1089 Permutationen (comps
  // mit 7d-Fenster, Heavy-jsonb) timeouten. Ein Dauer-Rot maskiert echte
  // Ausfaelle — niemand schaut mehr hin. Jetzt drei Bedingungen statt einer:
  //   1. Fehlerquotient unter Toleranz UND
  //   2. kein Endpoint komplett tot UND
  //   3. Manifest geschrieben (oben per Guard sichergestellt).
  const ERROR_TOLERANCE = 0.02;   // 2% — bei 1089 Permutationen sind das ~21
  const errorRatio = attempted > 0 ? totalErrors / attempted : 0;

  if (deadEndpoints.length > 0) {
    console.error(`[${ts()}] FAIL: Endpoint(s) ohne einen einzigen Erfolg: ${deadEndpoints.join(', ')}`);
    process.exit(1);
  }
  if (errorRatio > ERROR_TOLERANCE) {
    console.error(`[${ts()}] FAIL: Fehlerquote ${(errorRatio * 100).toFixed(1)}% ueber Toleranz ${(ERROR_TOLERANCE * 100)}% (${totalErrors}/${attempted}).`);
    process.exit(1);
  }
  if (totalErrors > 0) {
    console.log(`[${ts()}] OK mit ${totalErrors} tolerierten Fehlern (${(errorRatio * 100).toFixed(2)}% < ${(ERROR_TOLERANCE * 100)}%).`);
    console.log(`[${ts()}] Hinweis: wiederkehrende Fehler gehoeren untersucht, nicht dauerhaft toleriert.`);
  }
}

// Exported for unit tests (the lock runs only in non-dry-run prod paths).
export { acquireLock, releaseLock, pidAlive, LOCK_PATH };

// Only crawl/publish when executed directly — importing for tests must not run.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error(`[${ts()}] FATAL:`, err);
    process.exit(1);
  });
}

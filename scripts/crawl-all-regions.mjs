#!/usr/bin/env node
/**
 * Drive collect-tft-marketvalues.mjs across every Riot region. Clusters run
 * SEQUENTIALLY, regions WITHIN a cluster also sequentially — the TFT
 * production key has a single 500/10s app-wide bucket, so parallel cluster
 * crawls just fight for the same quota and end up slower overall.
 *
 * Round-robin region cursor
 * -------------------------
 * The Diamond-II+ cold-fill is far larger than one nightly window (euw1 alone
 * is >11h), and Conflicts= in metastats-daily-crawl.service gracefully stops
 * this crawl at the next 00:00 firing. Without a cursor the crawl would always
 * restart at euw1 every night and the later regions (na1, kr, br1, …) would
 * NEVER be reached — their marketvalues would stay permanently stale. So we
 * persist the last fully-completed region and resume at the NEXT one each run,
 * wrapping around. A region cut short by the midnight SIGTERM is NOT marked
 * complete, so it resumes — warm-cached — on the next chained run.
 *
 * After every cluster boundary we push that cluster's snapshots to Supabase
 * right away, so partial progress is visible on metastats.gg even if a later
 * region crashes or the run is stopped.
 *
 * No artificial per-region timeout: a region runs until it naturally finishes.
 * The only time limits in the pipeline are the per-request timeout + rate
 * limits inside riot-client.mjs (external-API constraints) — see
 * scripts/lib/riot-client.mjs — plus the midnight Conflicts= stop.
 *
 * Used by the systemd metastats-crawler.service (chained after the daily crawl).
 *
 * Usage:
 *   node scripts/crawl-all-regions.mjs                       # all regions, resume from cursor
 *   node scripts/crawl-all-regions.mjs --clusters=europe     # subset
 *   node scripts/crawl-all-regions.mjs --skip-sync           # crawl only
 *   node scripts/crawl-all-regions.mjs --include-diamond     # extend scope
 *   node scripts/crawl-all-regions.mjs --reset-cursor        # ignore + clear saved cursor
 *
 * Bootstrap-Mode (Phase A3, manueller One-Shot über 5-7 Nächte):
 *   node scripts/crawl-all-regions.mjs --include-diamond \
 *        --max-cold-ids 400 --match-concurrency 4 --reset-cursor
 *
 * --max-cold-ids 400 weil startTime in der Pipeline auf set-start zurückgeht
 * (Default 200 reicht nicht für 7+ Tage Lücke). --match-concurrency 4 schont
 * Refresh-API-Headroom während des langen Bootstrap-Laufs.
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
// Kein Revalidate-Import mehr: MARKETVALUE_EDGE_PATHS ist am 2026-09-01
// entfernt worden, weil der Purge fuer diese Routen messbar wirkungslos war
// (Begruendung mit Zahlen in scripts/lib/revalidate-edge.mjs).

// ph2/th2 raus seit 2026-06-19 — 0 D2+ Spieler, 0 Crawl-Meta letzte 14 Tage.
// Bleiben aber gültige Riot-Routings (siehe app/lib/regions.ts). me1 bleibt
// trotz Pop=68 drin (Marktwert macht Pop-Stats-Bypass dort, kommt mit A4).
const CLUSTERS = {
  europe:   ['euw1', 'eun1', 'tr1', 'ru', 'me1'],
  americas: ['na1', 'br1', 'la1', 'la2'],
  asia:     ['kr', 'jp1'],
  sea:      ['oc1', 'sg2', 'tw2', 'vn2'],
};

// Canonical flat region order = clusters in definition order, regions within.
const REGION_ORDER = Object.values(CLUSTERS).flat();
const REGION_CLUSTER = {};
for (const [cluster, regions] of Object.entries(CLUSTERS)) {
  for (const region of regions) REGION_CLUSTER[region] = cluster;
}

const args = process.argv.slice(2);
const arg = (k) => {
  const eq = args.find(a => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const hasFlag = (k) => args.includes(k);

const clusterFilter = arg('--clusters');
const SKIP_SYNC = hasFlag('--skip-sync');
const RESET_CURSOR = hasFlag('--reset-cursor');

const EXTRA = [];
if (hasFlag('--include-diamond')) EXTRA.push('--include-diamond');
if (hasFlag('--verbose')) EXTRA.push('--verbose');
if (hasFlag('--force-refresh')) EXTRA.push('--force-refresh');
// --max-cold-ids für Bootstrap-Phase (A3) durchreichen — Default 200 reicht
// für Daily-Incremental, aber für Erstfill nach >7-Tage-Lücke braucht's eher
// 400 weil startTime einen großen Set-Range zurückgeht. Perf-Critic-Verdict
// 2026-06-19 für die Phase-0-Migration.
const MAX_COLD_IDS = arg('--max-cold-ids');
if (MAX_COLD_IDS) EXTRA.push('--max-cold-ids', MAX_COLD_IDS);
// --match-concurrency durchreichen, damit Bootstrap mit conc=4 (statt Default 6)
// laufen kann — schont Refresh-API-Headroom, der bei langem Bootstrap geteilt
// wird mit User-Refresh-Button und Pro-Validator.
const MATCH_CONCURRENCY = arg('--match-concurrency');
if (MATCH_CONCURRENCY) EXTRA.push('--match-concurrency', MATCH_CONCURRENCY);

// Cursor lives OUTSIDE /opt/metastats-crawler: remote-deploy.sh runs
// `git reset --hard` with a `git clean -fd` fallback, which would wipe an
// untracked file inside the repo. /etc/metastats-crawler/ is the persistent
// production dir (same place as the env file); fall back to cwd for local dev.
const CURSOR_PATH = process.env.MV_REGION_CURSOR
  || (existsSync('/etc/metastats-crawler') ? '/etc/metastats-crawler/mv-region-cursor.json' : 'mv-region-cursor.json');

function readCursor() {
  if (RESET_CURSOR) return null;
  try {
    return JSON.parse(readFileSync(CURSOR_PATH, 'utf8')).lastCompletedRegion || null;
  } catch {
    return null;
  }
}

function writeCursor(region) {
  try {
    mkdirSync(dirname(CURSOR_PATH), { recursive: true });
    // Atomic tmp+rename: a SIGKILL mid-write (OOM / disk event) must not leave a
    // truncated cursor — that resets the rotation to euw1 and re-crawls already-
    // done regions, wasting up to ~10h of quota. Audit H4, 2026-06-28.
    const tmp = `${CURSOR_PATH}.tmp`;
    writeFileSync(
      tmp,
      JSON.stringify({ lastCompletedRegion: region, updatedAt: new Date().toISOString() }, null, 2),
    );
    renameSync(tmp, CURSOR_PATH);
  } catch (err) {
    console.error(`[cursor] failed to persist (${CURSOR_PATH}): ${err.message}`);
  }
}

// Build this run's region order: rotate the canonical order to start right
// AFTER the last completed region, wrapping around so every region is covered.
function buildRunOrder() {
  let pool = REGION_ORDER;
  if (clusterFilter) {
    const set = new Set(clusterFilter.split(',').map(s => s.trim()).filter(Boolean));
    pool = REGION_ORDER.filter(r => set.has(REGION_CLUSTER[r]));
  }
  const last = readCursor();
  const idx = last ? pool.indexOf(last) : -1;
  if (idx < 0) return pool.slice();
  return [...pool.slice(idx + 1), ...pool.slice(0, idx + 1)];
}

// Graceful shutdown: on SIGTERM (the midnight Conflicts= stop, or `systemctl
// stop`) finish the in-flight region's own graceful flush, then exit WITHOUT
// advancing the cursor for that region so it resumes next run.
let stopping = false;
process.on('SIGTERM', () => {
  if (stopping) return;
  stopping = true;
  console.log('\n[orchestrator] SIGTERM — stopping after the current region flushes; '
    + 'cursor NOT advanced for the interrupted region (it resumes next run).');
});

function runChild(cmd, cmdArgs, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    const onLine = (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) console.log(`[${label}] ${line}`);
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);

    proc.on('close', code => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      if (code === 0) resolve({ label, elapsed });
      else reject(new Error(`${label} exited ${code} after ${elapsed}s`));
    });
  });
}

async function sync(label) {
  if (SKIP_SYNC) return;
  console.log(`[${label}] pushing to Supabase`);
  try {
    // sync-marketvalue-to-supabase.mjs filters on `snapshot_date = today` by
    // default which is exactly what we want here. Upsert semantics mean a later
    // sync harmlessly re-pushes anything an earlier one missed.
    await runChild('node', ['scripts/sync-marketvalue-to-supabase.mjs'], label);
  } catch (err) {
    console.error(`[${label}] FAILED: ${err.message}`);
    // Don't abort the whole run on a sync failure.
  }
}

async function main() {
  const t0 = Date.now();
  const order = buildRunOrder();
  console.log('=== crawl-all-regions (sequential, round-robin) ===');
  console.log(`    cursor: ${CURSOR_PATH} (last completed: ${readCursor() || 'none'})`);
  console.log(`    order: ${order.join(',')}`);
  console.log(`    sync-after-each-cluster: ${!SKIP_SYNC}`);

  for (let i = 0; i < order.length; i++) {
    if (stopping) break;
    const region = order[i];
    const cluster = REGION_CLUSTER[region];
    const label = `${cluster}/${region}`;
    console.log(`[${label}] start`);
    try {
      const { elapsed } = await runChild(
        'node',
        ['scripts/collect-tft-marketvalues.mjs', '--region', region, ...EXTRA],
        label,
      );
      console.log(`[${label}] done in ${elapsed}s`);
    } catch (err) {
      console.error(`[${label}] FAILED: ${err.message}`);
      // Fall through: a real failure still advances the cursor below so a broken
      // region can't wedge the rotation forever — it retries on the next pass.
    }

    if (stopping) {
      // Cut short by the midnight SIGTERM: leave the cursor on the previous
      // region so this one resumes (warm-cached) next run, then flush the
      // partial progress to Supabase before we exit.
      console.log(`[${label}] interrupted by shutdown — cursor left at previous region`);
      await sync('sync/shutdown');
      break;
    }

    writeCursor(region);

    // Sync at cluster boundaries (≈4×/run) to limit redundant full re-pushes.
    const next = order[i + 1];
    if (!next || REGION_CLUSTER[next] !== cluster) {
      await sync(`sync/${cluster}`);
    }
  }

  const elapsedMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== run done in ${elapsedMin} min ===`);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

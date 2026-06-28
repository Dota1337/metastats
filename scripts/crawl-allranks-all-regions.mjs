#!/usr/bin/env node
/**
 * Drive collect-tft-allranks.mjs across every active Riot region. Sequential per
 * region — the TFT prod key has one shared 500/10s app-wide bucket, so parallel
 * regions just fight each other.
 *
 * Resumable (Item 2 L2 + F2b/F3, 2026-06-28): the whole run is pinned to ONE
 * targetDay and a PER-DAY cursor file records each region the moment its child
 * exits 0. A region is "done" on exit 0 (not on rows written), or "given up"
 * after MAX_ATTEMPTS failures. Because cursors are per-day, a day left partial
 * after its window passes is not overwritten and can be re-targeted later by
 * `--resume-gaps` (the watchdog path), which crawls the OLDEST still-incomplete
 * day in the last K days. A shared Riot-bucket advisory lock serializes the
 * daily run, watchdog resumes and manual `--day` backfills so they never hammer
 * the bucket in parallel.
 *
 * Usage:
 *   node scripts/crawl-allranks-all-regions.mjs                  # all regions, mode=auto (today's D-2)
 *   node scripts/crawl-allranks-all-regions.mjs --resume-gaps    # oldest incomplete day in last K (watchdog)
 *   node scripts/crawl-allranks-all-regions.mjs --mode today     # rolling current-day (not cursor-tracked)
 *   node scripts/crawl-allranks-all-regions.mjs --day 2026-05-15 # backfill a specific day (waits for lock)
 *   node scripts/crawl-allranks-all-regions.mjs --regions=euw1,kr
 *   node scripts/crawl-allranks-all-regions.mjs --reset-cursor   # drop the target day's cursor, full re-crawl
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { revalidateEdge, STATS_EDGE_PATHS } from './lib/revalidate-edge.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { resolveDailyTargetDay } from './lib/tft-crawl-window.mjs';
import { tryAcquire, blockAcquire, releaseLock } from './lib/advisory-lock.mjs';
import {
  DEFAULT_K, DEFAULT_MAX_ATTEMPTS, cursorPath, startSeed, readCursor,
  markCompleted, recordAttempt, isSettled, selectTodo, selectGapDay,
  migrateLegacyCursor, pruneOldCursors,
} from './lib/daily-crawl-cursor.mjs';

const args = process.argv.slice(2);
const arg = (k) => {
  const eq = args.find((a) => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const hasFlag = (k) => args.includes(k);

const MODE = (arg('--mode') || 'auto').toLowerCase();
const DAY_OVERRIDE = arg('--day');
const RESUME_GAPS = hasFlag('--resume-gaps');
const regionFilter = arg('--regions');
const RESET_CURSOR = hasFlag('--reset-cursor');
const regions = regionFilter ? regionFilter.split(',').map((r) => r.trim()).filter(Boolean) : ACTIVE_REGIONS;

// mode=today is the rolling intraday run — no cursor, no lock (unchanged).
const RESUMABLE = MODE !== 'today';
// A manual --day backfill is operator-initiated and should WAIT for the bucket;
// systemd runs (auto / resume-gaps) skip if the lock is held (the watchdog
// re-fires later). Audit F3.
const BLOCK_LOCK = Boolean(DAY_OVERRIDE) && RESUMABLE;

const LOCK_PATH = process.env.DAILY_CRAWL_LOCK
  || (existsSync('/run/lock') ? '/run/lock/metastats-daily-crawl.lock' : '.daily-crawl.lock');
let lockHeld = false;
process.on('exit', () => { if (lockHeld) releaseLock(LOCK_PATH); });
process.on('SIGTERM', () => process.exit(143));

// Trigger the snapshot publisher ONLY when a run did real work (done > 0).
// Replaces the systemd OnSuccess=publisher that fired even on No-Op resume skips
// — with --resume-gaps a No-Op is the common case, and a needless full publish
// loads Supabase ~3x/day for nothing. Audit HIGH-1. Best-effort (no systemctl
// off the box).
function triggerPublisher() {
  try {
    const r = spawnSync('systemctl', ['start', '--no-block', 'metastats-snapshot-publisher.service'], { stdio: 'ignore' });
    if (r.error) console.log(`    [publisher] trigger skipped: ${r.error.code || r.error.message}`);
    else console.log('    [publisher] triggered (work done this run)');
  } catch (err) {
    console.log(`    [publisher] trigger skipped: ${err.message}`);
  }
}

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
    proc.on('close', (code) => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      if (code === 0) resolve({ label, elapsed });
      else reject(new Error(`${label} exited ${code} after ${elapsed}s`));
    });
  });
}

// The non-resumable rolling path (mode=today): crawl each region with its own
// per-child rolling window. No cursor, no lock — unchanged legacy behavior.
async function runTodayMode() {
  console.log(`=== crawl-allranks-all-regions (sequential) — mode=today ===`);
  let done = 0, failed = 0;
  for (const region of regions) {
    console.log(`\n[${region}] start`);
    try {
      const { elapsed } = await runChild('node', ['scripts/collect-tft-allranks.mjs', '--region', region, '--no-json', '--mode', 'today'], region);
      console.log(`[${region}] done in ${elapsed}s`); done++;
      await revalidateEdge(STATS_EDGE_PATHS, [], { label: `${region}/revalidate` });
    } catch (err) { console.error(`[${region}] FAILED: ${err.message}`); failed++; }
  }
  console.log(`\n=== complete — ${done} done, ${failed} failed ===`);
  if (failed > 0 && failed >= Math.ceil(regions.length / 2)) process.exit(1);
}

async function main() {
  if (!RESUMABLE) return runTodayMode();

  // 1) Acquire the shared Riot-bucket lock.
  if (BLOCK_LOCK) {
    const got = await blockAcquire(LOCK_PATH, { onWait: (s) => console.log(`    waiting for daily-crawl lock (${s}s)…`) });
    if (!got) { console.error('[lock] timed out (30 min) waiting for the daily-crawl lock — aborting backfill'); process.exit(1); }
  } else if (!tryAcquire(LOCK_PATH)) {
    console.log('[lock] another daily-crawl / resume / backfill holds the lock — skip (No-Op)');
    return;
  }
  lockHeld = true;

  // 2) One-time migration of the legacy single-file cursor — under the lock so
  //    two starters can't race the rename/unlink. Audit MED-3.
  migrateLegacyCursor();

  // 3) Resolve the target day UNDER the lock. For --resume-gaps the gap is
  //    re-selected here (post-acquire) so a day another run just finished is not
  //    re-crawled — TOCTOU fix. Audit HIGH-2.
  let targetDay;
  if (RESUME_GAPS) {
    targetDay = selectGapDay(new Date());
    if (!targetDay) { console.log('=== resume-gaps: no incomplete day in window — nothing to do ==='); return; }
    console.log(`    resume-gaps: oldest incomplete day = ${targetDay}`);
  } else {
    targetDay = resolveDailyTargetDay(new Date(), MODE, DAY_OVERRIDE);
  }

  // 4) Prune old cursors (auto runs only, excluding the running day). Audit MED-4.
  if (MODE === 'auto' && !DAY_OVERRIDE) pruneOldCursors(new Date(), DEFAULT_K, targetDay);

  if (RESET_CURSOR) {
    try { unlinkSync(cursorPath(targetDay)); console.log(`    --reset-cursor: dropped ${targetDay} cursor`); } catch { /* none */ }
  }

  const t0 = Date.now();
  const cursor = startSeed(targetDay);
  const todo = (regionFilter ? regions : ACTIVE_REGIONS).filter((r) => !isSettled(cursor, r, DEFAULT_MAX_ATTEMPTS));
  console.log(`=== targetDay=${targetDay} | ${cursor.completed.length} done, ${todo.length} todo ===`);
  if (todo.length === 0) { console.log(`=== ${targetDay} already complete — nothing to do ===`); return; }
  console.log(`    regions to crawl: ${todo.join(',')}`);

  let done = 0, failed = 0;
  for (const region of todo) {
    console.log(`\n[${region}] start`);
    try {
      const { elapsed } = await runChild('node', ['scripts/collect-tft-allranks.mjs', '--region', region, '--no-json', '--day', targetDay], region);
      console.log(`[${region}] done in ${elapsed}s`);
      done++;
      markCompleted(cursor, region); // exit-0 = done, persisted before revalidate
      await revalidateEdge(STATS_EDGE_PATHS, [], { label: `${region}/revalidate` });
    } catch (err) {
      console.error(`[${region}] FAILED: ${err.message}`);
      failed++;
      recordAttempt(cursor, region); // ++ attempts; settled after MAX_ATTEMPTS
    }
  }

  console.log(`\n=== complete in ${((Date.now() - t0) / 60_000).toFixed(1)} min — ${done} done, ${failed} failed ===`);

  // Publish only when this run actually crawled something. Audit HIGH-1.
  if (done > 0) triggerPublisher();

  // Substantial failure -> exit 1 so even a manual chain wouldn't treat it as a
  // clean success; the failed regions stay un-settled for the next resume tick.
  if (failed > 0 && failed >= Math.ceil(todo.length / 2)) {
    console.error(`[exit 1] ${failed}/${todo.length} regions failed`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch((err) => { console.error('FAIL:', err.message); process.exit(1); });
}

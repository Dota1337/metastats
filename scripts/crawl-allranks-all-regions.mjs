#!/usr/bin/env node
/**
 * Drive collect-tft-allranks.mjs across every active Riot region. Replaces the
 * GH-Action TFT Daily Crawl which was chronically cancelled because 17
 * parallel runners blew through the Free-tier action minutes budget in
 * a day or two.
 *
 * Sequential per region — TFT prod key has one shared 500/10s app-wide
 * bucket, so parallel regions just fight each other.
 *
 * Resumable (Backlog-Item 2 L2): the whole run is pinned to ONE targetDay and a
 * cursor file records each region the moment its child exits 0. Re-invoking the
 * driver for the same targetDay (systemd restart, or the 16:00 watchdog after a
 * partial outage) skips the already-completed regions and crawls only the rest.
 * A region is "done" purely on exit 0 — independent of whether it wrote rows —
 * so a legitimately empty region (0 ranked matches in the window) is not
 * re-crawled forever, which a DB-row-presence check could not distinguish from
 * a 522 failure (data-skeptic / logic-flow-critic, 2026-06-28).
 *
 * Used by the systemd metastats-daily-crawl.timer (00:00 UTC mode=auto).
 *
 * Usage:
 *   node scripts/crawl-allranks-all-regions.mjs                    # all regions, mode=auto
 *   node scripts/crawl-allranks-all-regions.mjs --mode today       # rolling current-day (not cursor-tracked)
 *   node scripts/crawl-allranks-all-regions.mjs --day 2026-05-15   # backfill specific day
 *   node scripts/crawl-allranks-all-regions.mjs --regions=euw1,kr  # subset
 *   node scripts/crawl-allranks-all-regions.mjs --reset-cursor     # ignore prior cursor, full re-crawl
 */

import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { revalidateEdge, STATS_EDGE_PATHS } from './lib/revalidate-edge.mjs';
import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { resolveDailyTargetDay } from './lib/tft-crawl-window.mjs';

const args = process.argv.slice(2);
const arg = (k) => {
  const eq = args.find(a => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};
const hasFlag = (k) => args.includes(k);

const MODE = (arg('--mode') || 'auto').toLowerCase();
const DAY_OVERRIDE = arg('--day');
const regionFilter = arg('--regions');
const RESET_CURSOR = hasFlag('--reset-cursor');
const regions = regionFilter
  ? regionFilter.split(',').map(r => r.trim()).filter(Boolean)
  : ACTIVE_REGIONS;

// Intraday rolling runs (mode=today) overwrite the whole day repeatedly, so a
// resume cursor is meaningless for them. Only the auto daily run and explicit
// --day backfills are pinned + cursor-tracked + resumable.
const RESUMABLE = MODE !== 'today';

// Pin ONE targetDay for the whole run so every region writes the same
// day/window and a later resume reproduces the exact slot. For mode=auto this
// anchors to 00:00 UTC -> D-2 (most recent COMPLETE window) regardless of
// wall-clock at start, so the 16:00 watchdog computes the identical day the
// 00:00 run did rather than drifting to D-1 past the 05:00 boundary.
const TARGET_DAY = RESUMABLE ? resolveDailyTargetDay(new Date(), MODE, DAY_OVERRIDE) : null;

// Cursor lives in /etc (survives the box's `git reset --hard` deploys, unlike
// /opt). Env override for tests / non-box runs; local fallback otherwise.
export const CURSOR_PATH = process.env.DAILY_CRAWL_CURSOR
  || (existsSync('/etc/metastats-crawler')
        ? '/etc/metastats-crawler/daily-crawl-cursor.json'
        : '.daily-crawl-cursor.json');
const CURSOR_VERSION = 1;

// Read the cursor for `targetDay`. A cursor stamped with a different day (or an
// unreadable/future-schema one) is treated as absent -> fresh start. This is
// what makes each new day's first run begin from zero without an explicit wipe.
export function readCursor(targetDay, { reset = RESET_CURSOR, path = CURSOR_PATH } = {}) {
  if (reset) return { day: targetDay, completed: [] };
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw.day !== targetDay) return { day: targetDay, completed: [] };
    if ((raw.cursorVersion ?? 1) > CURSOR_VERSION) return { day: targetDay, completed: [] };
    return { day: targetDay, completed: Array.isArray(raw.completed) ? raw.completed : [] };
  } catch {
    return { day: targetDay, completed: [] };
  }
}

// Atomic write: tmp + rename so a crash mid-write can't truncate the cursor.
export function writeCursor(cursor, { path = CURSOR_PATH } = {}) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify({
      cursorVersion: CURSOR_VERSION,
      day: cursor.day,
      completed: cursor.completed,
    }, null, 2));
    renameSync(tmp, path);
  } catch (err) {
    console.error(`[cursor] persist failed (${path}): ${err.message}`);
  }
}

export function selectTodo(allRegions, completed) {
  const done = new Set(completed);
  return allRegions.filter(r => !done.has(r));
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

    proc.on('close', code => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      if (code === 0) resolve({ label, elapsed });
      else reject(new Error(`${label} exited ${code} after ${elapsed}s`));
    });
  });
}

async function main() {
  const t0 = Date.now();
  const dayLabel = DAY_OVERRIDE ? `day=${DAY_OVERRIDE}` : `mode=${MODE}`;
  console.log(`=== crawl-allranks-all-regions (sequential) — ${dayLabel} ===`);

  let cursor = null;
  let todo = regions;
  if (RESUMABLE) {
    cursor = readCursor(TARGET_DAY);
    if (RESET_CURSOR) console.log('    --reset-cursor: prior cursor ignored');
    todo = selectTodo(regions, cursor.completed);
    console.log(`    targetDay=${TARGET_DAY} | ${cursor.completed.length}/${regions.length} already done`
      + (cursor.completed.length ? ` (${cursor.completed.join(',')})` : ''));
    if (todo.length === 0) {
      console.log(`=== all ${regions.length} regions already complete for ${TARGET_DAY} — nothing to do ===`);
      return;
    }
  }
  console.log(`    regions to crawl: ${todo.join(',')}`);

  let done = 0, failed = 0;
  for (const region of todo) {
    const label = region;
    console.log(`\n[${label}] start`);
    const cmdArgs = ['scripts/collect-tft-allranks.mjs', '--region', region, '--no-json'];
    // Resumable runs pin every child to the run-wide targetDay so all regions
    // share one day/window; mode=today stays a rolling per-child window.
    if (RESUMABLE) cmdArgs.push('--day', TARGET_DAY);
    else cmdArgs.push('--mode', MODE);
    try {
      const { elapsed } = await runChild('node', cmdArgs, label);
      console.log(`[${label}] done in ${elapsed}s`);
      done++;
      // Mark completed on exit 0 BEFORE the (best-effort) edge revalidation, so
      // a crash during revalidate doesn't lose the region from the cursor.
      if (RESUMABLE && cursor) {
        cursor.completed.push(region);
        writeCursor(cursor);
      }
      // Plan A — Push-Invalidation. Non-blocking best-effort: if the secret is
      // missing or the endpoint doesn't answer, the crawl continues and the
      // edge cache just expires on its regular TTL.
      await revalidateEdge(STATS_EDGE_PATHS, [], { label: `${label}/revalidate` });
    } catch (err) {
      console.error(`[${label}] FAILED: ${err.message}`);
      failed++;
    }
  }

  const elapsedMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== complete in ${elapsedMin} min — ${done} done, ${failed} failed ===`);
  // Cursor is intentionally NOT deleted on full success: the 16:00 watchdog must
  // be able to read it and see "all done -> nothing to do". Next day's run gets
  // a fresh cursor automatically via the day-key mismatch in readCursor.
  // Exit non-zero on SUBSTANTIAL failure (>=50% of regions) so systemd does NOT
  // fire the OnSuccess chain — snapshot-publisher would otherwise replace the
  // manifest with near-empty data for a mostly-missing day. Minor failures exit
  // 0: those regions stay out of the cursor and the watchdog resume completes +
  // re-publishes them. Audit H1, 2026-06-28.
  if (failed > 0 && failed >= Math.ceil(todo.length / 2)) {
    console.error(`[exit 1] ${failed}/${todo.length} regions failed — suppressing OnSuccess chain`);
    process.exit(1);
  }
}

// Only run when executed directly — importing for tests must not crawl.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  main().catch(err => {
    console.error('FAIL:', err.message);
    process.exit(1);
  });
}

#!/usr/bin/env node
/**
 * Drive collect-tft-allranks.mjs across every Riot region. Replaces the
 * GH-Action TFT Daily Crawl which was chronically cancelled because 17
 * parallel runners blew through the Free-tier action minutes budget in
 * a day or two.
 *
 * Sequential per region — TFT prod key has one shared 500/10s app-wide
 * bucket, so parallel regions just fight each other. Per-region timeout
 * (default 90 min) so one stuck region doesn't lock the others out.
 *
 * collect-tft-allranks.mjs writes straight to Supabase, so no sync step
 * is needed — we just orchestrate the runs.
 *
 * Used by the systemd metastats-daily-crawl.timer (05:15 UTC mode=auto).
 *
 * Usage:
 *   node scripts/crawl-allranks-all-regions.mjs                    # all regions, mode=auto
 *   node scripts/crawl-allranks-all-regions.mjs --mode today       # rolling current-day
 *   node scripts/crawl-allranks-all-regions.mjs --day 2026-05-15   # backfill specific day
 *   node scripts/crawl-allranks-all-regions.mjs --regions=euw1,kr  # subset
 *   node scripts/crawl-allranks-all-regions.mjs --region-timeout=120
 */

import { spawn } from 'node:child_process';

const ALL_REGIONS = [
  'euw1', 'kr', 'na1', 'eun1',     // primary 4 — most traffic
  'br1', 'jp1', 'tr1', 'ru', 'me1',
  'la1', 'la2',
  'oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2',
];

const args = process.argv.slice(2);
const arg = (k) => {
  const eq = args.find(a => a.startsWith(`${k}=`));
  if (eq) return eq.slice(k.length + 1);
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : null;
};

const MODE = (arg('--mode') || 'auto').toLowerCase();
const DAY_OVERRIDE = arg('--day');
const REGION_TIMEOUT_MIN = Number(arg('--region-timeout') || 90);
const REGION_TIMEOUT_MS = REGION_TIMEOUT_MIN * 60 * 1000;
const regionFilter = arg('--regions');
const regions = regionFilter
  ? regionFilter.split(',').map(r => r.trim()).filter(Boolean)
  : ALL_REGIONS;

function runChild(cmd, cmdArgs, label, { timeoutMs = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const proc = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let timeoutHandle = null;
    let timedOut = false;

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        console.error(`[${label}] timeout after ${Math.round(timeoutMs / 60000)} min — sending SIGTERM`);
        proc.kill('SIGTERM');
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } }, 10_000);
      }, timeoutMs);
    }

    const onLine = (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) console.log(`[${label}] ${line}`);
    };
    proc.stdout.on('data', onLine);
    proc.stderr.on('data', onLine);

    proc.on('close', code => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      if (timedOut) reject(new Error(`${label} killed by timeout after ${elapsed}s`));
      else if (code === 0) resolve({ label, elapsed });
      else reject(new Error(`${label} exited ${code} after ${elapsed}s`));
    });
  });
}

async function main() {
  const t0 = Date.now();
  const dayLabel = DAY_OVERRIDE ? `day=${DAY_OVERRIDE}` : `mode=${MODE}`;
  console.log(`=== crawl-allranks-all-regions (sequential) — ${dayLabel} ===`);
  console.log(`    regions: ${regions.join(',')}`);
  console.log(`    timeout per region: ${REGION_TIMEOUT_MIN} min`);

  let done = 0, failed = 0;
  for (const region of regions) {
    const label = region;
    console.log(`\n[${label}] start (timeout ${REGION_TIMEOUT_MIN} min)`);
    const cmdArgs = ['scripts/collect-tft-allranks.mjs', '--region', region, '--no-json'];
    if (DAY_OVERRIDE) cmdArgs.push('--day', DAY_OVERRIDE);
    else cmdArgs.push('--mode', MODE);
    try {
      const { elapsed } = await runChild('node', cmdArgs, label, { timeoutMs: REGION_TIMEOUT_MS });
      console.log(`[${label}] done in ${elapsed}s`);
      done++;
    } catch (err) {
      console.error(`[${label}] FAILED: ${err.message}`);
      failed++;
    }
  }

  const elapsedMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== complete in ${elapsedMin} min — ${done} done, ${failed} failed ===`);
  if (failed > 0 && failed === regions.length) process.exit(1);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

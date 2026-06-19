#!/usr/bin/env node
/**
 * Drive collect-tft-allranks.mjs across every Riot region. Replaces the
 * GH-Action TFT Daily Crawl which was chronically cancelled because 17
 * parallel runners blew through the Free-tier action minutes budget in
 * a day or two.
 *
 * Sequential per region — TFT prod key has one shared 500/10s app-wide
 * bucket, so parallel regions just fight each other.
 *
 * No artificial per-region timeout: a region runs until it naturally finishes.
 * The only time limits are riot-client.mjs's per-request timeout + rate limits
 * (external-API constraints). collect-tft-allranks.mjs writes straight to
 * Supabase, so no sync step is needed — we just orchestrate the runs.
 *
 * Used by the systemd metastats-daily-crawl.timer (00:00 UTC mode=auto).
 *
 * Usage:
 *   node scripts/crawl-allranks-all-regions.mjs                    # all regions, mode=auto
 *   node scripts/crawl-allranks-all-regions.mjs --mode today       # rolling current-day
 *   node scripts/crawl-allranks-all-regions.mjs --day 2026-05-15   # backfill specific day
 *   node scripts/crawl-allranks-all-regions.mjs --regions=euw1,kr  # subset
 */

import { spawn } from 'node:child_process';
import { revalidateEdge, STATS_EDGE_PATHS } from './lib/revalidate-edge.mjs';

// ph2/th2 raus — 0 D2+ Spieler in TFT (verifiziert 2026-06-19 gegen
// tft_daily_crawl_meta letzte 14 Tage). me1 bleibt drin trotz n=68 Pop
// (Marktwert macht dort Pop-Stats-Bypass, alles andere zählt normal).
const ALL_REGIONS = [
  'euw1', 'kr', 'na1', 'eun1',     // primary 4 — most traffic
  'br1', 'jp1', 'tr1', 'ru', 'me1',
  'la1', 'la2',
  'oc1', 'sg2', 'tw2', 'vn2',
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
const regionFilter = arg('--regions');
const regions = regionFilter
  ? regionFilter.split(',').map(r => r.trim()).filter(Boolean)
  : ALL_REGIONS;

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
  console.log(`    regions: ${regions.join(',')}`);

  let done = 0, failed = 0;
  for (const region of regions) {
    const label = region;
    console.log(`\n[${label}] start`);
    const cmdArgs = ['scripts/collect-tft-allranks.mjs', '--region', region, '--no-json'];
    if (DAY_OVERRIDE) cmdArgs.push('--day', DAY_OVERRIDE);
    else cmdArgs.push('--mode', MODE);
    try {
      const { elapsed } = await runChild('node', cmdArgs, label);
      console.log(`[${label}] done in ${elapsed}s`);
      done++;
      // Plan A — Push-Invalidation. Direkt nach jedem Region-Crawl-Fertig den
      // Vercel-Edge-Cache invalidieren, damit die Stats-APIs nicht 6h auf die
      // alte Antwort festkleben. revalidateEdge ist non-blocking-best-effort:
      // wenn das Secret fehlt oder der Endpoint nicht antwortet, geht der
      // Crawl trotzdem weiter — Cache läuft halt seine reguläre TTL ab.
      await revalidateEdge(STATS_EDGE_PATHS, [], { label: `${label}/revalidate` });
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

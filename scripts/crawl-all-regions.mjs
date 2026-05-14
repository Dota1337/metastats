#!/usr/bin/env node
/**
 * Drive collect-tft-marketvalues.mjs across every Riot region, then run
 * the Supabase sync once everything has landed in the Hetzner Postgres.
 *
 * Riot's rate-limits are scoped per routing cluster (europe / americas /
 * asia / sea), so we run one sub-process per cluster in parallel — each
 * cluster crunches its regions sequentially so the inner rate-limiter
 * doesn't fight itself.
 *
 * Used by the systemd daily timer (04:00 UTC).
 *
 * Usage:
 *   node scripts/crawl-all-regions.mjs                       # all clusters
 *   node scripts/crawl-all-regions.mjs --clusters=europe     # subset
 *   node scripts/crawl-all-regions.mjs --skip-sync           # crawl only
 *   node scripts/crawl-all-regions.mjs --include-diamond     # extend scope
 */

import { spawn } from 'node:child_process';

const CLUSTERS = {
  europe:   ['euw1', 'eun1', 'tr1', 'ru', 'me1'],
  americas: ['na1', 'br1', 'la1', 'la2'],
  asia:     ['kr', 'jp1'],
  sea:      ['oc1', 'ph2', 'sg2', 'th2', 'tw2', 'vn2'],
};

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
const EXTRA = [];
if (hasFlag('--include-diamond')) EXTRA.push('--include-diamond');
if (hasFlag('--verbose')) EXTRA.push('--verbose');
if (hasFlag('--force-refresh')) EXTRA.push('--force-refresh');

const targetClusters = clusterFilter
  ? Object.fromEntries(clusterFilter.split(',').map(c => [c.trim(), CLUSTERS[c.trim()]]).filter(([, v]) => v))
  : CLUSTERS;

function runChild(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const buf = [];
    const onLine = (chunk) => {
      const lines = chunk.toString('utf8').split('\n').filter(Boolean);
      for (const line of lines) {
        buf.push(line);
        // Prefix every line with the label so interleaved cluster output stays readable
        console.log(`[${label}] ${line}`);
      }
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

async function crawlCluster(cluster, regions) {
  for (const region of regions) {
    const label = `${cluster}/${region}`;
    console.log(`[${label}] start`);
    try {
      const { elapsed } = await runChild('node', ['scripts/collect-tft-marketvalues.mjs', '--region', region, ...EXTRA], label);
      console.log(`[${label}] done in ${elapsed}s`);
    } catch (err) {
      console.error(`[${label}] FAILED: ${err.message}`);
      // Carry on — one region's failure shouldn't abort the others
    }
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`=== crawl-all-regions — clusters: ${Object.keys(targetClusters).join(',')} ===`);

  await Promise.all(
    Object.entries(targetClusters).map(([cluster, regions]) => crawlCluster(cluster, regions))
  );

  const elapsedCrawl = ((Date.now() - t0) / 1000 / 60).toFixed(1);
  console.log(`\n=== all clusters done in ${elapsedCrawl} min ===`);

  if (!SKIP_SYNC) {
    console.log('\n[sync] pushing to Supabase');
    try {
      await runChild('node', ['scripts/sync-marketvalue-to-supabase.mjs'], 'sync');
    } catch (err) {
      console.error(`[sync] FAILED: ${err.message}`);
      process.exit(2);
    }
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

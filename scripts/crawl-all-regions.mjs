#!/usr/bin/env node
/**
 * Drive collect-tft-marketvalues.mjs across every Riot region. Clusters run
 * SEQUENTIALLY, regions WITHIN a cluster also sequentially — the TFT
 * production key has a single 500/10s app-wide bucket, so parallel cluster
 * crawls just fight for the same quota and end up slower overall.
 *
 * After every cluster finishes we push the cluster's snapshots to Supabase
 * right away, so partial progress is visible on metastats.gg even if a later
 * cluster crashes.
 *
 * No artificial per-region timeout: a region runs until it naturally finishes.
 * The only time limits in the pipeline are the per-request timeout + rate
 * limits inside riot-client.mjs (external-API constraints) — see
 * scripts/lib/riot-client.mjs.
 *
 * Used by the systemd metastats-crawler.service (chained after the daily crawl).
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

async function crawlCluster(cluster, regions) {
  for (const region of regions) {
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
      // Carry on — one region's failure shouldn't abort the others
    }
  }
}

async function syncCluster(cluster) {
  if (SKIP_SYNC) return;
  console.log(`[sync/${cluster}] pushing to Supabase`);
  try {
    // Sync everything that's fresh — sync-marketvalue-to-supabase.mjs filters
    // on `snapshot_date = today` by default which is exactly what we want here.
    await runChild('node', ['scripts/sync-marketvalue-to-supabase.mjs'], `sync/${cluster}`);
  } catch (err) {
    console.error(`[sync/${cluster}] FAILED: ${err.message}`);
    // Don't abort the whole run on a sync failure — the next cluster's sync
    // will pick up everything thanks to upsert semantics.
  }
}

async function main() {
  const t0 = Date.now();
  console.log(`=== crawl-all-regions (sequential) — clusters: ${Object.keys(targetClusters).join(',')} ===`);
  console.log(`    sync-after-each: ${!SKIP_SYNC}`);

  for (const [cluster, regions] of Object.entries(targetClusters)) {
    const tCluster = Date.now();
    await crawlCluster(cluster, regions);
    const clusterMin = ((Date.now() - tCluster) / 60_000).toFixed(1);
    console.log(`\n=== cluster ${cluster} done in ${clusterMin} min ===\n`);
    await syncCluster(cluster);
  }

  const elapsedMin = ((Date.now() - t0) / 60_000).toFixed(1);
  console.log(`\n=== all clusters done in ${elapsedMin} min ===`);
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

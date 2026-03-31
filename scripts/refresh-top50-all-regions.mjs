#!/usr/bin/env node
/**
 * Refreshes market values for Top 50 players per tier (Challenger, GM, Master)
 * across EUW, NA, and KR. Total: 450 players.
 *
 * Usage: node scripts/refresh-top50-all-regions.mjs
 * Requires: dev server running (npm run dev)
 *
 * Estimated time: ~11 hours (450 players × 95s delay)
 */

import { execSync, spawn } from 'child_process';

const REGIONS = ['euw1', 'na1', 'kr'];
const TOP_PER_TIER = 50;

async function runRegion(region) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Starting region: ${region.toUpperCase()}`);
    console.log(`${'='.repeat(60)}\n`);

    const child = spawn('node', [
      'scripts/refresh-highelo-marketvalues.mjs',
      '--region', region,
      '--all-tiers',
      '--top-per-tier', String(TOP_PER_TIER),
    ], {
      stdio: 'inherit',
      cwd: process.cwd(),
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Region ${region} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const totalPlayers = REGIONS.length * 3 * TOP_PER_TIER;
  const estimatedHours = (totalPlayers * 95 / 3600).toFixed(1);

  console.log('=== Market Value Refresh: All Regions ===');
  console.log(`Regions: ${REGIONS.join(', ')}`);
  console.log(`Tiers: Challenger + Grandmaster + Master`);
  console.log(`Top per tier: ${TOP_PER_TIER}`);
  console.log(`Total players: ~${totalPlayers}`);
  console.log(`Estimated time: ~${estimatedHours} hours`);
  console.log(`Started at: ${new Date().toLocaleString('de-DE')}`);

  for (const region of REGIONS) {
    try {
      await runRegion(region);
      console.log(`\n[OK] ${region.toUpperCase()} complete.`);
    } catch (e) {
      console.error(`\n[FAIL] ${region.toUpperCase()}: ${e.message}`);
      console.log('Continuing with next region...');
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`All regions done at: ${new Date().toLocaleString('de-DE')}`);
  console.log(`${'='.repeat(60)}`);
}

main();

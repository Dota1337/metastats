#!/usr/bin/env node
/**
 * Collect champion stats for multiple regions.
 * Usage: node scripts/collect-all-regions.mjs [--regions euw1,kr,na1]
 *
 * Calls the /api/champions/collect endpoint for each region sequentially.
 * Requires the dev server to be running (npm run dev).
 */

const DEFAULT_REGIONS = ['euw1', 'kr', 'na1'];
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

const args = process.argv.slice(2);
let regions = DEFAULT_REGIONS;

const regionArg = args.find(a => a.startsWith('--regions'));
if (regionArg) {
  const idx = args.indexOf(regionArg);
  regions = (args[idx + 1] || '').split(',').map(r => r.trim()).filter(Boolean);
}

async function collectRegion(region) {
  console.log(`\n[${region.toUpperCase()}] Starting collection...`);
  const start = Date.now();

  try {
    const res = await fetch(`${BASE_URL}/api/champions/collect?region=${region}&refresh=1`);
    if (!res.ok) {
      const text = await res.text();
      console.log(`[${region.toUpperCase()}] ERROR ${res.status}: ${text}`);
      return false;
    }

    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[${region.toUpperCase()}] Done in ${elapsed}s`);
    console.log(`  Matches analyzed: ${data.matchesAnalyzed}`);
    console.log(`  Champions found: ${data.championsFound}`);
    console.log(`  Saved to Supabase: ${data.savedToSupabase}`);
    if (data.perTier) {
      for (const [tier, info] of Object.entries(data.perTier)) {
        console.log(`  ${tier}: ${info.matches} matches, ${info.champions} champions`);
      }
    }
    return true;
  } catch (e) {
    console.log(`[${region.toUpperCase()}] FAILED: ${e.message}`);
    return false;
  }
}

async function main() {
  console.log(`Collecting champion stats for regions: ${regions.join(', ')}`);
  console.log(`Base URL: ${BASE_URL}`);

  let success = 0;
  let failed = 0;

  for (const region of regions) {
    const ok = await collectRegion(region);
    if (ok) success++;
    else failed++;
  }

  console.log(`\nDone. Success: ${success}, Failed: ${failed}`);
}

main();

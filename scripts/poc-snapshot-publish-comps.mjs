#!/usr/bin/env node
// POC: render the default-filter /api/tft/comps response once and persist it
// as a static snapshot under public/snapshots/tft/comps/v1-default.json.
//
// Strategy: call the production API once (cold path, slow), parse the JSON,
// write it to disk. From there every future request that matches the default
// filter is served from the static file by app/api/tft/comps/route.ts —
// sub-100 ms vs. the cold 150-3000 ms RPC roundtrip we have today.
//
// Why call the live API rather than re-implementing the aggregation: zero risk
// of payload drift. The snapshot is byte-identical to what the API returns
// today. When we expand beyond the POC we'll move this into the daily-crawl
// hook on Hetzner.
//
// Usage: node scripts/poc-snapshot-publish-comps.mjs [baseUrl]
//        defaults to https://www.metastats.gg

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = process.argv[2] || 'https://www.metastats.gg';
const FILTER = 'patch=current&region=all&days=3&bucket=master_plus&minGames=30&source=data';
const URL = `${BASE}/api/tft/comps?${FILTER}`;
const OUT_DIR = path.join(process.cwd(), 'public', 'snapshots', 'tft', 'comps');
const OUT_FILE = path.join(OUT_DIR, 'v1-default.json');

function ts() { return new Date().toISOString(); }

async function main() {
  console.log(`[${ts()}] Fetching: ${URL}`);
  const t0 = Date.now();
  const res = await fetch(URL, {
    headers: { 'Cache-Control': 'no-cache', 'x-snapshot-publisher': '1' },
  });
  const elapsed = Date.now() - t0;
  if (!res.ok) {
    console.error(`[${ts()}] Fetch failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const payload = await res.json();
  console.log(`[${ts()}] Fetched in ${elapsed} ms`);
  console.log(`[${ts()}] hasData=${payload.hasData}, comps=${payload.comps?.length}, patch=${payload.filters?.patch}`);

  if (!payload.hasData || !Array.isArray(payload.comps) || payload.comps.length === 0) {
    console.error(`[${ts()}] Refusing to publish empty snapshot.`);
    process.exit(1);
  }

  // Annotate the snapshot itself so the route can sanity-check freshness later.
  payload._snapshot = {
    builtAt: ts(),
    builtFromUrl: URL,
    fetchMs: elapsed,
    version: 'v1',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(payload), 'utf8');
  const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
  console.log(`[${ts()}] Wrote ${OUT_FILE} (${(bytes / 1024).toFixed(1)} KB)`);
}

main().catch(e => {
  console.error(`[${ts()}] Error:`, e.message);
  process.exit(1);
});

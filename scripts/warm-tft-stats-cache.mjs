#!/usr/bin/env node
// Cache-warmer for the TFT stats endpoints.
//
// The stats APIs cache at the Vercel edge for 6h (+24h stale-while-revalidate)
// because the underlying data only changes once a day, after the Hetzner
// aggregate crawl (00:00 UTC start, done by ~09:00 UTC). With caching alone the
// FIRST visitor of each popular filter combo every morning still pays the cold
// Supabase RPC (~1.5s). This script pre-fires those exact combos right after
// the crawl so the edge holds a fresh copy before any user arrives — every real
// request then gets an instant X-Vercel-Cache: HIT.
//
// It hits the SAME query strings the stats pages build (filtersToQueryString
// order: patch, bucket, days, region — see app/components/tft/StatsFilterBar)
// so the warmed cache keys match the ones users hit exactly. No secrets needed
// — these are public GET endpoints.
//
// Usage:
//   node scripts/warm-tft-stats-cache.mjs
//   WARM_BASE_URL=https://staging... WARM_CONCURRENCY=6 node scripts/warm-tft-stats-cache.mjs

const BASE = (process.env.WARM_BASE_URL || 'https://www.metastats.gg').replace(/\/$/, '');
// Serial by default. These are heavy aggregation RPCs sharing one Postgres;
// firing several region=all slices at once makes them contend and tip over the
// 20s statement timeout (observed: 3-wide → 502s, 1-wide → all 24 keys warm
// cleanly). Warming is a background job, so the ~2-3min serial cold run is
// fine. Override with WARM_CONCURRENCY only against a warm cache.
const CONCURRENCY = Math.max(1, Number(process.env.WARM_CONCURRENCY) || 1);
// 60s default: covers the onetricks cold path (Hetzner pool + 1000-puuid
// match fetch + classify, ~10-30s). Stats RPCs are all well under this.
const TIMEOUT_MS = Math.max(5_000, Number(process.env.WARM_TIMEOUT_MS) || 60_000);

// patch=current always: the stats pages never deep-link a specific patch, they
// resolve "current" server-side to the newest established patch.
const PATCH = 'current';

// MUST mirror filtersToQueryString's insertion order — the edge cache key is
// the literal query string, so a different order is a different (cold) key.
function qs(bucket, days, region) {
  return `patch=${PATCH}&bucket=${bucket}&days=${days}&region=${region}`;
}

// Combos are restricted to slices that stay safely under the 20s Supabase
// statement timeout even cold (measured 2026-05). The comp LIST RPC was made
// lean in migration 0027, so comps is fast across the board (all-bucket/7d
// ~5s) and gets the full matrix. The units/items/traits RPCs are NOT lean yet
// — get_tft_item_stats over all buckets / 7 days is ~76s today and 502s — so
// they're warmed only on the light, high-traffic slices that complete quickly.
// Warming the slow-but-working ones (e.g. items diamond/3d ~9s) is exactly
// where warming pays off: the morning visitor gets a HIT instead of the 9s.
function buildUrls() {
  const urls = new Set();

  // Comps — full matrix (lean RPC, all slices fast).
  for (const bucket of ['diamond', 'master_plus', 'all']) {
    for (const days of [3, 7]) {
      urls.add(`/api/tft/comps?${qs(bucket, days, 'all')}&source=data`);
    }
  }
  // Region split for the two top buckets at the default 3-day window — the
  // comp meta is region-specific and these are the common region toggles.
  for (const bucket of ['diamond', 'master_plus']) {
    for (const region of ['all', 'west', 'asia', 'euw1', 'kr', 'na1']) {
      urls.add(`/api/tft/comps?${qs(bucket, 3, region)}&source=data`);
    }
  }

  // Units / items / traits — the high-traffic rank slices at region=all.
  // items got the lean RPC in migration 0028 (all-bucket/7d 76s→5.5s), so it
  // now warms the same matrix as the others instead of just the safe defaults.
  for (const ep of ['units', 'items', 'traits']) {
    urls.add(`/api/tft/${ep}?${qs('diamond', 3, 'all')}`);
    urls.add(`/api/tft/${ep}?${qs('master_plus', 3, 'all')}`);
    urls.add(`/api/tft/${ep}?${qs('master_plus', 7, 'all')}`);
  }

  // Onetricks — region-scoped Master+ one-trick detection. Cold call goes
  // through the Hetzner /marketvalue-pool + /player-matches chain and takes
  // 10-30s (1000 puuids × 50 matches ≈ 40MB JSON transfer). Edge cache is
  // 6h, so warming once a day right after the daily crawl finishes keeps
  // every real user hit instant. Only the regions with enough Master+ pool
  // to be worth warming.
  for (const region of ['euw1', 'kr', 'na1', 'eun1', 'br1', 'jp1']) {
    urls.add(`/api/tft/onetricks?region=${region}`);
  }

  // Meta-Pulse + Patch-Diff — landing-tier pages, both cold ~10s. Patch-diff
  // matrix covers the 4 entity types × 2 default buckets users actually open.
  // Meta-pulse is single-bucket per call.
  urls.add(`/api/tft/meta-pulse?bucket=master_plus&days=3&patch=current`);
  urls.add(`/api/tft/meta-pulse?bucket=diamond&days=3&patch=current`);
  for (const entity of ['unit', 'item', 'trait', 'comp']) {
    for (const bucket of ['master_plus', 'diamond']) {
      urls.add(`/api/tft/patch-diff?entity=${entity}&bucket=${bucket}`);
    }
  }

  return [...urls];
}

async function warmOne(path) {
  const url = `${BASE}${path}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      // A bare GET, exactly like the browser — no cache-bust param, so we hit
      // (and populate) the real cache key. cache:no-store keeps THIS process
      // from reusing anything; the edge still caches the response.
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const ms = Date.now() - start;
    const edge = res.headers.get('x-vercel-cache') || '-';
    let comps = '';
    if (res.ok) {
      // Light sanity read so a 200-with-error-body doesn't count as warmed.
      const body = await res.json().catch(() => null);
      const ok = body && (body.hasData !== false);
      comps = ok ? '' : ' (hasData:false)';
      return { path, ok: res.ok, status: res.status, ms, edge, note: comps };
    }
    return { path, ok: false, status: res.status, ms, edge, note: '' };
  } catch (e) {
    return { path, ok: false, status: 0, ms: Date.now() - start, edge: '-', note: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

// Simple fixed-size worker pool over the URL list.
async function run() {
  const urls = buildUrls();
  console.log(`Warming ${urls.length} TFT stats cache keys on ${BASE} (concurrency ${CONCURRENCY})`);
  const queue = [...urls];
  const results = [];
  async function worker() {
    while (queue.length) {
      const path = queue.shift();
      const r = await warmOne(path);
      results.push(r);
      const flag = r.ok ? 'ok ' : 'ERR';
      console.log(`  [${flag}] ${String(r.status).padStart(3)} ${r.edge.padEnd(6)} ${String(r.ms).padStart(5)}ms  ${r.path}${r.note}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const failed = results.filter(r => !r.ok);
  const miss = results.filter(r => r.edge === 'MISS').length;
  const hit = results.filter(r => r.edge === 'HIT' || r.edge === 'STALE').length;
  console.log(`\nDone: ${results.length - failed.length}/${results.length} warmed (${miss} populated, ${hit} already warm), ${failed.length} failed.`);
  if (failed.length) {
    console.log('Failed keys:');
    for (const f of failed) console.log(`  ${f.status} ${f.path} — ${f.note}`);
  }
  // Only hard-fail if EVERYTHING failed (prod down / wrong base URL). Partial
  // failures are logged but don't fail the job — a few cold keys self-heal on
  // the next request via stale-while-revalidate.
  if (failed.length === results.length) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });

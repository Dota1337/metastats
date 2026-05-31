import { NextResponse } from 'next/server';

// Shared cache headers for TFT stats APIs. The underlying data only refreshes
// once a day (Hetzner daily-crawl at 05:15 UTC), so a 5-min TTL meant every
// filter combo went cold every 5 min and paid the full Supabase RPC again.
// We now cache for 6h and serve-stale for 24h: once a combo is warmed it stays
// warm all day, and the first request after the daily crawl gets the stale
// (still-correct-for-most-of-the-day) copy instantly while the new data
// revalidates in the background — the user never waits on a cold RPC.
const STATS_CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';

export function cachedJson(data: unknown, opts: { cache?: string } = {}) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': opts.cache || STATS_CACHE_CONTROL },
  });
}

import { NextResponse } from 'next/server';

// Shared cache headers for TFT stats APIs. The underlying data refreshes
// once a day (Hetzner daily-crawl at 05:15 UTC) so 5-min CDN cache +
// stale-while-revalidate is comfortable. First-paint feels instant on the
// hot path while edge-cached, fresh data lands on the next request after
// the window expires.
const STATS_CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=900';

export function cachedJson(data: unknown, opts: { cache?: string } = {}) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': opts.cache || STATS_CACHE_CONTROL },
  });
}

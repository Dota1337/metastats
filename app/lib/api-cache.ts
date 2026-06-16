import { NextRequest, NextResponse } from 'next/server';
import type { PatchInfo } from './tft-supabase-reader';

// Shared cache headers for TFT stats APIs. The underlying data only refreshes
// once a day (Hetzner daily-crawl: 00:00 UTC start, fresh by ~09:00 UTC), so a
// 5-min TTL meant every filter combo went cold every 5 min and paid the full
// Supabase RPC again. We now cache for 6h and serve-stale for 24h: once a combo
// is warmed it stays warm all day, and the first request after the daily crawl
// gets the stale (still-correct-for-most-of-the-day) copy instantly while the
// new data revalidates in the background — the user never waits on a cold RPC.
// The tft-stats-cache-warm workflow pre-warms the popular combos at 09:30 UTC
// so even the first morning visitor lands on a HIT.
export const STATS_CACHE_CONTROL = 'public, s-maxage=21600, stale-while-revalidate=86400';

// Plan B (Patch-Changed-Boost): in den ersten 4h nach einem Patch-Drop sind die
// Stats-Daten besonders volatil — der Crawler schreibt im 15-min-Takt neue
// Rows, Comp-Avg-Place und Pick-Rate-Sample sind dünn und ändern sich rapide.
// Wir cachen dann nur 5min, damit das Pre-Patch-Fenster nicht 6h lang den
// Eindruck "Comp X ist tot" festschreibt, obwohl gerade ein paar hundert
// frische Spiele reinkommen.
export const STATS_CACHE_CONTROL_FRESH = 'public, s-maxage=300, stale-while-revalidate=3600';

export function cachedJson(data: unknown, opts: { cache?: string } = {}) {
  return NextResponse.json(data, {
    headers: { 'Cache-Control': opts.cache || STATS_CACHE_CONTROL },
  });
}

// Plan B: Patch-Changed-Boost. Wenn der jüngste Patch-Eintrag in crawl_meta
// jünger ist als 4h (gemessen am `first_day`-Anker), liefere ein kürzeres TTL.
// Das wirkt am Tag nach Patch-Drop für die ersten ~4h: Cache-Warmer und
// erste User sehen alle 5min frische Daten, statt 6h auf der ersten thin-Sample
// festzukleben. Nach 4h zurück auf den normalen Tages-Rhythmus.
export function cacheControlForPatches(patches: PatchInfo[]): string {
  if (patches.length === 0) return STATS_CACHE_CONTROL;
  const latest = patches[0];
  if (!latest?.first_day) return STATS_CACHE_CONTROL;
  const firstDayMs = new Date(latest.first_day + 'T00:00:00Z').getTime();
  if (!Number.isFinite(firstDayMs)) return STATS_CACHE_CONTROL;
  const ageMs = Date.now() - firstDayMs;
  if (ageMs >= 0 && ageMs < 4 * 60 * 60 * 1000) {
    return STATS_CACHE_CONTROL_FRESH;
  }
  return STATS_CACHE_CONTROL;
}

// Plan E (Per-Patch-Cache-Key): redirect ?patch=current oder ?patch=previous
// auf den konkret resolved Patch (z.B. 17.5b) per HTTP 307. Damit ist der
// Edge-Cache-Key patch-spezifisch — alte Patches behalten ihren 6h-Cache
// dauerhaft (sie ändern sich nicht mehr), nur der "current"-Alias geht kurz
// cold wenn ein neuer Patch online geht. Der Redirect selbst hat ein kurzes
// TTL (5min), damit der Alias bei Patch-Wechsel innerhalb 5min auf den neuen
// konkreten Patch zeigt.
//
// Caller pattern in jeder Stats-Route:
//   const patches = await getAvailablePatches();
//   const redirect = maybeRedirectByPatchAlias(request, patches);
//   if (redirect) return redirect;
//   ... // rest mit await resolveFilters(...) (nutzt den cached patches)
//   return cachedJson(data, { cache: cacheControlForPatches(patches) });
export function maybeRedirectByPatchAlias(
  request: NextRequest,
  patches: PatchInfo[],
): NextResponse | null {
  const url = new URL(request.url);
  const requested = url.searchParams.get('patch');
  // ?patch=current ist seit der Patch-Aggregations-Umstellung KEINE Alias-Form
  // mehr, sondern eine eigene Semantik (patchübergreifende Aggregation +
  // Display-Patch = der jüngste). Daher nicht redirecten — der Aggregations-
  // Snapshot wird beim nächsten Crawl-Lauf regeneriert und kann unter dem
  // stabilen Key "current" gecached werden.
  if (requested !== 'previous') return null;
  const resolved = patches[1]?.patch ?? null;
  if (!resolved || resolved === requested) return null;
  url.searchParams.set('patch', resolved);
  return NextResponse.redirect(url, {
    status: 307,
    headers: {
      // 5min frisch + 1h SWR. Bei Patch-Wechsel ist der Alias nach max. 5min
      // auf den neuen konkreten Patch umgebogen. Der alte konkrete Patch
      // behält seinen langen Cache (er ändert sich nie wieder).
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
    },
  });
}

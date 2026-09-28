import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { cachedJson, STATS_CACHE_CONTROL_FRESH } from '../../../lib/api-cache';

// /api/tft/tournaments
//   List: optional status/region/tier/set filters via query params.
//   Detail: ?slug=esports-world-cup-2026 returns the full row + standings.
//
// Both paths hit the get_tft_tournaments / get_tft_tournament_detail RPCs
// from migration 0010. The detail RPC bundles the placements as a jsonb
// array so the frontend renders the standings table without a second
// round-trip.

// Gleiches Fenster wie der Live-Abruf: Start −2 Tage bis Ende +2 Tage
// (das Enddatum ist Mitternacht am Tagesanfang, deshalb +3).
function inLiveWindow(start: string | null, end: string | null): boolean {
  if (!start) return false;
  const day = 86_400_000;
  const now = Date.now();
  const s = Date.parse(start);
  const e = Date.parse(end || start);
  if (Number.isNaN(s) || Number.isNaN(e)) return false;
  return now >= s - 2 * day && now <= e + 3 * day;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');

  if (slug) {
    const { data, error } = await supabaseAdmin.rpc('get_tft_tournament_detail', { p_id: slug });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const row = (data || [])[0] || null;
    // Laufendes Turnier: die Live-Tabelle wird stuendlich neu geholt
    // (scripts/fetch-tft-live-standings.mjs) — 5 min Edge-Cache statt 6 h.
    // Fenster nach Datum, nicht nach `status`: der wird nur beim Crawl gesetzt.
    return cachedJson({ tournament: row }, row && inLiveWindow(row.start_date, row.end_date) ? { cache: STATS_CACHE_CONTROL_FRESH } : {});
  }

  const status = searchParams.get('status');
  const region = searchParams.get('region');
  const tier = searchParams.get('tier');
  const setNum = searchParams.get('set');
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '200', 10)));

  const { data, error } = await supabaseAdmin.rpc('get_tft_tournaments', {
    p_status: status || null,
    p_region: region || null,
    p_tier: tier || null,
    p_set: setNum ? parseInt(setNum, 10) : null,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return cachedJson({
    tournaments: data || [],
    count: data?.length || 0,
  });
}

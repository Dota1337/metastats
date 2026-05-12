import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// /api/tft/tournaments
//   List: optional status/region/tier/set filters via query params.
//   Detail: ?slug=esports-world-cup-2026 returns the full row + standings.
//
// Both paths hit the get_tft_tournaments / get_tft_tournament_detail RPCs
// from migration 0010. The detail RPC bundles the placements as a jsonb
// array so the frontend renders the standings table without a second
// round-trip.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');

  if (slug) {
    const { data, error } = await supabase.rpc('get_tft_tournament_detail', { p_id: slug });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const row = (data || [])[0] || null;
    return NextResponse.json({ tournament: row });
  }

  const status = searchParams.get('status');
  const region = searchParams.get('region');
  const tier = searchParams.get('tier');
  const setNum = searchParams.get('set');
  const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '200', 10)));

  const { data, error } = await supabase.rpc('get_tft_tournaments', {
    p_status: status || null,
    p_region: region || null,
    p_tier: tier || null,
    p_set: setNum ? parseInt(setNum, 10) : null,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    tournaments: data || [],
    count: data?.length || 0,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// /api/tft/marktwert/movers?region=euw1&direction=up|down&window=7&limit=20
//
// Top gainers / losers within a time window. Backed by the
// get_tft_marketvalue_movers RPC which self-joins the snapshots table on
// (puuid, snapshot_date - window) and ranks by delta.
//
// Returns empty list when there's not enough history yet (e.g. first day
// after pipeline-launch) — the UI surfaces this as an empty state rather
// than failing.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const direction = (searchParams.get('direction') || 'up').toLowerCase();
  const window_ = Math.max(1, Math.min(90, parseInt(searchParams.get('window') || '7', 10)));
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get('limit') || '20', 10)));

  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json({ error: 'direction must be up|down' }, { status: 400 });
  }

  const { data, error } = await supabase.rpc('get_tft_marketvalue_movers', {
    p_region: region,
    p_window: window_,
    p_direction: direction,
    p_limit: limit,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const movers = (data || []).map((row: any) => ({
    puuid: row.puuid,
    gameName: row.game_name,
    tagLine: row.tag_line,
    tier: row.tier,
    rank: row.rank,
    lp: row.lp,
    currentValue: row.current_value,
    previousValue: row.previous_value,
    delta: row.delta,
    deltaPct: Number(row.delta_pct),
  }));

  return NextResponse.json({ region, direction, window: window_, count: movers.length, movers });
}

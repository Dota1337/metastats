import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// /api/tft/marktwert/history?puuid=...&region=euw1&days=30
//
// Returns the daily-snapshot time-series for one player, newest first.
// Used by the line-chart on the player page. Calls the RPC defined in
// supabase/migrations/0007_tft_player_marketvalue_snapshots.sql.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '30', 10)));

  if (!puuid) return NextResponse.json({ error: 'puuid fehlt' }, { status: 400 });

  const { data, error } = await supabase.rpc('get_tft_marketvalue_history', {
    p_puuid: puuid,
    p_region: region,
    p_days: days,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // RPC returns newest first; the chart wants oldest→newest for left→right
  // rendering. Reverse here so the consumer doesn't need to.
  const series = (data || [])
    .map((row: any) => ({
      date: row.snapshot_date,
      tier: row.tier,
      rank: row.rank,
      lp: row.lp,
      ladderRank: row.ladder_rank,
      baseValue: row.base_value,
      multiplier: Number(row.multiplier),
      finalValue: row.final_value,
      sampleSize: row.sample_size,
    }))
    .reverse();

  return NextResponse.json({ region, puuid, days, series });
}

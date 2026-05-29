import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';
import { cachedJson } from '../../../../lib/api-cache';

// /api/tft/marktwert/teams?region=euw1&limit=20
//
// Aggregated team marketvalue: sum of every pro player's latest snapshot
// grouped by team. Pass region=all to merge across all regions.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const regionParam = (searchParams.get('region') || 'all').toLowerCase();
  const region = regionParam === 'all' ? null : regionParam;
  const limit = Math.max(1, Math.min(200, parseInt(searchParams.get('limit') || '50', 10)));

  const { data, error } = await supabase.rpc('get_tft_team_marketvalues', {
    p_region: region,
    p_limit: limit,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const teams = (data || []).map((row: any) => ({
    team: row.team,
    rosterSize: Number(row.roster_size),
    totalValue: Number(row.total_value),
    avgValue: Number(row.avg_value),
    topPlayerName: row.top_player_name,
    topPlayerValue: Number(row.top_player_value),
    roster: row.roster || [],
  }));

  return cachedJson({ region: regionParam, count: teams.length, teams });
}

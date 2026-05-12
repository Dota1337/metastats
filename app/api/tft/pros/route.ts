import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabase';

// /api/tft/pros
//
// List view: optional filters region, team, role. Single-pro lookup via
// ?puuid=… returns one row (used by the player-page badge to upgrade
// from the LoL-Liquipedia fallback to the TFT-native verification).
//
// Both paths hit get_tft_pro_players RPC which respects RLS and the
// indexes on (region), (team), (source).

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  const region = searchParams.get('region');
  const team = searchParams.get('team');
  const role = searchParams.get('role');
  const limit = Math.max(1, Math.min(1000, parseInt(searchParams.get('limit') || '500', 10)));

  // Single-pro lookup by puuid: cheap two-statement query (select on PK)
  // — bypasses the RPC because we don't need filtering / ordering.
  if (puuid) {
    const { data, error } = await supabase
      .from('tft_pro_players')
      .select('*')
      .eq('puuid', puuid)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ pro: data || null });
  }

  const { data, error } = await supabase.rpc('get_tft_pro_players', {
    p_region: region || null,
    p_team: team || null,
    p_role: role || null,
    p_limit: limit,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate counts for the filter dropdowns. Single round-trip — the
  // RPC reads from the same table, no heavy join.
  const { data: aggs } = await supabase.rpc('get_tft_pro_aggregates');
  const regionCounts: Record<string, number> = {};
  const teamCounts: Record<string, number> = {};
  for (const row of (aggs || []) as { region: string; team: string | null; pro_count: number }[]) {
    regionCounts[row.region] = (regionCounts[row.region] || 0) + Number(row.pro_count);
    if (row.team) teamCounts[row.team] = (teamCounts[row.team] || 0) + Number(row.pro_count);
  }

  return NextResponse.json({
    pros: data || [],
    count: data?.length || 0,
    regionCounts,
    teamCounts,
  });
}

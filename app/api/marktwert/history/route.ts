import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const season = searchParams.get('season') || 'current';

  if (!puuid) {
    return NextResponse.json({ history: [] });
  }

  // Find player by puuid
  const { data: player } = await supabase
    .from('players')
    .select('id')
    .eq('puuid', puuid)
    .single();

  if (!player) {
    return NextResponse.json({ history: [] });
  }

  // Season date ranges
  let fromDate: string | null = null;
  const now = new Date();
  switch (season) {
    case 'current':
      // Current season = start of this year
      fromDate = `${now.getFullYear()}-01-01T00:00:00Z`;
      break;
    case '2025-s1':
      fromDate = '2025-01-01T00:00:00Z';
      break;
    case '2024-s2':
      fromDate = '2024-07-01T00:00:00Z';
      break;
    case 'all':
      fromDate = null;
      break;
    default:
      fromDate = `${now.getFullYear()}-01-01T00:00:00Z`;
  }

  let query = supabase
    .from('market_value_history')
    .select('market_value, recorded_at')
    .eq('player_id', player.id)
    .order('recorded_at', { ascending: true });

  if (fromDate) {
    query = query.gte('recorded_at', fromDate);
  }

  const { data: history } = await query;

  return NextResponse.json({
    history: history || [],
    playerId: player.id,
    season,
  });
}

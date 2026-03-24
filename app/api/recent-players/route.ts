import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';

export async function GET(request: NextRequest) {
  const visitorId = request.cookies.get('visitor_id')?.value;

  if (!visitorId) {
    return NextResponse.json({ players: [] });
  }

  try {
    const { data } = await supabase
      .from('players')
      .select('summoner_name, region, summoner_level, profile_icon_id')
      .contains('searched_by', [visitorId])
      .order('updated_at', { ascending: false })
      .limit(8);

    return NextResponse.json({ players: data || [] });
  } catch {
    return NextResponse.json({ players: [] });
  }
}
import { NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';

export async function GET() {
  try {
    const { data } = await supabase
      .from('players')
      .select('summoner_name, region, summoner_level, profile_icon_id')
      .order('updated_at', { ascending: false })
      .limit(8);

    return NextResponse.json({ players: data || [] });
  } catch {
    return NextResponse.json({ players: [] });
  }
}
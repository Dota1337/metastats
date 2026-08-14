import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

// no-store, und zwar ausdruecklich statt "kein Cache-Header":
// die Antwort haengt am Cookie `visitor_id` und ist die persoenliche
// Suchhistorie eines Besuchers. Ein geteilter Edge-Cache wuerde sie ohne
// `Vary: Cookie` an den naechsten Besucher weiterreichen — ein selbst gebauter
// Datenabfluss. Ein fehlender Header ueberlaesst diese Entscheidung dem
// Zufall der Plattform-Defaults; der Header hier tut es nicht.
const PRIVATE = { 'Cache-Control': 'no-store' } as const;

export async function GET(request: NextRequest) {
  const visitorId = request.cookies.get('visitor_id')?.value;

  if (!visitorId) {
    return NextResponse.json({ players: [] }, { headers: PRIVATE });
  }

  try {
    // Filter players where this visitor's ID is in the searched_by array
    const { data } = await supabase
      .from('players')
      .select('summoner_name, region, summoner_level, profile_icon_id, tier, rank, market_value')
      .contains('searched_by', [visitorId])
      .order('updated_at', { ascending: false })
      .limit(8);

    return NextResponse.json({ players: data || [] }, { headers: PRIVATE });
  } catch {
    return NextResponse.json({ players: [] }, { headers: PRIVATE });
  }
}

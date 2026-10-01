import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';

// DB-Stoerung ist kein „kein Verlauf“: 503, damit das Diagramm es anzeigen kann.
const unavailable = () => NextResponse.json(
  { error: 'Verlauf gerade nicht erreichbar', history: [] },
  { status: 503, headers: { 'Cache-Control': 'no-store' } },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const season = searchParams.get('season') || 'current';

  if (!puuid) {
    return NextResponse.json({ history: [] });
  }

  // Find player by puuid
  const { data: player, error: playerError } = await supabase
    .from('players')
    .select('id')
    .eq('puuid', puuid)
    .maybeSingle();

  if (playerError) return unavailable();
  if (!player) {
    return NextResponse.json({ history: [] });
  }

  // Season date ranges. Season IDs follow public/seasons.json format `s<year>`,
  // which by Riot convention equals the calendar year (Patch X.1 ships in early
  // January of year X+2010). Filter `recorded_at >= Jan 1 of that year`.
  let fromDate: string | null = null;
  let toDate: string | null = null;
  // Split-IDs (`s2026-split3`) filtern ueber die Spalte, die /api/summoner seit
  // 0080 schreibt — Altzeilen sind per Datum zugeordnet und als geschaetzt markiert.
  const splitId = /^s\d{4}-split\d+$/.test(season) ? season : null;
  const now = new Date();
  if (splitId) {
    fromDate = null;
  } else if (season === 'all') {
    fromDate = null;
  } else if (season === 'current') {
    fromDate = `${now.getFullYear()}-01-01T00:00:00Z`;
  } else {
    const m = /^s(\d{4})$/.exec(season);
    if (m) {
      const year = Number(m[1]);
      fromDate = `${year}-01-01T00:00:00Z`;
      toDate = `${year + 1}-01-01T00:00:00Z`;
    } else {
      fromDate = `${now.getFullYear()}-01-01T00:00:00Z`;
    }
  }

  let query = supabase
    .from('market_value_history')
    .select('market_value, recorded_at')
    .eq('player_id', player.id)
    .order('recorded_at', { ascending: true });

  if (splitId) {
    query = query.eq('split_id', splitId);
  }
  if (fromDate) {
    query = query.gte('recorded_at', fromDate);
  }
  if (toDate) {
    query = query.lt('recorded_at', toDate);
  }

  const { data: history, error: historyError } = await query;
  if (historyError) return unavailable();

  return NextResponse.json({
    history: history || [],
    playerId: player.id,
    season,
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { cacheHeaders, STATS_CACHE_CONTROL_FRESH } from '../../../lib/api-cache';

// /api/tft/search-players?q=dishs  |  ?q=Dish Soap#uwu
//
// Namenssuche ueber alle Server fuer das Nav-Dropdown (wie lolchess): jedes
// Konto, dessen Name mit der Eingabe beginnt, mit seiner Region. Quelle ist
// tft_player_names (Migration 0072), befuellt vom Daily-Crawl. Die Route liest
// nur — geschrieben wird ausschliesslich vom Crawler.
//
// Ab 3 Zeichen, weil kuerzere Praefixe zehntausende Treffer haben und die
// Datenbankfunktion sie ohnehin mit einer leeren Liste beantwortet. Der Teil
// nach '#' filtert den Tag (ebenfalls als Praefix).
//
// Rang nur, wenn der Crawl ihn in den letzten 14 Tagen wirklich gesehen hat —
// die Funktion liefert sonst null, und die Nav zeigt dann nur die Region.

const MIN_CHARS = 3;
const MAX_QUERY = 40;
const LIMIT = 10;

export async function GET(request: NextRequest) {
  const raw = (new URL(request.url).searchParams.get('q') || '').slice(0, MAX_QUERY);
  const hash = raw.indexOf('#');
  const name = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
  const tag = hash >= 0 ? raw.slice(hash + 1).trim() : '';

  if (name.replace(/\s/g, '').length < MIN_CHARS) {
    return NextResponse.json({ players: [] }, { headers: cacheHeaders(STATS_CACHE_CONTROL_FRESH) });
  }

  const { data, error } = await supabaseAdmin.rpc('search_tft_player_names', {
    p_prefix: name,
    p_tag: tag || null,
    p_limit: LIMIT,
  });

  if (error) {
    // Kein Cache: ein kurzer Ausfall darf nicht als "keine Treffer" haengen bleiben.
    console.error('[search-players] rpc failed:', error.message);
    return NextResponse.json({ error: 'search_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const players = (data || []).map((r: {
    puuid: string; game_name: string; tag_line: string; region: string;
    tier: string | null; division: string | null; lp: number | null;
  }) => ({
    puuid: r.puuid,
    gameName: r.game_name,
    tagLine: r.tag_line,
    region: r.region,
    tier: r.tier,
    division: r.division,
    lp: r.lp,
  }));

  return NextResponse.json({ players }, { headers: cacheHeaders(STATS_CACHE_CONTROL_FRESH) });
}

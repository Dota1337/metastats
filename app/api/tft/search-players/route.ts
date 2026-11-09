import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '../../../lib/supabase';
import { cacheHeaders, DEGRADED_CACHE_CONTROL, STATS_CACHE_CONTROL_FRESH } from '../../../lib/api-cache';
import { searchLolNames } from '../../../lib/lol-player-search-server';
import { mergeLolHits, type TftAccountHit } from '../../../lib/tft-player-search';

// /api/tft/search-players?q=dishs  |  ?q=Dish Soap#uwu  |  ?q=faker&game=lol
//
// Namenssuche ueber alle Server fuer das Nav-Dropdown (wie lolchess) und die
// Vorschlagslisten. Jedes Konto, dessen Name mit der Eingabe beginnt, mit
// seiner Region. Die Route liest nur.
//
// TFT (Standard): tft_player_names (Migration 0072), befuellt vom Daily-Crawl.
// LoL (game=lol): zusaetzlich lol_player_names (0122, aufgerufene LoL-Profile),
// LoL-Treffer zuerst, gleiche Riot-ID nur einmal, ohne puuid (die gehoert zum
// TFT-Schluessel; LoL-Links gehen ueber Name#Tag, siehe lolProfileHref).
// Faellt eines der beiden Verzeichnisse aus, kommt der Rest ohne Cache.
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

type Row = {
  puuid: string; game_name: string; tag_line: string; region: string;
  tier: string | null; division: string | null; lp: number | null;
};

async function tftPrefix(name: string, tag: string): Promise<TftAccountHit[] | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('search_tft_player_names', {
      p_prefix: name,
      p_tag: tag || null,
      p_limit: LIMIT,
    });
    if (error) {
      console.error('[search-players] rpc failed:', error.message);
      return null;
    }
    return ((data || []) as Row[]).map(r => ({
      puuid: r.puuid,
      gameName: r.game_name,
      tagLine: r.tag_line,
      region: r.region,
      tier: r.tier,
      division: r.division,
      lp: r.lp,
    }));
  } catch (e) {
    console.error('[search-players] rpc failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

// Kein Cache: ein kurzer Ausfall darf nicht als "keine Treffer" haengen bleiben.
const unavailable = () =>
  NextResponse.json({ error: 'search_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request: NextRequest) {
  const params = new URL(request.url).searchParams;
  const game = params.get('game') === 'lol' ? 'lol' : 'tft';
  const raw = (params.get('q') || '').slice(0, MAX_QUERY);
  const hash = raw.indexOf('#');
  const name = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
  const tag = hash >= 0 ? raw.slice(hash + 1).trim() : '';

  if (name.replace(/\s/g, '').length < MIN_CHARS) {
    return NextResponse.json({ players: [] }, { headers: cacheHeaders(STATS_CACHE_CONTROL_FRESH) });
  }

  if (game === 'tft') {
    const players = await tftPrefix(name, tag);
    if (!players) return unavailable();
    return NextResponse.json({ players }, { headers: cacheHeaders(STATS_CACHE_CONTROL_FRESH) });
  }

  const [lol, tft] = await Promise.all([searchLolNames(name, tag || null, LIMIT), tftPrefix(name, tag)]);
  if (!lol && !tft) return unavailable();
  const players = mergeLolHits(lol || [], tft || [], LIMIT);
  // Halbe Antwort: nicht speichern, sonst fehlt ein Verzeichnis bis zu einer Stunde.
  if (!lol || !tft) return NextResponse.json({ players }, { headers: { 'Cache-Control': 'no-store' } });
  // Leer nur kurz an der Edge und gar nicht im Browser: ein eben aufgerufenes
  // Profil soll bald gefunden werden, und die Kopfleiste fragt dann Riot.
  if (players.length === 0) {
    return NextResponse.json({ players }, {
      headers: { 'Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': DEGRADED_CACHE_CONTROL },
    });
  }
  return NextResponse.json({ players }, { headers: cacheHeaders(STATS_CACHE_CONTROL_FRESH) });
}

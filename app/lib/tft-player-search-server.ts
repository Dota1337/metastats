import 'server-only';
import { supabaseAdmin } from './supabase';
import type { TftAccountHit } from './tft-player-search';

// Server-Teil der Spielersuche "Enter ohne Tag" (/tft/search, /search):
// searchExactNames liefert alle Konten mit genau diesem Namen aus dem
// Namensverzeichnis (Migration 0073), ueber alle Server. Kennt das Verzeichnis
// nichts, fragt die Seite Riot ueber die Standard-Tags (riot-name-probe.ts).

type Row = {
  puuid: string; game_name: string; tag_line: string; region: string;
  tier: string | null; division: string | null; lp: number | null;
};

export async function searchExactNames(name: string, limit = 50): Promise<TftAccountHit[] | null> {
  const { data, error } = await supabaseAdmin.rpc('search_tft_player_names_exact', { p_name: name, p_limit: limit });
  if (error) {
    console.error('[tft-search] exact rpc failed:', error.message);
    return null;
  }
  return ((data || []) as Row[]).map(r => ({
    puuid: r.puuid, gameName: r.game_name, tagLine: r.tag_line, region: r.region,
    tier: r.tier, division: r.division, lp: r.lp,
  }));
}

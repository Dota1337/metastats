import 'server-only';
import { supabaseAdmin } from './supabase';
import type { PlayerHit } from './tft-player-search';

// LoL-Namensverzeichnis lol_player_names (Migration 0122), nur LESEN: Suche
// (Dropdown, /search) und die Spielerseite (player-lookup-server.ts). Eigene
// Datei, damit die TFT- und Companion-Routen keine Abhaengigkeit zu den
// LoL-Funktionen bekommen (Schnittstellen-Karte verfolgt je Datei).
// Geschrieben wird in lol-player-names-write.ts — getrennt, damit lesende
// Routen nicht als Schreiber gelten (scripts/check-write-routes.mjs).

type Row = { game_name: string; tag_line: string; region: string };

const toHit = (r: Row): PlayerHit => ({
  gameName: r.game_name, tagLine: r.tag_line, region: r.region, tier: null, division: null, lp: null,
});

/** Praefix-Suche fuer das Dropdown. null = Abfrage gescheitert. */
export async function searchLolNames(prefix: string, tag: string | null, limit: number): Promise<PlayerHit[] | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('search_lol_player_names', { p_prefix: prefix, p_tag: tag, p_limit: limit });
    if (error) { console.error('[lol-search] prefix rpc failed:', error.message); return null; }
    return ((data || []) as Row[]).map(toHit);
  } catch (e) {
    console.error('[lol-search] prefix rpc failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

/** Genau dieser Name (Enter ohne Tag). null = Abfrage gescheitert. */
export async function searchLolExact(name: string, limit = 50): Promise<PlayerHit[] | null> {
  try {
    const { data, error } = await supabaseAdmin.rpc('search_lol_player_names_exact', { p_name: name, p_limit: limit });
    if (error) { console.error('[lol-search] exact rpc failed:', error.message); return null; }
    return ((data || []) as Row[]).map(toHit);
  } catch (e) {
    console.error('[lol-search] exact rpc failed:', e instanceof Error ? e.message : 'unknown');
    return null;
  }
}

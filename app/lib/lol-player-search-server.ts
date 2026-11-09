import 'server-only';
import { after } from 'next/server';
import { supabaseAdmin } from './supabase';
import type { PlayerHit } from './tft-player-search';

// LoL-Namensverzeichnis lol_player_names (Migration 0122). Eigene Datei, damit
// die TFT- und Companion-Routen keine Abhaengigkeit zu den LoL-Funktionen
// bekommen (Schnittstellen-Karte verfolgt je Datei).
//
// Geschrieben wird nur aus /api/summoner, wenn Riot Name und Server mit dem
// LoL-Schluessel bestaetigt hat — die puuid hier ist die LoL-puuid. Schreiben
// laeuft nach der Antwort (after()) und darf die Route nie aufhalten: der
// Marktwert-Lauf ruft sie in Serie. Abschalter: LOL_NAMES_WRITE=0.

type Row = { game_name: string; tag_line: string; region: string };

const WRITE_TIMEOUT_MS = 3000;

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

function writeEnabled(): boolean {
  return process.env.LOL_NAMES_WRITE !== '0';
}

function runLater(label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
  const task = async () => {
    try {
      const { error } = await fn();
      if (error) console.error(`[lol-names] ${label} failed:`, error.message);
    } catch (e) {
      console.error(`[lol-names] ${label} failed:`, e instanceof Error ? e.message : 'unknown');
    }
  };
  try {
    after(task);
  } catch {
    // Ausserhalb eines Requests gibt es kein after().
    void task();
  }
}

/** Riot hat dieses Konto auf diesem Server bestaetigt: ins Verzeichnis. */
export function rememberLolName(account: { puuid?: unknown; gameName?: unknown; tagLine?: unknown }, region: string): void {
  if (!writeEnabled()) return;
  const { puuid, gameName, tagLine } = account;
  if (typeof puuid !== 'string' || !puuid || typeof gameName !== 'string' || !gameName.trim()
    || typeof tagLine !== 'string' || !tagLine.trim()) return;
  const rows = [{ puuid, game_name: gameName, tag_line: tagLine, region, last_seen: new Date().toISOString() }];
  runLater('upsert', () => supabaseAdmin.rpc('upsert_lol_player_names', { p_rows: rows })
    .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS)));
}

/** Riot kennt Name#Tag nicht (mehr): Zeile mit dieser Riot-ID weg. */
export function forgetLolName(gameName: string, tagLine: string): void {
  if (!writeEnabled() || !gameName.trim() || !tagLine.trim()) return;
  runLater('delete', () => supabaseAdmin.rpc('delete_lol_player_name', { p_game_name: gameName, p_tag_line: tagLine })
    .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS)));
}

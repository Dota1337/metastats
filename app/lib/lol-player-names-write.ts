import 'server-only';
import { after } from 'next/server';
import { supabaseAdmin } from './supabase';
import { lolNameRow, type LolNameRow } from './lol-player-names';

// Schreiben ins LoL-Namensverzeichnis lol_player_names (Migration 0122). Eigene
// Datei, damit nur die schreibenden Routen hier andocken — die Suche liest ueber
// lol-player-search-server.ts und gilt so weder in der Schnittstellen-Karte
// noch im Schreib-Waechter (scripts/check-write-routes.mjs) als Schreiber.
//
// Schreiber:
//   /api/summoner     Riot hat Name und Server dieses Profils bestaetigt.
//   /api/leaderboard  Riot hat in DIESER Anfrage puuids der Rangliste zu
//                     Namen aufgeloest (account-v1). Bewusst kein Merken ueber
//                     Anfragen hinweg: ein gemerkter alter Name wuerde eine von
//                     /api/summoner geloeschte Zeile wieder anlegen.
// Beide nur mit dem LoL-Schluessel. Schreiben laeuft nach der Antwort (after())
// und darf die Route nie aufhalten. Abschalter fuer beide: LOL_NAMES_WRITE=0.

const WRITE_TIMEOUT_MS = 3000;

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

/** Von Riot bestaetigte Riot-IDs ins Verzeichnis (ein Aufruf fuer alle). */
export function rememberLolNames(rows: LolNameRow[]): void {
  if (!writeEnabled() || rows.length === 0) return;
  runLater('upsert', () => supabaseAdmin.rpc('upsert_lol_player_names', { p_rows: rows })
    .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS)));
}

/** Riot hat dieses Konto auf diesem Server bestaetigt: ins Verzeichnis. */
export function rememberLolName(account: { puuid?: unknown; gameName?: unknown; tagLine?: unknown }, region: string): void {
  const row = lolNameRow(account, region, new Date());
  if (row) rememberLolNames([row]);
}

/** Riot kennt Name#Tag nicht (mehr): Zeile mit dieser Riot-ID weg. */
export function forgetLolName(gameName: string, tagLine: string): void {
  if (!writeEnabled() || !gameName.trim() || !tagLine.trim()) return;
  runLater('delete', () => supabaseAdmin.rpc('delete_lol_player_name', { p_game_name: gameName, p_tag_line: tagLine })
    .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS)));
}

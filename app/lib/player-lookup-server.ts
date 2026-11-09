import 'server-only';
// Abfragen hinter player-lookup.ts: kennen wir einen Spieler? Eine Quelle fuer
// Vorschaubild (og/data.ts), Seitentitel, noindex und den Kopf der Spielerseiten
// (seo/player-data.ts) — sonst widersprechen sie sich.
//
// Harte Regel wie og/data.ts: nie Riot, nie eine Live-Route. Jede Quelle
// hoechstens 1,5 s; Fehler und Zeitlimit sind „keine Entscheidung“, nie
// „unbekannt“.
//
// Quellen:
//   TFT  Namensverzeichnis tft_player_names (exakter Name, Tag hier verglichen).
//   LoL  Profi-Liste (public/pro-teams/index.json) ODER TFT-Namensverzeichnis
//        (Riot-ID gilt fuer beide Spiele) ODER Tabelle players (wer das Profil
//        schon einmal geoeffnet hat) ODER LoL-Namensverzeichnis lol_player_names
//        (Profil-Aufrufe und die Rangliste, 09.11.2026: 12 Spieler der Rangliste
//        standen in keiner anderen Quelle und bekamen noindex). Das TFT-
//        Verzeichnis allein kennt nur 95 von 712 Profis (gemessen 15.10.2026) —
//        „unbekannt“ nur, wenn alle Quellen nein sagen. Notschalter
//        LOL_NAMES_LOOKUP=0 laesst das LoL-Verzeichnis weg (nicht „keine
//        Entscheidung“ — sonst gaebe es nie mehr noindex).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from './supabase';
import { searchExactNames } from './tft-player-search-server';
import { searchLolExact } from './lol-player-search-server';
import type { PlayerHit, TftAccountHit } from './tft-player-search';
import { withTimeout } from './og/frame';
import {
  DIRECTORY_LIMIT, combineLookups, pickAccount, riotIdKey, splitRiotId,
  type Lookup, type PlayerName,
} from './player-lookup';

export const LOOKUP_TIMEOUT_MS = 1500;

// Speicher je Instanz: die Spielerseiten schreiben die gefundene Region per
// router.replace in die Adresse, das rendert Titel und Huelle ein zweites Mal.
// Nur sichere Ergebnisse — ein Zeitlimit soll beim naechsten Aufruf neu fragen.
// „Unbekannt“ nur kurz: wer ein Profil zum ersten Mal oeffnet, steht Sekunden
// spaeter in players, und das Vorschaubild (1 Tag im CDN) soll ihn dann kennen.
const MEMO_KNOWN_MS = 10 * 60_000;
const MEMO_UNKNOWN_MS = 60_000;
const MEMO_MAX = 500;
const memo = new Map<string, { expires: number; value: NonNullable<Lookup<unknown>> }>();

async function remembered<T>(key: string, load: () => Promise<Lookup<T>>): Promise<Lookup<T>> {
  const now = Date.now();
  const hit = memo.get(key);
  if (hit && hit.expires > now) return hit.value as Lookup<T>;
  const value = await load();
  if (value) {
    memo.delete(key);
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value!);
    memo.set(key, { expires: now + (value.known ? MEMO_KNOWN_MS : MEMO_UNKNOWN_MS), value });
  }
  return value;
}

// ---------- TFT: Namensverzeichnis ----------

export function tftDirectoryLookup(gameName: string, tagLine: string): Promise<Lookup<TftAccountHit>> {
  if (!gameName.trim() || !tagLine.trim()) return Promise.resolve(null);
  return remembered(`tft|${riotIdKey(gameName, tagLine)}`, async () =>
    pickAccount(await withTimeout(searchExactNames(gameName, DIRECTORY_LIMIT), LOOKUP_TIMEOUT_MS), tagLine));
}

// ---------- LoL: Namensverzeichnis lol_player_names ----------

export function lolDirectoryLookup(gameName: string, tagLine: string): Promise<Lookup<PlayerHit>> {
  if (!gameName.trim() || !tagLine.trim()) return Promise.resolve(null);
  return remembered(`lol|${riotIdKey(gameName, tagLine)}`, async () =>
    pickAccount(await withTimeout(searchLolExact(gameName, DIRECTORY_LIMIT), LOOKUP_TIMEOUT_MS), tagLine));
}

// ---------- LoL: Tabelle players ----------

export interface LolPlayerRow {
  id: string; summoner_name: string; region: string | null; tier: string | null; rank: string | null;
  market_value: number | string | null; summoner_level: number | null; profile_icon_id: number | null;
}

function escapeLike(v: string): string {
  return v.replace(/[\\%_]/g, c => '\\' + c);
}

async function playersRow(fullName: string): Promise<Lookup<LolPlayerRow>> {
  // PostgREST liest `*` in like/ilike als `%` — ein Stern in der Adresse fand
  // sonst einen fremden Spieler. Riot-Namen enthalten keinen Stern (gemessen
  // 24.10.2026: 0 von 1.660 Zeilen in players), also gibt es dazu keinen Treffer.
  if (fullName.includes('*')) return { known: false };
  const { data, error } = await supabaseAdmin
    .from('players')
    .select('id, summoner_name, region, tier, rank, market_value, summoner_level, profile_icon_id')
    .ilike('summoner_name', escapeLike(fullName))
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) {
    console.error('[player-lookup] players failed:', error.message);
    return null;
  }
  const row = (data?.[0] as LolPlayerRow | undefined) ?? null;
  return row ? { known: true, value: row } : { known: false };
}

/** Zeile aus players fuer `Name#Tag` (Gross/Klein egal), wie das Vorschaubild sie braucht. */
export function lolPlayersLookup(name: string, tag: string): Promise<Lookup<LolPlayerRow>> {
  if (!name.trim() || !tag.trim()) return Promise.resolve(null);
  // Schluessel wie die Abfrage: ohne Gross/Klein, Leerzeichen zaehlen (ilike).
  return remembered(`players|${`${name}#${tag}`.toLowerCase()}`, async () =>
    (await withTimeout(playersRow(`${name}#${tag}`), LOOKUP_TIMEOUT_MS)) ?? null);
}

// ---------- LoL: Profi-Liste ----------

// Schluessel → Schreibweise der Riot-ID. null = Datei fehlt (sie entsteht erst
// im Build, scripts/build-pro-teams-derivate.mjs) → keine Entscheidung.
let proIds: Map<string, string> | null | undefined;

function proRiotIds(): Map<string, string> | null {
  if (proIds !== undefined) return proIds;
  try {
    const raw = readFileSync(path.join(process.cwd(), 'public', 'pro-teams', 'index.json'), 'utf8');
    const data = JSON.parse(raw) as { players?: { riotId?: unknown }[] };
    const map = new Map<string, string>();
    for (const p of data.players || []) {
      const id = typeof p.riotId === 'string' ? splitRiotId(p.riotId) : null;
      if (id) map.set(riotIdKey(id.gameName, id.tagLine), `${id.gameName}#${id.tagLine}`);
    }
    proIds = map.size > 0 ? map : null;
  } catch {
    proIds = null;
  }
  return proIds;
}

/** LoL-Spieler: Schreibweise aus der Quelle, die ihn kennt. */
export async function lolPlayerLookup(name: string, tag: string): Promise<Lookup<PlayerName>> {
  if (!name.trim() || !tag.trim()) return null;
  const pros = proRiotIds();
  const pro = pros?.get(riotIdKey(name, tag));
  if (pro) return { known: true, value: splitRiotId(pro)! };
  const useLolNames = process.env.LOL_NAMES_LOOKUP !== '0';
  const [tft, players, lol] = await Promise.all([
    tftDirectoryLookup(name, tag),
    lolPlayersLookup(name, tag),
    useLolNames ? lolDirectoryLookup(name, tag) : Promise.resolve(null),
  ]);
  const fromPlayers = (row: LolPlayerRow): PlayerName => splitRiotId(row.summoner_name) ?? { gameName: name, tagLine: tag };
  const riotId = (h: PlayerName): PlayerName => ({ gameName: h.gameName, tagLine: h.tagLine });
  // Reihenfolge = Vorrang der Schreibweise. Das LoL-Verzeichnis steht hinten:
  // fuer schon bekannte Spieler aendern sich Titel und canonical nicht.
  return combineLookups<PlayerName>([
    pros ? { known: false } : null,
    tft && (tft.known ? { known: true, value: riotId(tft.value) } : tft),
    players && (players.known ? { known: true, value: fromPlayers(players.value) } : players),
    ...(useLolNames ? [lol && (lol.known ? { known: true as const, value: riotId(lol.value) } : lol)] : []),
  ]);
}

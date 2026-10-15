// Kennen wir einen Spieler? Gemeinsame Regeln fuer Vorschaubild, Seitentitel,
// noindex und den Kopf der Spielerseiten (SEO-Plan Schritt 7). Ohne Server-
// Importe, damit die Regeln ohne Datenbank testbar sind; die Abfragen liegen in
// player-lookup-server.ts.
//
// Drei Ausgaenge, nie vermischt:
//   { known: true, value } — eine Quelle kennt den Spieler
//   { known: false }       — alle Quellen haben sicher geantwortet: unbekannt
//   null                   — keine Entscheidung (Fehler, Zeitlimit, kein Tag,
//                            Trefferliste voll). Die Seite verhaelt sich dann wie
//                            bisher; vor allem gibt es KEIN noindex.
// „Unbekannt“ heisst nur „nicht in unseren Quellen“, nicht „gibt es bei Riot
// nicht“ — deshalb faellt jeder Zweifel auf null.
import type { TftAccountHit } from './tft-player-search';

export type Lookup<T> = { known: true; value: T } | { known: false } | null;

export interface PlayerName { gameName: string; tagLine: string }

/** Was der Client von der Huelle bekommt (serialisierbar). */
export type PlayerHead = ({ known: true } & PlayerName) | { known: false } | null;

/** Deckel der Namens-RPC (search_tft_player_names_exact, Migration 0073). */
export const DIRECTORY_LIMIT = 100;

/** Vergleichsschluessel wie tft_name_norm in der Datenbank: NFKC, ohne Leerraum, klein. */
export function nameKey(s: string): string {
  return s.normalize('NFKC').replace(/\s/g, '').toLowerCase();
}

export function riotIdKey(gameName: string, tagLine: string): string {
  return `${nameKey(gameName)}#${nameKey(tagLine)}`;
}

/** `Name#Tag` am letzten `#` getrennt; null ohne Tag. */
export function splitRiotId(id: string): PlayerName | null {
  const i = id.lastIndexOf('#');
  if (i <= 0 || i === id.length - 1) return null;
  return { gameName: id.slice(0, i), tagLine: id.slice(i + 1) };
}

/**
 * Konto mit diesem Tag unter den Namens-Treffern des Verzeichnisses. Die
 * Treffer kommen nach Rang sortiert und hoechstens `limit` Stueck: ist die
 * Liste voll, kann das gesuchte Konto dahinter liegen → keine Entscheidung.
 */
export function pickTftAccount(
  hits: TftAccountHit[] | null,
  tagLine: string,
  limit = DIRECTORY_LIMIT,
): Lookup<TftAccountHit> {
  if (!hits) return null;
  const tag = tagLine.trim().toLowerCase();
  if (!tag) return null;
  const hit = hits.find(h => h.tagLine.trim().toLowerCase() === tag);
  if (hit) return { known: true, value: hit };
  return hits.length >= limit ? null : { known: false };
}

/** Bekannt, sobald eine Quelle ihn kennt; unbekannt nur, wenn ALLE sicher nein sagen. */
export function combineLookups<T>(results: Lookup<T>[]): Lookup<T> {
  const hit = results.find(r => r?.known);
  if (hit) return hit;
  return results.length > 0 && results.every(r => r !== null && !r.known) ? { known: false } : null;
}

export function toHead(r: Lookup<PlayerName>): PlayerHead {
  if (!r) return null;
  return r.known ? { known: true, gameName: r.value.gameName, tagLine: r.value.tagLine } : { known: false };
}

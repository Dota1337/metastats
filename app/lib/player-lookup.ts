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
export type Lookup<T> = { known: true; value: T } | { known: false } | null;

export interface PlayerName { gameName: string; tagLine: string }

/** Was der Client von der Huelle bekommt (serialisierbar). */
export type PlayerHead = ({ known: true } & PlayerName) | { known: false } | null;

/** Deckel der Namens-RPCs search_tft_player_names_exact (0073) und
 *  search_lol_player_names_exact (0122) — beide 100, Test prueft beide. */
export const DIRECTORY_LIMIT = 100;

/** Vergleichsschluessel wie tft_name_norm in der Datenbank: NFKC, ohne Leerraum, klein. */
export function nameKey(s: string): string {
  return s.normalize('NFKC').replace(/\s/g, '').toLowerCase();
}

/** Tag-Vergleich: nur Gross/Klein und Rand egal. Leerzeichen INNEN zaehlen —
 *  „KR 1“ und „KR1“ sind zwei Konten (Namensverzeichnis 09.11.2026: 17 Paare
 *  mit verschiedener puuid). */
export function tagKey(s: string): string {
  return s.trim().toLowerCase();
}

/** Schluessel einer Riot-ID (Speicher der Abfragen, Profi-Liste): Name wie
 *  tft_name_norm, Tag nach tagKey. */
export function riotIdKey(gameName: string, tagLine: string): string {
  return `${nameKey(gameName)}#${tagKey(tagLine)}`;
}

/**
 * Schreibweise fuer die eigentliche Adresse (canonical) einer Spielerseite.
 * Die Quelle gewinnt nur, wenn sie sicher dieselbe Riot-ID meint: Name gleich
 * bis auf Gross/Klein und Leerraum, Tag gleich nach tagKey. Bewusst OHNE NFKC
 * (anders als nameKey): ob Riot Vollbreite zusammenlegt, ist ungeprueft, und
 * 2.116 Namen im Verzeichnis aendern sich dadurch. Sonst die Schreibweise der
 * Adresse, am Rand gekuerzt. Ohne Name oder Tag: null (kein canonical).
 */
export function playerCanonicalName(head: PlayerHead, gameName: string, tagLine: string): PlayerName | null {
  const name = gameName.trim();
  const tag = tagLine.trim();
  if (!name || !tag) return null;
  const loose = (s: string) => s.replace(/\s/g, '').toLowerCase();
  if (head?.known && head.gameName.trim() && head.tagLine.trim()
    && loose(head.gameName) === loose(name) && tagKey(head.tagLine) === tagKey(tag)) {
    return { gameName: head.gameName.trim(), tagLine: head.tagLine.trim() };
  }
  return { gameName: name, tagLine: tag };
}

/** `Name#Tag` am letzten `#` getrennt; null ohne Tag. */
export function splitRiotId(id: string): PlayerName | null {
  const i = id.lastIndexOf('#');
  if (i <= 0 || i === id.length - 1) return null;
  return { gameName: id.slice(0, i), tagLine: id.slice(i + 1) };
}

/**
 * Konto mit diesem Tag unter den Namens-Treffern eines Verzeichnisses (TFT oder
 * LoL). Die Treffer kommen sortiert und hoechstens `limit` Stueck: ist die
 * Liste voll, kann das gesuchte Konto dahinter liegen → keine Entscheidung.
 */
export function pickAccount<T extends { tagLine: string }>(
  hits: T[] | null,
  tagLine: string,
  limit = DIRECTORY_LIMIT,
): Lookup<T> {
  if (!hits) return null;
  const tag = tagKey(tagLine);
  if (!tag) return null;
  const hit = hits.find(h => tagKey(h.tagLine) === tag);
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

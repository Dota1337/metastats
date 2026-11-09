// Zeilen fuer das LoL-Namensverzeichnis lol_player_names (Migration 0122).
// Ohne Server-Importe, damit testbar; geschrieben wird in
// lol-player-names-write.ts.
//
// Nur aus Riots Konto-Antwort mit dem LoL-Schluessel (RIOT_API_KEY): die puuid
// ist die LoL-puuid, Name und Tag sind Riots Schreibweise. Nie aus der Adresse
// und nie aus der Tabelle players (deren Name kann alt sein).

export interface LolNameRow {
  puuid: string;
  game_name: string;
  tag_line: string;
  region: string;
  /** Zeitpunkt der Riot-Antwort. Die Datenbank ueberschreibt damit nie einen juengeren Stand. */
  last_seen: string;
}

/** Eine Zeile aus Riots Antwort; null, wenn puuid, Name, Tag oder Server fehlen
 *  (die Datenbank verwirft solche Zeilen ohnehin). */
export function lolNameRow(
  account: { puuid?: unknown; gameName?: unknown; tagLine?: unknown },
  region: string,
  at: Date,
): LolNameRow | null {
  const { puuid, gameName, tagLine } = account;
  if (typeof puuid !== 'string' || !puuid || typeof gameName !== 'string' || !gameName.trim()
    || typeof tagLine !== 'string' || !tagLine.trim() || !region.trim()) return null;
  return { puuid, game_name: gameName, tag_line: tagLine, region, last_seen: at.toISOString() };
}

// Reine Zuordnungslogik fuer scripts/backfill-companion-placements.mjs — ohne
// DB, ohne Riot, damit sie testbar ist (companion-match-pick.test.mjs).
//
// Die Behelfs-ID der App (`LIVE_<seedMs>_…`) traegt den Moment, in dem die App
// das Spiel zuerst gesehen hat — auf die Minute abgerundet. Steigt die App erst
// mitten im Spiel ein, liegt dieser Moment weit nach dem Spielstart.
//
// Gemessen 2026-10-07 an 6 aufgeloesten Companion-Spielen (Match-V1):
// `game_datetime` ist das SPIELENDE der Lobby, `gameCreation` der Start;
// `game_datetime - gameCreation` liegt 3-85 s ueber `game_length`. Die
// Spiel-Liste by-puuid filtert startTime/endTime ebenfalls nach dem Spielende
// (EUW1_8003301547 erscheint nur im Fenster, das sein Ende enthaelt).
//
// Als Ende zaehlt das EIGENE Ausscheiden des Beobachters (Start +
// time_eliminated), nicht das Lobby-Ende. Gemessen an EUW1_8006458069: Platz 6
// schied 16:55:17 UTC aus, die Lobby lief bis 16:59:35, die App sah das naechste
// Spiel um 16:57 — mit dem Lobby-Ende waere es dem alten Spiel zugeordnet und
// als Doppel-Upload fuer immer verworfen worden (das neue ist bei Riot noch
// nicht gelistet). Fehlt time_eliminated, gilt das Lobby-Ende.

// Ladezeiten und Uhr-Abweichung: so weit darf der Startzeitpunkt der App vor
// dem errechneten Riot-Start liegen.
export const TS_WINDOW_MS = 15 * 60 * 1000;

// Kennung der Zuordnungsregel. Erhoeht sich die Zahl, werden `no_match_*`-
// Eintraege aus aelteren Fassungen genau einmal neu versucht.
//   1 = |Riot-Start - App-Start| < 15 Min (bis 2026-10-07)
//   2 = App-Start in [Riot-Start - 15 Min, eigenes Ausscheiden], engster Start gewinnt
export const MATCH_ALGO_VERSION = 2;

/** Errechneter Riot-Start: Ende minus Spieldauer. null ohne Ende. */
export function riotStartMs(info) {
  const end = info?.game_datetime;
  if (!end) return null;
  return end - Math.round((info.game_length || 0) * 1000);
}

/** Ende fuer den Beobachter: sein Ausscheiden, ersatzweise das Lobby-Ende. */
export function observerEndMs(info, puuid) {
  const start = riotStartMs(info);
  if (start == null) return null;
  const me = puuid ? info.participants?.find(p => p.puuid === puuid) : null;
  const out = Number(me?.time_eliminated);
  return out > 0 ? start + Math.round(out * 1000) : info.game_datetime;
}

/**
 * Waehlt aus den Match-Details das Spiel, zu dem der App-Start `seed` gehoert.
 * Treffer: seed liegt zwischen (Riot-Start - TS_WINDOW_MS) und dem Ausscheiden
 * des Beobachters `puuid`. Bei mehreren Treffern (zwei Spiele direkt
 * hintereinander) gewinnt das Spiel mit dem naechsten Start.
 * @returns {{ md: object, delta: number } | null}
 */
export function pickMatch(seed, details, puuid) {
  let best = null;
  for (const md of details) {
    const start = riotStartMs(md?.info);
    const end = observerEndMs(md?.info, puuid);
    if (!end || start == null) continue;
    if (seed < start - TS_WINDOW_MS || seed > end) continue;
    const delta = Math.abs(start - seed);
    if (!best || delta < best.delta) best = { md, delta };
  }
  return best;
}

/**
 * Ein Statusdatei-Eintrag `unresolvable` haelt eine Behelfs-ID fest. Neu
 * versucht wird nur ein `no_match_*` aus einer aelteren Regel-Fassung;
 * Doppel-Uploads (`duplicate_of:`) und andere Gruende bleiben liegen.
 */
export function shouldRetryUnresolvable(entry) {
  if (!entry) return true;
  return String(entry.reason || '').startsWith('no_match') && (entry.v ?? 1) < MATCH_ALGO_VERSION;
}

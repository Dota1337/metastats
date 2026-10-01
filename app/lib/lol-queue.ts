/**
 * Spielmodi, deren Ergebnis nicht mit 5-gegen-5 vergleichbar ist: Arena
 * (8 Duos, „Sieg" = obere Haelfte) und Swarm (gegen den Computer). Sie zaehlen
 * nicht in Kopf-Siegquote und KDA der Spielerseite.
 */
const NON_STANDARD_QUEUES = new Set([1700, 1710, 1810, 1820, 1830, 1840]);
const NON_STANDARD_MODES = new Set(['CHERRY', 'STRAWBERRY']);

export function isNonStandardMode(m: { queueId?: number; gameMode?: string }): boolean {
  return NON_STANDARD_QUEUES.has(m.queueId ?? -1) || NON_STANDARD_MODES.has((m.gameMode || '').toUpperCase());
}

/**
 * Spiele, die sich mit Ranglisten-Werten der Kluft der Beschwoerer vergleichen
 * lassen — Grundlage fuer KI-Coach und Kategorien-Uebersicht. Erlaubnisliste
 * statt Sperrliste: ARAM, Arena, URF & Co. fallen damit automatisch heraus.
 * Bot- und Tutorial-Spiele laufen auch als CLASSIC, sagen aber nichts aus;
 * Remakes (Aufgabe in den ersten Minuten) ebenso.
 */
const RIFT_MODES = new Set(['CLASSIC', 'SWIFTPLAY']);
const RIFT_QUEUES = new Set([400, 420, 430, 440, 480, 490, 700]);
const NOT_COMPARABLE_QUEUES = new Set([830, 840, 850, 870, 880, 890, 2000, 2010, 2020]);

/** Mindestzahl vergleichbarer Spiele, ab der Coach und Uebersicht rechnen. */
export const MIN_RIFT_GAMES = 5;

export function isRiftGame(m: { queueId?: number; gameMode?: string; gameEndedInEarlySurrender?: boolean }): boolean {
  if (m.gameEndedInEarlySurrender) return false;
  if (NOT_COMPARABLE_QUEUES.has(m.queueId ?? -1)) return false;
  if (m.gameMode) return RIFT_MODES.has(m.gameMode.toUpperCase());
  return RIFT_QUEUES.has(m.queueId ?? -1);
}

const LANE_ROLES = new Set(['TOP', 'JUNGLE', 'MID', 'MIDDLE', 'BOTTOM', 'ADC', 'UTILITY', 'SUPPORT']);

/** Echte Spur-Rolle; ARAM liefert „Invalid", fehlende Werte „UNKNOWN" oder leer. */
export function isLaneRole(role: unknown): role is string {
  return typeof role === 'string' && LANE_ROLES.has(role.toUpperCase());
}

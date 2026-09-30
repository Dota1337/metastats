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

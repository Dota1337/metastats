// Ist ein Abruf an der Quelle gescheitert (Server weg, ueberlastet, Netz) oder an
// uns (falsche Adresse, kaputte Daten, Code)? User 13.11.2026: antwortet
// CommunityDragon nicht, soll der Daten-Lauf gruen enden und erst nach 24 h melden
// (tft-data-refresh.yml, scripts/lib/tft-cdragon-outage.mjs).
//
// Eingestuft wird ueber Felder am Fehler, nie ueber den Meldungstext: `status`
// (HTTP) bzw. `code` (Node-Netzfehler). Vorbilder: publish-route-mirrors.mjs
// (Wiederholen ab 500 und bei 429), riot-client.mjs (TRANSIENT_NET_CODES).

const NET_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED', 'EPIPE',
]);

/** true = die Quelle ist gerade nicht erreichbar; false = ein Fehler, der rot bleiben muss. */
export function isSourceDown(err) {
  const status = Number(err?.status);
  if (Number.isInteger(status)) return status >= 500 || status === 429;
  return NET_CODES.has(err?.code);
}

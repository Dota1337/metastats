// Publisher-Vorrecht (Sicherheitsdurchsicht 24.10.2026).
//
// Die Box ruft die eigenen Routen ab, um Vorrat, Route-Spiegel und LoL-Builds
// zu bauen, und muss dabei an Vorrat und Spiegel vorbei live rechnen — sonst
// bekaeme sie ihre eigene Datei zurueck und schriebe sie eingefroren neu
// (Vorfall 17.08.2026, snapshot-lookup.ts). Bis zum 24.10. reichte dafuer die
// Kopfzeile `x-snapshot-publisher: 1` allein: jeder Fremde konnte damit die
// schweren Abfragen mit 25 statt 8 s Frist an allen Polstern vorbei ausloesen.
// Jetzt gilt das Vorrecht nur zusammen mit dem Geheimnis aus
// SNAPSHOT_PUBLISHER_TOKEN (Vercel und /etc/metastats-crawler/env).
//
// Angenommen wird es an genau zwei Stellen mit derselben Pruefung: in der
// Middleware (Publisher-Kopf ohne gueltiges Geheimnis → 403, sonst Annahme per
// PUBLISHER_ACCEPTED_HEADER zurueck) und in isSnapshotPublisher. Die Box prueft
// vor jedem Lauf, ob die Annahme ankommt, und bricht sonst mit Exit 1 ab —
// ein abgelehnter Publisher wuerde still eingefrorene Daten neu hochladen.
//
// Als .mjs ohne Imports: die Box laedt keine TS-Dateien, und die Middleware
// laeuft ohne node:crypto. Steht deshalb im Pfad-Filter von
// .github/workflows/deploy-hetzner.yml.

export const PUBLISHER_HEADER = 'x-snapshot-publisher';
export const PUBLISHER_TOKEN_HEADER = 'x-snapshot-publisher-token';
export const PUBLISHER_ACCEPTED_HEADER = 'x-snapshot-publisher-accepted';
export const PUBLISHER_TOKEN_ENV = 'SNAPSHOT_PUBLISHER_TOKEN';

// 32 Zufallsbytes als Hex (scripts/deploy-revalidate-secret.mjs) = 64 Zeichen.
// Kuerzere Werte gelten als nicht gesetzt.
const MIN_TOKEN_LENGTH = 32;

/** Vergleich in konstanter Zeit, ohne node:crypto (laeuft auch in der Middleware). */
function sameString(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Traegt eine Anfrage ein gueltiges Publisher-Vorrecht? `get` liest einen
 * Kopf (Headers.get), `expected` ist der Wert aus der Umgebung. Ohne gesetztes
 * Geheimnis gibt es kein Vorrecht.
 */
export function publisherTokenValid(get, expected) {
  if (typeof expected !== 'string' || expected.length < MIN_TOKEN_LENGTH) return false;
  if (get(PUBLISHER_HEADER) !== '1') return false;
  const given = get(PUBLISHER_TOKEN_HEADER);
  return typeof given === 'string' && sameString(given, expected);
}

/** Koepfe fuer einen Abruf durch die Box. Wirft ohne gueltiges Geheimnis. */
export function publisherHeaders(token) {
  if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`${PUBLISHER_TOKEN_ENV} fehlt oder ist zu kurz`);
  }
  return { [PUBLISHER_HEADER]: '1', [PUBLISHER_TOKEN_HEADER]: token };
}

/**
 * Vorabpruefung der Box: kommt das Vorrecht bei der Seite an? Leichter Abruf
 * mit eigenem `_pub`, damit keine Edge-Kopie antwortet. Wirft mit Grund, wenn
 * nicht — der Aufrufer beendet den Lauf dann mit Exit 1.
 */
export async function assertPublisherAccepted(site, token, { timeoutMs = 30_000 } = {}) {
  const url = `${site.replace(/\/$/, '')}/api/tft/sets/current?_pub=check-${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: publisherHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.headers.get(PUBLISHER_ACCEPTED_HEADER) !== '1') {
    throw new Error(`Publisher-Vorrecht nicht angenommen (HTTP ${res.status}) — ${PUBLISHER_TOKEN_ENV} auf Box und Vercel gleich?`);
  }
}

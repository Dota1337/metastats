/**
 * Single Source of Truth für Riot-Rate-Limits und ihre Aufteilung auf unsere
 * Prozesse. Vorher standen die Zahlen als nackte Literale in sechs Scripts —
 * eines davon (prewarm) driftete unbemerkt ein halbes Jahr auf einem Wert, der
 * an anderer Stelle längst gesenkt worden war.
 *
 * WICHTIG — zwei Dinge, die man hier leicht falsch macht:
 *
 * 1. **Limits gelten PRO REGIONAL-ROUTE, nicht global.** Gemessen 2026-08-04
 *    per Header-Probe auf allen vier Routes mit demselben Key: asia stand bei
 *    3096/600s, americas gleichzeitig bei 1/600s. Wer gegen ein globales Budget
 *    rechnet, verschenkt drei Viertel davon.
 *
 * 2. **Rechne Anzahl gegen Anzahl, nie in req/s.** Der Limiter feuert greedy:
 *    alle N Requests eines Fensters können innerhalb einer Sekunde landen. Eine
 *    Umrechnung von "N pro 10,5 s" in einen Mittelwert mittelt genau die Spitze
 *    weg, gegen die Riots 10-s-Fenster prüft.
 *
 * Bindend ist nicht das App-Limit (500:10, 30000:600), sondern das Method-Limit
 * von `/tft/match/v1/matches/{id}` — der Endpoint, den jeder Batch-Prozess in
 * der Schleife aufruft.
 */

// Method-Limit für /tft/match/v1/matches/{id}, je Regional-Route (gemessen).
export const MATCH_DETAIL_LIMIT = { asia: 250, sea: 250, europe: 200, americas: 200 };
const FALLBACK_ROUTE_LIMIT = 200;   // unbekannte Route → vorsichtigster Wert

// Unser Fenster ist bewusst 500 ms breiter als Riots 10 s: die Fenster laufen
// nicht synchron, an der Kante zählen wir sonst gegen ein volleres Fenster als
// wir glauben.
export const SHORT_WINDOW_MS = 10_500;
export const LONG_WINDOW = { requests: 28_000, ms: 605_000 };  // 93 % von 30000/600s, ebenfalls pro Route

// Feste Reservierungen für Prozesse, die NICHT über systemd `Conflicts=`
// ausgeschlossen sind und daher jederzeit dazwischenfunken können.
export const RESERVED = {
  // Läuft permanent, bedient interaktive Requests. Muss immer Luft haben.
  'refresh-api': 60,
  // Timer alle 10 min. Bis 2026-08-04 komplett ungedrosselt.
  'companion-backfill': 25,
  // GH-Action 06:00 UTC, also OFF-BOX und von keinem `Conflicts=` erfasst.
  // Gemessen am Lauf 2026-08-04 (kr, 11.200 Spieler + 45.654 Matches in
  // 14.243 s): ~42 Requests pro 10,5 s. Die 60 sind knapp das Anderthalbfache
  // davon — genug Luft für den Normalfall, aber eine echte Decke für den
  // Cold-Fill, der vorher mit 180 losrennen durfte und am 2026-07-29 einen
  // Sturm von 789 abgefangenen 429ern verursacht hat.
  prewarm: 60,
};

const SAFETY = 0.9;

/**
 * Budget für die Batch-Prozesse auf der Box (Marktwert-Snapshot, All-Ranks-
 * Crawl, Cold-Sweep). Die schließen sich per `Conflicts=` gegenseitig aus, es
 * ist also immer höchstens einer davon aktiv.
 *
 * BEWUSSTE ENTSCHEIDUNG: `prewarm` ist hier NICHT abgezogen, obwohl es
 * überlappen kann. Zöge man es ab, bliebe auf asia statt 148 nur noch 94 —
 * mehr als ein Drittel weniger, um einen Verbraucher abzusichern, der real 42
 * braucht und dessen Decke jetzt bei 60 liegt. Die Summe der DECKEN liegt
 * damit über dem Method-Limit, die Summe der gemessenen VERBRÄUCHE deutlich
 * darunter. Absicherung ist der 429-Backoff in riot-client.mjs, der seit
 * 2026-08-04 alle Worker gemeinsam anhält statt nur den betroffenen.
 */
export function batchBudget(cluster) {
  const limit = MATCH_DETAIL_LIMIT[cluster] ?? FALLBACK_ROUTE_LIMIT;
  const reserved = RESERVED['refresh-api'] + RESERVED['companion-backfill'];
  return Math.floor((limit - reserved) * SAFETY);
}

/**
 * Fertiges Options-Objekt für `createRiotClient`.
 *
 * @param {'batch'|'refresh-api'|'companion-backfill'|'prewarm'} consumer
 * @param {string} [cluster] Regional-Route — nur für 'batch' relevant.
 */
export function riotWindowFor(consumer, cluster) {
  const shortWindowRequests = consumer === 'batch'
    ? batchBudget(cluster)
    : RESERVED[consumer];
  if (!shortWindowRequests) {
    throw new Error(`riotWindowFor: unbekannter Consumer "${consumer}"`);
  }
  return {
    shortWindowRequests,
    shortWindowMs: SHORT_WINDOW_MS,
    longWindowRequests: LONG_WINDOW.requests,
    longWindowMs: LONG_WINDOW.ms,
  };
}

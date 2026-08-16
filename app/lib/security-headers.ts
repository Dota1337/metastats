// Security-Header an EINER Stelle.
//
// Gesetzt werden sie in next.config.ts fuer alle Pfade. Die Middleware kurzt
// zwei Antworten ab, bevor der Routing-Layer sie sieht (404 bei abgeschaltetem
// Internal-Dashboard, 401 bei fehlender Cookie-Auth) — die muessen dieselben
// Header selbst anhaengen, sonst gehen ausgerechnet die Auth-Antworten nackt
// raus. Deshalb Liste statt zwei getrennter Aufzaehlungen.
//
// Bewusst NICHT dabei:
//
//   Content-Security-Policy — ohne report-uri ist eine Report-Only-CSP ein
//   toter Header: der Browser meldet gegen niemanden. Sentry laeuft hier
//   server-only (es gibt sentry.server.config.ts und sentry.edge.config.ts,
//   aber keine Client-Config), CSP-Reports sind aber Browser-POSTs und
//   brauchen Sentrys eigenen Security-Endpoint. Kommt als eigene Welle
//   zusammen mit dem Endpoint, dem Hash fuer das JSON-LD-Inline-Script in
//   app/layout.tsx und frame-src fuer den Twitch-Player.
//
//   includeSubDomains / preload bei HSTS — siehe Kommentar unten.
//
//   Cross-Origin-Opener-Policy — bricht Popup-Fenster, die per postMessage mit
//   dem Opener reden. Der Supabase-Login faehrt zwar Redirect statt Popup, aber
//   das ist im Moment nicht geprueft, und der Header bringt uns ohne
//   Cross-Origin-Isolation (die wir nicht brauchen) kaum etwas. Lieber spaeter
//   bewusst nachziehen als jetzt blind einen Login-Weg zumachen.

export const SECURITY_HEADERS: { key: string; value: string }[] = [
  {
    // Zweite Rampenstufe seit 2026-08-16: 1 Tag, ohne includeSubDomains, ohne
    // preload. Stufe 1 (300 s) stand seit 2026-08-14 ohne Zwischenfall.
    //
    // HSTS ist die einzige Zeile hier, die sich nicht zurueckrollen laesst:
    // ein Browser, der den Header einmal gesehen hat, erzwingt HTTPS fuer die
    // volle max-age — ein git revert erreicht ihn nicht mehr. Mit `preload`
    // kaeme die Domain zusaetzlich in eine Browser-Liste, aus der man sie nur
    // ueber Monate wieder herausbekommt, und `includeSubDomains` zieht jede
    // Subdomain mit, auch die, die es heute noch nicht gibt.
    //
    // Rampe: 300 → 86400 → 31536000, jede Stufe erst nach ein paar Tagen ohne
    // Zwischenfall. preload ist eine eigene Entscheidung, nicht das Ende der
    // Rampe.
    key: 'Strict-Transport-Security',
    value: 'max-age=86400',
  },
  {
    // Verhindert MIME-Sniffing: eine als JSON ausgelieferte Antwort wird nicht
    // als HTML interpretiert, nur weil sie zufaellig mit '<' beginnt.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Beim Klick auf einen externen Link geht nur die Herkunft mit, nicht der
    // volle Pfad. Unsere Pfade enthalten Spielernamen und PUUIDs.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Niemand darf uns framen (Clickjacking). Wir framen den Twitch-Player,
    // das ist die andere Richtung und davon unberuehrt.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Wir brauchen keine dieser Schnittstellen. Ein eingeschleustes Skript
    // damit auch nicht.
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=()',
  },
];

/** Fuer die Middleware-Antworten, die am Routing-Layer vorbeigehen. */
export function securityHeaderRecord(): Record<string, string> {
  return Object.fromEntries(SECURITY_HEADERS.map(h => [h.key, h.value]));
}

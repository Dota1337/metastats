// Gemeinsame Sentry-Optionen — Source-of-Truth für beide Init-Punkte:
// sentry.server.config.ts (Node) und sentry.edge.config.ts (Edge).
//
// Warum zentral statt gespiegelt: driften die Optionen auseinander, ist der
// Edge-Stream anders gefiltert als der Node-Stream und beide nicht mehr
// vergleichbar. Das ist exakt das Mirror-Drift-Muster aus
// reference_dual_module_patterns.md — hier von vornherein vermieden.
//
// BEWUSST server-only: eine instrumentation-client.ts kostet gemessen ~223 kB
// roh / ~70 kB gzip im First Load JEDER Seite, weil das Tree-Shaking-Flag
// __SENTRY_TRACING__ von @sentry/nextjs nur im Webpack-Pfad gesetzt wird
// (build/cjs/config/webpack.js) und dieses Projekt mit Turbopack baut. Browser-
// Fehler bleiben damit unerfasst — bewusste Entscheidung, nachruestbar.
//
// Diese Datei importiert bewusst NICHTS aus @sentry/*, damit sie in beiden
// Bundles ohne Laufzeit-Kosten liegt.

// Bewusst OHNE NEXT_PUBLIC_-Präfix. Gemessen am 2026-08-05: mit dem Präfix
// wird der Wert zur BUILD-Zeit einkompiliert — ein Server, der ohne die
// Variable startet, sendet dann trotzdem weiter (verifiziert gegen eine lokale
// Envelope-Senke). Ohne Präfix wird er zur Laufzeit gelesen und der Kill-Switch
// unten stimmt auch wirklich. Sentry läuft hier ausschliesslich server-seitig,
// der Client braucht den Wert also ohnehin nicht.
export const SENTRY_DSN = process.env.SENTRY_DSN;

// Kill-Switch. Rollback über `git revert` allein genügt nicht: bereits gebaute
// Vercel-Deployments sind immutable und würden mit eingebackenem DSN
// weitersenden. DSN aus den Env-Vars entfernen + Restart schaltet ab, ohne
// dass Code angefasst oder neu gebaut werden muss.
export const SENTRY_ENABLED =
  process.env.NODE_ENV === 'production' && !!SENTRY_DSN;

export const sentryBaseOptions = {
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment:
    process.env.NEXT_PUBLIC_VERCEL_ENV || process.env.VERCEL_ENV || process.env.NODE_ENV,

  // Error-Only, kein Performance-Tracing. Web-Vitals und Page-Views deckt
  // @vercel/analytics ab (app/layout.tsx) — ein zweiter Sampler würde dieselbe
  // Metrik doppelt instrumentieren, ohne einen zweiten Erkenntnisgewinn.
  tracesSampleRate: 0,

  // Keine IPs, keine Cookies, keine Header mit User-Bezug. Die Seite kommt
  // ohne Login aus; es gibt nichts, das ein Stack-Trace an Personenbezug
  // bräuchte.
  sendDefaultPii: false,
};

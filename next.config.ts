import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import { SECURITY_HEADERS } from "./app/lib/security-headers";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Das Layout von /teams/[id] liest die Team-ID-Liste per fs (404 fuer
  // unbekannte IDs) — die Datei muss deshalb in die Funktion.
  outputFileTracingIncludes: {
    '/teams/[id]': ['./public/pro-teams/index.json'],
    // Aufstellungs-Karte aus dem MetaTFT-Import, Dateiname haengt am Set.
    '/api/tft/positions/by-units': ['./public/tft-metatft-boards-*.json'],
  },
  // Security-Header fuer alles. Bewusst KEIN Cache-Control hier: der Matcher
  // trifft auch /_next/static/*, und dort steht bereits das richtige
  // Immutable-Header-Set von Next selbst. Cache-Frische bleibt in
  // app/lib/api-cache.ts, eine Entscheidung pro Datenart statt pro Pfadmuster.
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
  async redirects() {
    return [
      {
        source: '/tft',
        destination: '/tft/comps',
        permanent: true,
      },
      // /tft/gods war die Set-17-Goetter-Seite. Set 18 hat keine Gods, die
      // Route ist entfernt — alte Links landen auf dem Augment-Katalog.
      {
        source: '/tft/gods',
        destination: '/tft/augments',
        permanent: true,
      },
      // Lobby-Scout entfernt — der Explorer macht dasselbe (Champions waehlen → Comps).
      {
        source: '/tft/lobby-scout',
        destination: '/tft/explorer',
        permanent: true,
      },
      // One-Tricks vorerst abgeschaltet (2026-09-27), Rising steht an ihrer
      // Stelle. Bewusst voruebergehend (307): die Seite kann zurueckkommen.
      // Alte Multi-Suche: jetzt Reiter in /compare. Query (q) reicht Next selbst
      // durch (docs redirects.md). Als Seite gab es wegen app/loading.tsx nur
      // 200 + Meta-Refresh statt 307.
      {
        source: '/multi-search',
        destination: '/compare?mode=multi',
        permanent: false,
      },
      {
        source: '/tft/onetricks',
        destination: '/tft/rising',
        permanent: false,
      },
    ];
  },
};

// withSentryConfig ist nicht optional: es haengt den Build-Plugin-Hook ein und
// setzt die Release-Injection. Ohne den Wrapper laeuft Sentry zwar, aber ohne
// Release-Zuordnung.
//
// sourcemaps.disable: im ersten Wurf kein Source-Map-Upload — der braeuchte
// SENTRY_AUTH_TOKEN als zusaetzliches Build-Secret in Vercel. Ohne diese Zeile
// wuerden die Maps trotzdem generiert und Build-Zeit kosten, ohne je hochgeladen
// zu werden. Stack-Traces bleiben dadurch minifiziert; Fehler sind sichtbar.
//
// automaticVercelMonitors: aus. Legt sonst ungefragt Cron-Monitore an.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  automaticVercelMonitors: false,
});

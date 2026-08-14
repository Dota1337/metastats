import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";
import { SECURITY_HEADERS } from "./app/lib/security-headers";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
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

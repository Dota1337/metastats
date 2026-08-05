import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
  turbopack: {
    root: path.resolve(__dirname),
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

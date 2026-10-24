import type { NextConfig } from "next";
import path from "path";
import { closeSync, openSync, readdirSync, readFileSync, readSync } from "fs";
// Build-Wrapper aus dem config-Einstieg (der alte Weg ueber "@sentry/nextjs"
// faellt mit Sentry 11 weg). Die Laufzeit-Importe (instrumentation.ts,
// sentry.*.config.ts, revalidate-Route) bleiben bei "@sentry/nextjs": der
// config-Einstieg hat keine Edge- und keine Browser-Variante.
import { withSentryConfig } from "@sentry/nextjs/config";
import { SECURITY_HEADERS } from "./app/lib/security-headers";
import { PREFIX_LANGS } from "./app/lib/lang-path";
import { TFT_IS_HOME } from "./app/lib/feature-flags";
import { TFT_HOME } from "./app/lib/games";

// Wochendateien, deren Kopf ein anderes Set als public/tft-set.json nennt
// (die Dateien beginnen mit {"set":N, collect-tft-allranks.mjs). Kann der Kopf
// nicht gelesen werden, bleibt die Datei drin — groesser, aber nie falsch.
function staleTftStatsFiles(): string[] {
  try {
    const dir = path.resolve(__dirname, "public");
    const current = JSON.parse(readFileSync(path.join(dir, "tft-set.json"), "utf8")).setNumber;
    return readdirSync(dir)
      .filter(f => /^tft-stats-[a-z0-9]+\.json$/.test(f))
      .filter(f => {
        const fd = openSync(path.join(dir, f), "r");
        const head = Buffer.alloc(32);
        try { readSync(fd, head, 0, head.length, 0); } finally { closeSync(fd); }
        const m = /^\{"set":(\d+)[,}]/.exec(head.toString("utf8"));
        return !!m && Number(m[1]) !== current;
      })
      .map(f => `./public/${f}`);
  } catch {
    return [];
  }
}

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
    // Item-Infotext im ersten HTML (tft-item-texts-server.ts), Name am Set.
    '/tft/items/[id]': ['./public/tft-item-texts-*.json'],
    // Faehigkeit + Grundwerte im ersten HTML (tft-unit-info-server.ts), Name am Set.
    '/tft/units/[id]': ['./public/tft-unit-info-*.json'],
  },
  // Wochendateien (public/tft-stats-<region>.json) kommen in jede Funktion,
  // die loadTftStats erreicht — der Dateiname steht erst zur Laufzeit fest.
  // Die Detailseiten (Startdaten, SEO-Plan Schritt 5) brauchen davon nur die
  // des laufenden Sets: eine Datei eines anderen Sets lehnt loadTftStats ab
  // (tft-stats-loader.ts). Am 15.10.2026 waren das 14 von 15 Dateien, 93 MB —
  // der Wochenlauf erneuert nur euw1. Die Trait-Seite liest gar keine.
  outputFileTracingExcludes: {
    '/tft/units/\\[id\\]': staleTftStatsFiles(),
    '/tft/items/\\[id\\]': staleTftStatsFiles(),
    '/tft/traits/\\[name\\]': ['./public/tft-stats-*.json'],
  },
  // Security-Header fuer alles. Bewusst KEIN Cache-Control hier: der Matcher
  // trifft auch /_next/static/*, und dort steht bereits das richtige
  // Immutable-Header-Set von Next selbst. Cache-Frische bleibt in
  // app/lib/api-cache.ts, eine Entscheidung pro Datenart statt pro Pfadmuster.
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },
  // Jede Weiterleitung gilt auch unter den Sprach-Adressen (/en/tft → /en/tft/comps).
  // Redirects laufen VOR der Middleware; ohne die Spiegelung schriebe sie
  // /en/tft auf /tft um, und das gibt es als Seite nicht (404) — und
  // /en/tft/onetricks zeigte die abgeschaltete Seite statt Rising.
  async redirects() {
    const langSource = `/:lang(${PREFIX_LANGS.join('|')})`;
    const base = [
      // Hauptseite (Schalter TFT_IS_HOME, feature-flags.ts): an → `/` auf die
      // TFT-Uebersicht, aus → `/lol` zurueck auf `/`. Beide nur 307 — eine
      // gemerkte 308 liesse sich beim Umlegen nicht mehr zuruecknehmen.
      TFT_IS_HOME
        ? { source: '/', destination: TFT_HOME, permanent: false }
        : { source: '/lol', destination: '/', permanent: false },
      // Bis 2026-10-15 eine 308 auf /tft/comps; Browser, die sie sich gemerkt
      // haben, landen weiter auf der Liste (gueltige Seite, harmlos).
      {
        source: '/tft',
        destination: TFT_HOME,
        permanent: false,
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
    // `/` ohne Schraegstrich anhaengen (/en, nicht /en/) — so macht es Next
    // selbst bei i18n (node_modules/next/dist/lib/load-custom-routes.js).
    const tail = (p: string) => (p === '/' ? '' : p);
    return base.flatMap(r => [r, { ...r, source: langSource + tail(r.source), destination: '/:lang' + tail(r.destination) }]);
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
// automaticVercelMonitors: aus. Legt sonst ungefragt Cron-Monitore an
// (vercel.json hat Crons). Steht seit Sentry 10.7x unter webpack.
export default withSentryConfig(nextConfig, {
  silent: true,
  sourcemaps: { disable: true },
  webpack: { automaticVercelMonitors: false },
});

// Oeffentlicher Riot-Plattformstatus fuer das Stoerungs-Banner auf den
// TFT-Seiten (app/components/tft/RiotStatusBanner.tsx).
//
// Warum eine eigene Route und nicht /api/internal/riot-status:
//   1. Die interne liegt hinter dem Login — middleware.ts:20-45 laesst nur
//      drei Pfade ohne Cookie durch, und diese Liste zu oeffnen wuerde das
//      Ops-Dashboard mit aufmachen.
//   2. Sie antwortet bewusst mit `no-store`. Fuer eine Seite mit Publikum
//      hiesse das: ein Funktionsaufruf und bis zu 15 Riot-Anfragen pro
//      Besucher. Hier haengen Cache-Kopfzeilen dran.
//   3. Riots Meldungstext ist englisch. Die Seite ist sechssprachig, also
//      zeigen wir Stufe und Region und uebersetzen den Rahmen selbst
//      (siehe feedback_auto_translate_new_code).
//
// Die Antwort enthaelt deshalb bewusst weder `summary` noch `error`: beides
// ist Betriebsinformation und gehoert ins Dashboard, nicht auf die Startseite.

import { NextResponse } from 'next/server';
import { getRiotStatus } from '@/app/lib/riot-status';
import { cacheHeaders } from '@/app/lib/api-cache';

export const dynamic = 'force-dynamic';

// Zwei Minuten frisch, zehn Minuten stale-while-revalidate. Kuerzer als jede
// Stats-Route, weil eine Stoerung genau dann interessiert, wenn sie beginnt —
// und laenger als null, weil sonst jeder Seitenaufruf einen Funktionsaufruf
// kostet. Der In-Process-Cache der Lib (5 min) liegt dahinter; die Edge
// federt den Rest ab.
//
// Die Zeiten gehen ueber `cacheHeaders()` raus, also in der Zeile
// `Vercel-CDN-Cache-Control`. Ein blankes `Cache-Control: s-maxage=…` wuerde
// Vercel vor der Auslieferung streichen — der Browser bekaeme dann gar keine
// Angabe (siehe app/lib/api-cache.ts und scripts/check-drift.mjs, Block N).
const STATUS_CDN_CACHE_CONTROL = 'public, s-maxage=120, stale-while-revalidate=600';
// Degradiert: kein Schluessel oder Riot nicht erreichbar. Kurz halten, damit
// ein Aussetzer nicht zehn Minuten festgeschrieben wird.
const STATUS_DEGRADED_CDN_CACHE_CONTROL = 'public, s-maxage=30, stale-while-revalidate=60';

export interface PublicRiotRegion {
  region: string;
  status: 'ok' | 'info' | 'warning' | 'critical' | 'unknown';
  worstSeverity: 'info' | 'warning' | 'critical' | null;
  activeIncidents: number;
  activeMaintenances: number;
}

export async function GET() {
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    // 200 mit leerer Liste, nicht 503: das Banner soll bei einem fehlenden
    // Schluessel schweigen, nicht dem Besucher einen Fehler zeigen.
    return NextResponse.json(
      { cachedAt: null, regions: [] as PublicRiotRegion[] },
      { headers: cacheHeaders(STATUS_DEGRADED_CDN_CACHE_CONTROL) },
    );
  }

  const { at, regions } = await getRiotStatus(apiKey);

  const publicRegions: PublicRiotRegion[] = regions.map(r => ({
    region: r.region,
    status: r.status,
    worstSeverity: r.worstSeverity,
    activeIncidents: r.activeIncidents,
    activeMaintenances: r.activeMaintenances,
  }));

  // Wenn KEINE Region eine Antwort geliefert hat, ist das unser Problem und
  // nicht Riots Stoerung — dann kurz cachen statt zwei Minuten.
  const allUnknown = publicRegions.length > 0 && publicRegions.every(r => r.status === 'unknown');

  return NextResponse.json(
    { cachedAt: new Date(at).toISOString(), regions: publicRegions },
    { headers: cacheHeaders(allUnknown ? STATUS_DEGRADED_CDN_CACHE_CONTROL : STATUS_CDN_CACHE_CONTROL) },
  );
}

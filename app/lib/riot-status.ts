// Riot-TFT-Plattformstatus je Region — gemeinsame Quelle fuer zwei Ausgaben:
//
//   * app/api/internal/riot-status  — Ops-Dashboard, hinter dem Login,
//     ungecacht, MIT Riots eigenem Meldungstext und Fehlerdetails.
//   * app/api/tft/status            — oeffentlich, gecacht, OHNE Meldungstext
//     (der ist englisch und die Seite ist sechssprachig) und ohne Fehlerdetails.
//
// Warum geteilt und nicht zweimal geschrieben: die Klassifizierung in
// ok/info/warning/critical ist die eigentliche Logik. Zwei Kopien haetten
// bedeutet, dass das Dashboard und das oeffentliche Banner bei derselben
// Riot-Meldung unterschiedliche Stufen zeigen koennen.

import { ACTIVE_REGIONS } from './active-regions';
import { riotFetch } from './riot-fetch';

export const RIOT_STATUS_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

export type RiotSeverity = 'info' | 'warning' | 'critical';
export type RiotRegionStatus = 'ok' | RiotSeverity | 'unknown';

export const RIOT_SEVERITY_RANK: Record<RiotSeverity, number> = { info: 1, warning: 2, critical: 3 };

interface RiotMaintenance {
  id?: number;
  incident_severity?: RiotSeverity;
  maintenance_status?: 'scheduled' | 'in_progress' | 'complete';
  updates?: Array<{ created_at?: string; updated_at?: string; translations?: Array<{ locale: string; content: string }> }>;
}

interface RiotPlatformData {
  id?: string;
  name?: string;
  maintenances?: RiotMaintenance[];
  incidents?: RiotMaintenance[];
}

export interface RiotRegionEntry {
  region: string;
  status: RiotRegionStatus;
  activeIncidents: number;
  activeMaintenances: number;
  worstSeverity: RiotSeverity | null;
  summary: string | null;       // erstes Update aus erstem aktiven Item
  error?: string;
}

// In-Process-Cache. Bei Vercel Fluid Compute ueberlebt er zwischen Aufrufen
// derselben Instanz; bei Kaltstart werden die 15 Regionen einmal neu geholt.
// Er ersetzt KEINEN Edge-Cache — die oeffentliche Route braucht zusaetzlich
// ihre Cache-Kopfzeilen, sonst zahlt jeder Seitenaufruf einen Funktionsaufruf.
let cache: { at: number; data: RiotRegionEntry[] } | null = null;

async function fetchRegion(region: string, apiKey: string): Promise<RiotRegionEntry> {
  const url = `https://${region}.api.riotgames.com/tft/status/v1/platform-data`;
  try {
    const r = await riotFetch(url, apiKey, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {
      return {
        region, status: 'unknown', activeIncidents: 0, activeMaintenances: 0,
        worstSeverity: null, summary: null, error: `HTTP ${r.status}`,
      };
    }
    const data = await r.json() as RiotPlatformData;
    // "Aktiv" = alles ohne `complete`-Status. Riot liefert hier auch geplante
    // Wartungen — bei denen zaehlt nur, was gerade laeuft.
    const activeIncidents = (data.incidents || []).filter(
      i => i.maintenance_status !== 'complete',
    );
    const activeMaintenances = (data.maintenances || []).filter(
      m => m.maintenance_status === 'in_progress',
    );

    const allActive = [...activeIncidents, ...activeMaintenances];
    const severities = allActive
      .map(i => i.incident_severity)
      .filter((s): s is RiotSeverity => s != null);

    const worstSeverity = severities.length === 0
      ? null
      : severities.reduce((acc, s) => RIOT_SEVERITY_RANK[s] > RIOT_SEVERITY_RANK[acc] ? s : acc);

    const status: RiotRegionStatus = worstSeverity ?? (allActive.length > 0 ? 'info' : 'ok');

    // Erstes Update-Statement (Englisch bevorzugt) — nur fuer das Dashboard.
    let summary: string | null = null;
    if (allActive.length > 0) {
      const first = allActive[0];
      const lastUpdate = (first.updates || [])[0];
      const tr = (lastUpdate?.translations || []).find(t => t.locale === 'en_US')
              ?? (lastUpdate?.translations || [])[0];
      summary = tr?.content?.slice(0, 200) || null;
    }

    return {
      region, status,
      activeIncidents: activeIncidents.length,
      activeMaintenances: activeMaintenances.length,
      worstSeverity, summary,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'fetch_failed';
    return {
      region, status: 'unknown', activeIncidents: 0, activeMaintenances: 0,
      worstSeverity: null, summary: null, error: message,
    };
  }
}

/**
 * Alle aktiven Regionen, hoechstens alle 5 Minuten wirklich abgefragt.
 * `at` ist der Zeitpunkt der letzten echten Abfrage, nicht der des Aufrufs.
 */
export async function getRiotStatus(apiKey: string): Promise<{ at: number; regions: RiotRegionEntry[] }> {
  if (cache && Date.now() - cache.at < RIOT_STATUS_TTL_MS) {
    return { at: cache.at, regions: cache.data };
  }
  // Parallel; die Gesamtzeit ist die der langsamsten Region (~1-3 s).
  const results = await Promise.all(ACTIVE_REGIONS.map(r => fetchRegion(r, apiKey)));
  cache = { at: Date.now(), data: results };
  return { at: cache.at, regions: results };
}

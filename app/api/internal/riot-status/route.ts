// Riot-TFT-Platform-Status-Endpoint für das Internal-Ops-Dashboard.
//
// Riot bietet pro Region `/tft/status/v1/platform-data` mit aktiven
// Incidents + geplanten Maintenances. Wir pollen alle 15 aktiven Regionen,
// klassifizieren in ok/info/warning/critical und liefern eine kompakte
// Summary für das Dashboard.
//
// Pattern wie ops-snapshot: force-dynamic + no-store + In-Process-Cache
// (5min TTL), damit Multi-Tab-Polling die Riot-Quota nicht angreift.
// Quota-Bedarf bei 15 Regionen × 1 Call alle 5 min = 3 req/min — trivial.

import { NextRequest, NextResponse } from 'next/server';
import { ACTIVE_REGIONS } from '@/app/lib/active-regions';

export const dynamic = 'force-dynamic';

// Auth-Schutz: middleware.ts hat Early-Return-Branch für /api/internal/*
// und validiert den __metastats_internal Cookie. Hier braucht's daher
// keinen expliziten Auth-Check (siehe reference_internal_ops_dashboard.md).

const CACHE_TTL_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;

type Severity = 'info' | 'warning' | 'critical';
type RegionStatus = 'ok' | Severity | 'unknown';

interface RiotMaintenance {
  id?: number;
  incident_severity?: Severity;
  maintenance_status?: 'scheduled' | 'in_progress' | 'complete';
  updates?: Array<{ created_at?: string; updated_at?: string; translations?: Array<{ locale: string; content: string }> }>;
}

interface RiotPlatformData {
  id?: string;
  name?: string;
  maintenances?: RiotMaintenance[];
  incidents?: RiotMaintenance[];
}

interface RegionEntry {
  region: string;
  status: RegionStatus;
  activeIncidents: number;
  activeMaintenances: number;
  worstSeverity: Severity | null;
  summary: string | null;       // erstes Update aus erstem aktiven Item
  error?: string;
}

// In-Process-Cache. Bei Vercel Fluid Compute überlebt der Cache zwischen
// Invocations derselben Instance — bei Cold-Start neu aufgebaut (15 Calls
// einmalig). Acceptable trade-off vs externer Cache-Layer.
let cache: { at: number; data: RegionEntry[] } | null = null;

async function fetchRegion(region: string, apiKey: string): Promise<RegionEntry> {
  const url = `https://${region}.api.riotgames.com/tft/status/v1/platform-data?api_key=${apiKey}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!r.ok) {
      return {
        region, status: 'unknown', activeIncidents: 0, activeMaintenances: 0,
        worstSeverity: null, summary: null, error: `HTTP ${r.status}`,
      };
    }
    const data = await r.json() as RiotPlatformData;
    // "Active" = incidents/maintenances ohne `complete`-Status. Riot liefert
    // hier alle aktiven + geplanten — wir filtern auf das was JETZT relevant ist.
    const activeIncidents = (data.incidents || []).filter(
      i => i.maintenance_status !== 'complete',
    );
    const activeMaintenances = (data.maintenances || []).filter(
      m => m.maintenance_status === 'in_progress',
    );

    const allActive = [...activeIncidents, ...activeMaintenances];
    const severities = allActive
      .map(i => i.incident_severity)
      .filter((s): s is Severity => s != null);

    const severityRank: Record<Severity, number> = { info: 1, warning: 2, critical: 3 };
    const worstSeverity = severities.length === 0
      ? null
      : severities.reduce((acc, s) => severityRank[s] > severityRank[acc] ? s : acc);

    const status: RegionStatus = worstSeverity ?? (allActive.length > 0 ? 'info' : 'ok');

    // Erstes Update-Statement extrahieren (Englisch bevorzugt).
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

export async function GET(_request: NextRequest) {
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'RIOT_API_KEY_TFT not configured', regions: [] },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Cache-Hit?
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(
      { cachedAt: new Date(cache.at).toISOString(), regions: cache.data },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Parallel-Pull aller 15 Regionen. Total-Time ~max(Region-Time) ≈ 1-3s.
  const results = await Promise.all(ACTIVE_REGIONS.map(r => fetchRegion(r, apiKey)));
  cache = { at: Date.now(), data: results };

  return NextResponse.json(
    { cachedAt: new Date(cache.at).toISOString(), regions: results },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

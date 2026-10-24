// Aggregator für das Internal-Ops-Dashboard. Sammelt drei Quellen parallel:
//   1. Hetzner systemd: `/healthz?detail=services` auf der Crawler-Box. Liefert
//      dynamische Service-Liste mit ActiveState/SubState/Result/Timestamps.
//   2. Supabase: row-counts via `pg_class.reltuples` (estimated, near-instant)
//      + fuer die Comp-Tabelle der juengste Tag samt Zeilenzahl (Index auf `day`).
//   3. Vercel-Blob Manifest: builtAt + Entry-Count.
//
// Status-Modell semantisch korrekt (Daily-Crawl ist 90 % `inactive/success`,
// das ist `healthy` für oneshot — nicht „idle"). Art und Frist je Dienst stehen
// in app/lib/ops-services.ts, ein Test haelt sie gegen infra/system-map.json.

import { NextRequest, NextResponse } from 'next/server';
import apiMap from '../../../../infra/api-map.json';
import { OPS_SERVICES } from '../../../lib/ops-services';
import { BOX_TLS_PORT, boxFetch } from '../../../lib/box-tls.mjs';

export const dynamic = 'force-dynamic';

// Rueckfall = der https-Zugang der Box mit eigenem Zertifikat (box-tls.mjs); den
// frueher hier stehenden Namen refresh.metastats.gg gab es nie im DNS.
const HETZNER_BASE = process.env.HETZNER_REFRESH_URL || `https://37.27.219.140:${BOX_TLS_PORT}`;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MANIFEST_URL = process.env.SNAPSHOT_MANIFEST_URL || '';

const FETCH_TIMEOUT_MS = 5000;

// 'inactive' = bewusst abgeschaltet oder noch nicht eingerichtet (Art
// retired/prepared in ops-services.ts) — grau statt dauerhaft "verzoegert".
type ServiceStatus = 'healthy' | 'working' | 'stalled' | 'failed' | 'unknown' | 'inactive';

interface ServiceRecord {
  name: string;
  type?: string | null;
  activeState?: string | null;
  subState?: string | null;
  result?: string | null;
  activeEnterTs?: string | null;
  activeExitTs?: string | null;
  inactiveEnterTs?: string | null;
  execMainStartTs?: string | null;
  execMainExitTs?: string | null;
}

interface ServiceView {
  name: string;
  status: ServiceStatus;
  activeState: string;
  subState: string;
  result: string;
  kind: string;
  lastRunStart: string | null;
  lastRunEnd: string | null;
  ageSinceLastRunMs: number | null;
  expectedMaxAgeMs: number | null;
}

function classifyService(rec: ServiceRecord, now: number): ServiceView {
  const expectation = OPS_SERVICES[rec.name];
  // Ohne Eintrag (neue Unit vor dem naechsten Deploy): als Einzellauf ohne
  // Frist werten. Der Test in ops-services.test.mjs laesst das nicht lange zu.
  const kind = expectation?.kind || 'oneshot';
  const activeState = rec.activeState || 'unknown';
  const result = rec.result || 'unknown';

  // Activating ist „working" — egal welche Art, auch ein stillgelegter Dienst,
  // den jemand von Hand startet.
  if (activeState === 'activating') {
    return baseView(rec, 'working', kind, expectation?.maxAgeMs || null, now);
  }
  if (kind === 'retired' || kind === 'prepared') {
    return baseView(rec, 'inactive', kind, null, now);
  }
  // Persistente Services müssen aktiv sein, sonst sind sie failed.
  if (kind === 'persistent') {
    if (activeState === 'active') {
      return baseView(rec, 'healthy', kind, expectation?.maxAgeMs || null, now);
    }
    return baseView(rec, 'failed', kind, expectation?.maxAgeMs || null, now);
  }
  // Oneshot: Result entscheidet, plus Stalled wenn maxAge überschritten.
  if (result === 'failed' || result === 'timeout') {
    return baseView(rec, 'failed', kind, expectation?.maxAgeMs || null, now);
  }
  const view = baseView(rec, 'healthy', kind, expectation?.maxAgeMs || null, now);
  if (expectation?.maxAgeMs && view.ageSinceLastRunMs && view.ageSinceLastRunMs > expectation.maxAgeMs) {
    view.status = 'stalled';
  }
  return view;
}

function baseView(rec: ServiceRecord, status: ServiceStatus, kind: string, maxAge: number | null, now: number): ServiceView {
  const lastEnd = rec.execMainExitTs || rec.inactiveEnterTs || null;
  const lastStart = rec.execMainStartTs || rec.activeEnterTs || null;
  const ageSinceLastRunMs = lastEnd ? now - new Date(lastEnd).getTime() : null;
  return {
    name: rec.name,
    status,
    activeState: rec.activeState || 'unknown',
    subState: rec.subState || 'unknown',
    result: rec.result || 'unknown',
    kind,
    lastRunStart: lastStart,
    lastRunEnd: lastEnd,
    ageSinceLastRunMs,
    expectedMaxAgeMs: maxAge,
  };
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(t);
  }
}

async function fetchServices() {
  const url = `${HETZNER_BASE.replace(/\/$/, '')}/healthz?detail=services`;
  // Die Dienstliste verlangt auf der Box den Schluessel (Sicherheitsdurchsicht
  // 24.10.2026, statusseite-ohne-zugang) — ohne ihn sah jeder, welche Dienste
  // wann liefen und welche gescheitert sind.
  const token = process.env.REFRESH_API_TOKEN;
  // boxFetch statt fetchWithTimeout: https zur Box geht nur mit dem gepinnten Zertifikat.
  const res = await boxFetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`hetzner ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const services = (data.services as ServiceRecord[]).map(s => classifyService(s, now));
  return { services, fetchedAt: new Date(now).toISOString() };
}

// Schätzwerte aus pg_class — VACUUM/ANALYZE-genau, near-instant statt
// COUNT(*) auf grossen Tabellen. Dazu fuer die Comp-Tabelle der juengste Tag
// und dessen exakte Zeilenzahl: der Tageslauf schreibt den Vortag, "heute"
// waere dort immer 0. Index (day, patch, set_number) aus Migration 0093,
// gemessen 24.10.2026: juengster Tag 127–277 ms, Zaehlung 90–96 ms.
//
// Beim Marktwert gibt es bewusst keine Tageszahl: kein Index beginnt mit
// snapshot_date, die Zaehlung las jedes Mal alle ~2,4 Mio Zeilen (4,6 s, oft
// ueber der 5-s-Frist, dann stand "—"). Und der juengste Tag je Region taeuscht:
// einzelne Aktualisierungen ueber den Knopf legen schon den naechsten Tag an
// (euw1 24.10. mit 71 Zeilen, waehrend der Lauf noch den 23. schrieb). Ob der
// Marktwert frisch ist, zeigt der Dienst-Knoten des Laufs.
async function fetchDbCounts() {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('supabase env missing');
  const tables = [
    'tft_daily_comp_stats',
    'tft_player_marketvalue_snapshots',
    'tft_player_match_cache',
  ];
  const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
  // Schätzung über REST: `count=estimated` liest reltuples statt COUNT(*).
  const counts: Record<string, { estimated: number | null; latestDay: string | null; latestDayRows: number | null }> = {};
  await Promise.all(tables.map(async tbl => {
    let estimated: number | null = null;
    let latestDay: string | null = null;
    let latestDayRows: number | null = null;
    try {
      const res = await fetchWithTimeout(`${SUPA_URL}/rest/v1/${tbl}?select=*&limit=0`, {
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          Prefer: 'count=estimated',
        },
      });
      const range = res.headers.get('content-range');
      if (range) {
        const m = /\/(\d+|\*)$/.exec(range);
        if (m && m[1] !== '*') estimated = parseInt(m[1], 10);
      }
    } catch { /* leave null */ }
    if (tbl === 'tft_daily_comp_stats') {
      try {
        const res = await fetchWithTimeout(`${SUPA_URL}/rest/v1/${tbl}?select=day&order=day.desc&limit=1`, { headers });
        const rows = res.ok ? await res.json() as Array<{ day: string }> : [];
        latestDay = rows[0]?.day ?? null;
        if (latestDay) {
          const c = await fetchWithTimeout(
            `${SUPA_URL}/rest/v1/${tbl}?select=*&limit=0&day=eq.${latestDay}`,
            { headers: { ...headers, Prefer: 'count=exact' } },
          );
          const m = /\/(\d+)$/.exec(c.headers.get('content-range') || '');
          if (m) latestDayRows = parseInt(m[1], 10);
        }
      } catch { /* leave null */ }
    }
    counts[tbl] = { estimated, latestDay, latestDayRows };
  }));
  return { counts, fetchedAt: new Date().toISOString() };
}

// Lebendzustand der Tabellen, die der Graph zeigt. Die Namensliste kommt aus
// infra/api-map.json, damit sie nicht neben der Karte herdriftet: was der
// Graph zeichnet, wird auch geprueft.
//
// Ein Treffer heisst: Tabelle da. HTTP 404 heisst: Tabelle gibt es in der
// Datenbank nicht (so faellt `champion_stats` auf, auf das drei Routen lesen).
// Alles andere (Zeitueberschreitung, 5xx) bleibt `null` — unbekannt ist nicht
// dasselbe wie leer, und ein grauer Knoten waere hier eine Luege.
async function fetchTableState() {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('supabase env missing');
  const names = (apiMap.nodes as { kind: string; label: string }[])
    .filter(n => n.kind === 'table').map(n => n.label).sort();
  const state: Record<string, { exists: boolean | null; estimated: number | null }> = {};
  await Promise.all(names.map(async tbl => {
    let exists: boolean | null = null;
    let estimated: number | null = null;
    try {
      const res = await fetchWithTimeout(`${SUPA_URL}/rest/v1/${tbl}?select=*&limit=0`, {
        headers: {
          apikey: SUPA_KEY,
          Authorization: `Bearer ${SUPA_KEY}`,
          Prefer: 'count=estimated',
        },
      });
      if (res.status === 404) {
        exists = false;
      } else if (res.ok) {
        exists = true;
        const range = res.headers.get('content-range');
        const m = range ? new RegExp('\\/(\\d+|\\*)$').exec(range) : null;
        if (m && m[1] !== '*') estimated = parseInt(m[1], 10);
      }
    } catch { /* unbekannt lassen */ }
    state[tbl] = { exists, estimated };
  }));
  return { state, fetchedAt: new Date().toISOString() };
}

async function fetchManifest() {
  if (!MANIFEST_URL) throw new Error('SNAPSHOT_MANIFEST_URL missing');
  const res = await fetchWithTimeout(MANIFEST_URL);
  if (!res.ok) throw new Error(`blob ${res.status}`);
  const data = await res.json();
  return {
    builtAt: data.builtAt as string,
    entries: Object.keys(data.entries || {}).length,
    patches: data.patches,
    fetchedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  // Slice-Param: 'all' | 'services' | 'db' | 'manifest' | 'tables'. Erlaubt dem Client
  // multi-tier Polling (Services 30s, DB 60s, Manifest 120s) ohne separate
  // Endpoints zu pflegen.
  const slice = req.nextUrl.searchParams.get('slice') || 'all';
  const want = (k: string) => slice === 'all' || slice === k;

  const [servicesRes, dbRes, manifestRes, tablesRes] = await Promise.allSettled([
    want('services') ? fetchServices() : Promise.resolve(null),
    want('db') ? fetchDbCounts() : Promise.resolve(null),
    want('manifest') ? fetchManifest() : Promise.resolve(null),
    want('tables') ? fetchTableState() : Promise.resolve(null),
  ]);

  const payload = {
    fetchedAt: new Date().toISOString(),
    services: servicesRes.status === 'fulfilled' ? servicesRes.value : null,
    db: dbRes.status === 'fulfilled' ? dbRes.value : null,
    manifest: manifestRes.status === 'fulfilled' ? manifestRes.value : null,
    tables: tablesRes.status === 'fulfilled' ? tablesRes.value : null,
    errors: {
      services: servicesRes.status === 'rejected' ? String(servicesRes.reason?.message || servicesRes.reason) : null,
      db: dbRes.status === 'rejected' ? String(dbRes.reason?.message || dbRes.reason) : null,
      manifest: manifestRes.status === 'rejected' ? String(manifestRes.reason?.message || manifestRes.reason) : null,
      tables: tablesRes.status === 'rejected' ? String(tablesRes.reason?.message || tablesRes.reason) : null,
    },
  };
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

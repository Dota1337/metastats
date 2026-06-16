// Aggregator für das Internal-Ops-Dashboard. Sammelt drei Quellen parallel:
//   1. Hetzner systemd: `/healthz?detail=services` auf der Crawler-Box. Liefert
//      dynamische Service-Liste mit ActiveState/SubState/Result/Timestamps.
//   2. Supabase: row-counts via `pg_class.reltuples` (estimated, near-instant)
//      + per-Day-COUNT(*) für heutige Schreibaktivität, gefiltert auf indizierten
//      `day`-Column.
//   3. Vercel-Blob Manifest: builtAt + Entry-Count.
//
// Status-Modell semantisch korrekt (Daily-Crawl ist 90 % `inactive/success`,
// das ist `healthy` für oneshot — nicht „idle"). Cadence-Erwartungen sind pro
// Service hardcoded weil sie aus systemd-Timer-Config kommen, nicht aus der DB.

import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const HETZNER_BASE = process.env.HETZNER_REFRESH_URL || 'https://refresh.metastats.gg';
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MANIFEST_URL = process.env.SNAPSHOT_MANIFEST_URL || '';

const FETCH_TIMEOUT_MS = 5000;

// Erwartete max. Cadence pro Service. Wenn der letzte erfolgreiche Lauf länger
// als das zurückliegt, gilt der Service als `stalled`. Persistente Services
// (refresh-api) müssen ActiveState=active sein.
const SERVICE_EXPECTATIONS: Record<string, { kind: 'oneshot' | 'persistent'; maxAgeMs?: number }> = {
  'metastats-refresh-api.service':           { kind: 'persistent' },
  'metastats-daily-crawl.service':           { kind: 'oneshot', maxAgeMs: 26 * 60 * 60 * 1000 },
  'metastats-snapshot-publisher.service':    { kind: 'oneshot', maxAgeMs: 26 * 60 * 60 * 1000 },
  'metastats-daily-crawl-catchup.service':   { kind: 'oneshot', maxAgeMs: 26 * 60 * 60 * 1000 },
  'metastats-companion-backfill.service':    { kind: 'oneshot', maxAgeMs: 30 * 60 * 1000 },
  'metastats-position-aggregator.service':   { kind: 'oneshot', maxAgeMs: 30 * 60 * 1000 },
  'metastats-build-check.service':           { kind: 'oneshot', maxAgeMs: 20 * 60 * 1000 },
  'metastats-health.service':                { kind: 'oneshot', maxAgeMs: 10 * 60 * 1000 },
  'metastats-tft-pro-validator.service':     { kind: 'oneshot', maxAgeMs: 26 * 60 * 60 * 1000 },
  'metastats-tft-pro-fullsync.service':      { kind: 'oneshot', maxAgeMs: 8 * 24 * 60 * 60 * 1000 },
  'metastats-tft-pro-tpc-roster.service':    { kind: 'oneshot', maxAgeMs: 8 * 24 * 60 * 60 * 1000 },
  'metastats-tft-pro-classify.service':      { kind: 'oneshot', maxAgeMs: 26 * 60 * 60 * 1000 },
  'metastats-crawler.service':               { kind: 'oneshot' }, // manual-trigger, keine erwartete Cadence
  'metastats-lol-marketvalue.service':       { kind: 'oneshot' }, // manual-trigger
};

type ServiceStatus = 'healthy' | 'working' | 'stalled' | 'failed' | 'unknown';

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
  const expectation = SERVICE_EXPECTATIONS[rec.name];
  const kind = expectation?.kind || 'oneshot';
  const activeState = rec.activeState || 'unknown';
  const result = rec.result || 'unknown';

  // Activating ist „working" — egal ob persistent oder oneshot.
  if (activeState === 'activating') {
    return baseView(rec, 'working', kind, expectation?.maxAgeMs || null, now);
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
  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`hetzner ${res.status}`);
  const data = await res.json();
  const now = Date.now();
  const services = (data.services as ServiceRecord[]).map(s => classifyService(s, now));
  return { services, fetchedAt: new Date(now).toISOString() };
}

// Schätzwerte aus pg_class — VACUUM/ANALYZE-genau, near-instant statt
// COUNT(*) auf 35GB. Plus ein präzises COUNT(*) FILTER für heute, gefiltert
// auf indizierten `day`-Column (Migration 0020 hat covering indizes).
async function fetchDbCounts() {
  if (!SUPA_URL || !SUPA_KEY) throw new Error('supabase env missing');
  const tables = [
    'tft_daily_comp_stats',
    'tft_player_marketvalue_snapshots',
    'tft_player_match_cache',
  ];
  // Schätzung über REST nicht direkt möglich → via RPC. Wir nutzen die
  // existierenden /rest/v1/<table>?select=count Endpoints mit dem
  // `count=estimated` Prefer-Header — PostgREST liest dann reltuples statt
  // COUNT(*). 100x schneller auf großen Tabellen.
  const counts: Record<string, { estimated: number | null; today: number | null }> = {};
  await Promise.all(tables.map(async tbl => {
    let estimated: number | null = null;
    let today: number | null = null;
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
    // Today: nur Tabellen mit `day` Column.
    if (tbl !== 'tft_player_match_cache') {
      try {
        const todayIso = new Date().toISOString().slice(0, 10);
        const dayCol = tbl === 'tft_player_marketvalue_snapshots' ? 'snapshot_date' : 'day';
        const res = await fetchWithTimeout(
          `${SUPA_URL}/rest/v1/${tbl}?select=*&limit=0&${dayCol}=eq.${todayIso}`,
          { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'count=exact' } },
        );
        const range = res.headers.get('content-range');
        if (range) {
          const m = /\/(\d+)$/.exec(range);
          if (m) today = parseInt(m[1], 10);
        }
      } catch { /* leave null */ }
    }
    counts[tbl] = { estimated, today };
  }));
  return { counts, fetchedAt: new Date().toISOString() };
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
  // Slice-Param: 'all' | 'services' | 'db' | 'manifest'. Erlaubt dem Client
  // multi-tier Polling (Services 10s, DB 60s, Manifest 120s) ohne separate
  // Endpoints zu pflegen.
  const slice = req.nextUrl.searchParams.get('slice') || 'all';
  const want = (k: string) => slice === 'all' || slice === k;

  const [servicesRes, dbRes, manifestRes] = await Promise.allSettled([
    want('services') ? fetchServices() : Promise.resolve(null),
    want('db') ? fetchDbCounts() : Promise.resolve(null),
    want('manifest') ? fetchManifest() : Promise.resolve(null),
  ]);

  const payload = {
    fetchedAt: new Date().toISOString(),
    services: servicesRes.status === 'fulfilled' ? servicesRes.value : null,
    db: dbRes.status === 'fulfilled' ? dbRes.value : null,
    manifest: manifestRes.status === 'fulfilled' ? manifestRes.value : null,
    errors: {
      services: servicesRes.status === 'rejected' ? String(servicesRes.reason?.message || servicesRes.reason) : null,
      db: dbRes.status === 'rejected' ? String(dbRes.reason?.message || dbRes.reason) : null,
      manifest: manifestRes.status === 'rejected' ? String(manifestRes.reason?.message || manifestRes.reason) : null,
    },
  };
  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';

// Multi-Tier-Polling-Intervalle wie vom Perf-Critic empfohlen. Schreibrate
// wird Client-side via localStorage gemerkt — kein Server-State nötig.
// Polling-Cadenz für die 3 Slices. Services-Tier von 10s auf 30s erhöht
// 2026-06-20 — Multi-Review-Verdict (perf-critic): bei 10s = 8.640 Invocations/
// Tag/Browser, bei 3 Tabs offen ~25k/Tag NICHT-User-Traffic. 30s reicht für
// Service-Health-Anzeige (oneshot-Status ändert sich nicht in 10s-Auflösung).
// Plus document.visibilityState-Check unten pausiert Polling bei verstecktem
// Tab → ~80% Invocations gespart vs. vorher.
const POLL_SERVICES_MS = 30_000;
const POLL_DB_MS = 60_000;
const POLL_MANIFEST_MS = 120_000;
// Riot-Status-Endpoint hat 5min In-Process-Cache — Client-Poll alle 60s
// trifft also höchstens 1× pro 5min den Origin. Visibility-gate teilt dasselbe
// Pattern wie die Ops-Polls weiter unten.
const POLL_RIOT_STATUS_MS = 60_000;

// =========================================================================
// Types
// =========================================================================

type ServiceStatus = 'healthy' | 'working' | 'stalled' | 'failed' | 'unknown';

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

interface DbCounts {
  counts: Record<string, { estimated: number | null; today: number | null }>;
  fetchedAt: string;
}

interface ManifestInfo {
  builtAt: string;
  entries: number;
  patches: { current: string; previous: string | null };
  fetchedAt: string;
}

interface Snapshot {
  fetchedAt: string;
  services: { services: ServiceView[]; fetchedAt: string } | null;
  db: DbCounts | null;
  manifest: ManifestInfo | null;
  errors: { services: string | null; db: string | null; manifest: string | null };
}

// =========================================================================
// Status → Farbe
// =========================================================================

const STATUS_COLOR: Record<ServiceStatus, string> = {
  healthy: '#22c55e',
  working: '#facc15',
  stalled: '#f97316',
  failed:  '#ef4444',
  unknown: '#6b7280',
};

const STATUS_LABEL: Record<ServiceStatus, string> = {
  healthy: 'Gesund',
  working: 'Arbeitet',
  stalled: 'Verzögert',
  failed:  'Fehler',
  unknown: 'Unbekannt',
};

// =========================================================================
// Node-Beschreibungen — was tut jede Komponente in der Pipeline
// =========================================================================

const SERVICE_DESCRIPTIONS: Record<string, string> = {
  'metastats-refresh-api.service':
    'Persistenter HTTP-Server auf Port 4100. Bedient den /refresh-player-Button (Profil + Marktwert on-demand aktualisieren), liest Match-Cache + DB-Counts für das Ops-Dashboard.',
  'metastats-daily-crawl.service':
    'Daily-Aggregat-Crawler. Läuft 00:00 UTC, geht durch alle 17 Regionen, schreibt Daily-Stats in tft_daily_*_stats. Dauer typisch 9-12h. Kettet OnSuccess den Catchup + Snapshot-Publisher.',
  'metastats-snapshot-publisher.service':
    'Rendert nach jedem Daily-Crawl die Hot-Path-Permutationen aller Stats-APIs als statische JSON-Blobs nach Vercel-Blob. ~3 min Lauf, ~200 Snapshots. Ergebnis löst den ~1s-Cold-Start in /tft/* ab.',
  'metastats-daily-crawl-catchup.service':
    'Sicherheits-Hook. Wenn der Daily-Crawl Mitternacht überquert (>24h Lauf), wäre der nächste Tages-Trigger geschluckt — dieser Service detektiert das und startet sofort einen Nachhol-Lauf.',
  'metastats-companion-backfill.service':
    'Alle 10 Minuten. Verknüpft Overwolf-Companion-Position-Daten (LIVE_xxx synth-IDs) mit den echten Riot-Match-IDs sobald die Match in Match-V1 erscheint.',
  'metastats-position-aggregator.service':
    'Alle 15 Minuten. Aggregiert tft_position_observations zu tft_position_comp_cell für die Position-Heatmaps in den Comp-Detail-Pages.',
  'metastats-build-check.service':
    'Periodischer Smoke-Check der Crawler-Box (Node-Version, Disk-Space, env-File-Existenz). Reine Diagnose, schreibt nichts in die Pipeline.',
  'metastats-health.service':
    'Self-Health-Endpoint des Refresh-API-Servers. Periodischer Self-Test damit ein hängender Server-Prozess früh erkannt wird.',
  'metastats-tft-pro-validator.service':
    'Nightly. Validiert die Pro-Player-Accounts in public/pro-players.json gegen die 4 Quellen (trackingthepros, lolpros, op.gg, Riot-API). Markiert Roster-Wechsel.',
  'metastats-tft-pro-fullsync.service':
    'Freitags. Vollständiger Re-Crawl der Pro-Player-Datenbank aus Liquipedia + Cross-Validation. Updated tft_pro_players + Roster.',
  'metastats-tft-pro-tpc-roster.service':
    'Freitags. Crawlt competetft.com (TPC = TFT Pro Circuit) für offizielle Riot-Roster-Updates der Pro-Teams.',
  'metastats-tft-pro-classify.service':
    'Nightly. Klassifiziert TFT-Pro-Player nach Region + Sub-Region + Liga-Aktivität. Output speist die /tft/pros Page.',
  'metastats-crawler.service':
    'Legacy Marketvalue-Vollsweep. Seit 2026-06-16 deaktiviert (Timer masked, OnSuccess raus). Bleibt für ggf. manuellen Adhoc-Debug, sollte nicht automatisch starten.',
  'metastats-lol-marketvalue.service':
    'LoL-Marktwert-Crawler. Wird nur nach Riot-Dev-Key-Rotation getriggert (refresh-riot-key.mjs), kein Timer.',
};

const TABLE_DESCRIPTIONS: Record<string, string> = {
  'tft_daily_comp_stats':
    'Tägliche Aggregat-Stats pro Comp-Cluster × Region × Bucket × Patch. Geschrieben vom Daily-Crawl, gelesen von /api/tft/comps. Inkl. typical_units, carry_items, death-round-Histogramm, Skill-Cap-Buckets.',
  'tft_player_marketvalue_snapshots':
    'Daily-Snapshots der Marktwerte aller D2+-Spieler. Pro puuid × region × snapshot_date eine Zeile. Skill-Score-Multiplier × Base-Value = final_value. Snapshot-First, kein Live-Calc.',
  'tft_player_match_cache':
    'Per-Spieler Match-Cache (35 GB Volume-Tablespace). Quelle für Match-History, Pro-Specialty, Coach-Analyse. Wird vom Refresh-API + Marketvalue-Crawler gefüllt. Liegt auf Hetzner-PG, nicht Supabase.',
};

const API_DESCRIPTIONS: Record<string, string> = {
  'comps':
    '/api/tft/comps — Comp-Listing mit avgPlace, top4, pickRate, typical_units, carry_items. Patch-übergreifend aggregiert seit 2026-06-16. minGames skaliert 70×days.',
  'units':
    '/api/tft/units — Champion-Stats nach character_id. Top-Items by Tier, Damage-Atlas, Item-Slot-Order auf den Detail-Pages.',
  'items':
    '/api/tft/items — Item-Stats inkl. top_users (Carrier). Lean-RPC merged Carriers in SQL statt jsonb_agg → ~14x schneller.',
  'traits':
    '/api/tft/traits — Trait-Aktivierungs-Stats nach name + activation-level. Skalar-only, kein jsonb-Merging.',
};

function describeNode(node: NodeData): string {
  if (node.id.startsWith('svc:')) {
    return SERVICE_DESCRIPTIONS[node.serviceName || ''] || 'Hetzner-Service, keine Beschreibung hinterlegt.';
  }
  if (node.id.startsWith('db:')) {
    const tbl = node.id.replace('db:', '');
    return TABLE_DESCRIPTIONS[tbl] || 'Supabase-Tabelle, keine Beschreibung hinterlegt.';
  }
  if (node.id === 'blob:manifest') {
    return 'Snapshot-Bundle auf Vercel-Blob. Manifest listet alle vorgerenderten JSON-Permutationen mit Build-Zeit. Der Snapshot-Publisher schreibt es nach jedem Daily-Crawl neu — die API-Routes lesen es zuerst, fallen erst bei Miss auf Live-RPC.';
  }
  if (node.id.startsWith('api:')) {
    return API_DESCRIPTIONS[node.id.replace('api:', '')] || 'API-Route, keine Beschreibung hinterlegt.';
  }
  if (node.id === 'user') {
    return 'Endpoint der Pipeline. Browser-Requests auf metastats.gg landen über Vercel-Edge bei den API-Routes — die meisten Hits bekommen einen Snapshot-Treffer und antworten unter 300 ms.';
  }
  return 'Keine Beschreibung verfügbar.';
}

// =========================================================================
// Polling Hook — multi-tier per slice, mergt in einen Snapshot
// =========================================================================

function useOpsSnapshot(): { snap: Snapshot | null; lastUpdate: Date | null } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function pull(slice: 'services' | 'db' | 'manifest' | 'all') {
      // Visibility-Gate: bei verstecktem Tab keine Polls feuern. Spart bei
      // im-Hintergrund-laufenden Dashboards ~100% der Invocations.
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`/api/internal/ops-snapshot?slice=${slice}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data: Snapshot = await res.json();
        if (!alive) return;
        setSnap(prev => prev ? {
          ...prev,
          fetchedAt: data.fetchedAt,
          services: data.services ?? prev.services,
          db: data.db ?? prev.db,
          manifest: data.manifest ?? prev.manifest,
          errors: { ...prev.errors, ...data.errors },
        } : data);
        setLastUpdate(new Date(data.fetchedAt));
      } catch { /* swallow */ }
    }
    pull('all');
    const tServices = setInterval(() => pull('services'), POLL_SERVICES_MS);
    const tDb = setInterval(() => pull('db'), POLL_DB_MS);
    const tManifest = setInterval(() => pull('manifest'), POLL_MANIFEST_MS);

    // Bei Tab-visible-again sofort einmal frisch ziehen — User soll nicht
    // 30s auf den ersten Update warten nach Tab-Switch.
    function onVisibilityChange() {
      if (typeof document !== 'undefined' && !document.hidden) {
        pull('all');
      }
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      alive = false;
      clearInterval(tServices); clearInterval(tDb); clearInterval(tManifest);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, []);

  return { snap, lastUpdate };
}

// =========================================================================
// Riot-Status (TFT-Platform-Status pro Region)
// =========================================================================

type RiotSeverity = 'info' | 'warning' | 'critical';
type RiotRegionStatus = 'ok' | RiotSeverity | 'unknown';

interface RiotRegionEntry {
  region: string;
  status: RiotRegionStatus;
  activeIncidents: number;
  activeMaintenances: number;
  worstSeverity: RiotSeverity | null;
  summary: string | null;
  error?: string;
}

interface RiotStatusPayload {
  cachedAt: string;
  regions: RiotRegionEntry[];
}

const RIOT_SEVERITY_RANK: Record<RiotSeverity, number> = { info: 1, warning: 2, critical: 3 };
const RIOT_SEVERITY_COLOR: Record<RiotSeverity, string> = {
  info: '#3b82f6',
  warning: '#f97316',
  critical: '#ef4444',
};
const RIOT_SEVERITY_LABEL: Record<RiotSeverity, string> = {
  info: 'Info',
  warning: 'Warnung',
  critical: 'Kritisch',
};

function useRiotStatus(): RiotStatusPayload | null {
  const [data, setData] = useState<RiotStatusPayload | null>(null);
  useEffect(() => {
    let alive = true;
    async function pull() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch('/api/internal/riot-status', { cache: 'no-store' });
        if (!res.ok) return;
        const json = await res.json() as RiotStatusPayload;
        if (!alive) return;
        setData(json);
      } catch { /* swallow */ }
    }
    pull();
    const t = setInterval(pull, POLL_RIOT_STATUS_MS);
    function onVisibilityChange() {
      if (typeof document !== 'undefined' && !document.hidden) pull();
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }
    return () => {
      alive = false;
      clearInterval(t);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }, []);
  return data;
}

function summarizeRiotStatus(payload: RiotStatusPayload | null): {
  worstSeverity: RiotSeverity | null;
  affectedRegions: RiotRegionEntry[];
  unknownRegions: RiotRegionEntry[];
  hasAnything: boolean;
} {
  if (!payload) return { worstSeverity: null, affectedRegions: [], unknownRegions: [], hasAnything: false };
  const affected = payload.regions.filter(r => r.worstSeverity != null || r.activeIncidents > 0 || r.activeMaintenances > 0);
  const unknown = payload.regions.filter(r => r.status === 'unknown');
  let worst: RiotSeverity | null = null;
  for (const r of affected) {
    if (!r.worstSeverity) continue;
    if (!worst || RIOT_SEVERITY_RANK[r.worstSeverity] > RIOT_SEVERITY_RANK[worst]) {
      worst = r.worstSeverity;
    }
  }
  return {
    worstSeverity: worst,
    affectedRegions: affected,
    unknownRegions: unknown,
    hasAnything: affected.length > 0 || unknown.length > 0,
  };
}

function RiotStatusBanner({ payload }: { payload: RiotStatusPayload | null }) {
  const [expanded, setExpanded] = useState(false);
  const { worstSeverity, affectedRegions, unknownRegions, hasAnything } = useMemo(
    () => summarizeRiotStatus(payload),
    [payload],
  );
  // Stiller Mode: kein Banner wenn alles ok / nichts zu zeigen. Vermeidet
  // permanente „alles OK" Info-Texte (siehe feedback_no_info_texts).
  if (!hasAnything) return null;

  const accentColor = worstSeverity ? RIOT_SEVERITY_COLOR[worstSeverity] : '#6b7280';
  const headline = worstSeverity
    ? `Riot: ${RIOT_SEVERITY_LABEL[worstSeverity]} in ${affectedRegions.length} Region${affectedRegions.length === 1 ? '' : 'en'}`
    : `Riot-Status: ${unknownRegions.length} Region${unknownRegions.length === 1 ? '' : 'en'} nicht erreichbar`;

  return (
    <div
      className="bg-surface-base/95 backdrop-blur border rounded px-2.5 py-1.5 cursor-pointer hover:bg-[#11192a] transition-colors"
      style={{ borderColor: accentColor }}
      onClick={() => setExpanded(e => !e)}
    >
      <div className="flex items-center gap-2 text-xs">
        <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: accentColor }} />
        <span style={{ color: accentColor }}>{headline}</span>
        <span className="text-gray-500 text-[10px] ml-auto">{expanded ? '▴' : '▾'}</span>
      </div>
      {expanded && (
        <div className="mt-2 pt-2 border-t border-border-subtle space-y-1 text-[11px] max-h-64 overflow-y-auto">
          {affectedRegions.map(r => (
            <div key={r.region} className="flex items-start gap-2">
              <span
                className="inline-block w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0"
                style={{ backgroundColor: r.worstSeverity ? RIOT_SEVERITY_COLOR[r.worstSeverity] : '#6b7280' }}
              />
              <div className="min-w-0">
                <div className="font-mono text-gray-300">
                  {r.region}
                  <span className="text-gray-500 ml-2">
                    {r.activeIncidents > 0 && `${r.activeIncidents} Incident${r.activeIncidents === 1 ? '' : 's'}`}
                    {r.activeIncidents > 0 && r.activeMaintenances > 0 && ' · '}
                    {r.activeMaintenances > 0 && `${r.activeMaintenances} Wartung${r.activeMaintenances === 1 ? '' : 'en'}`}
                  </span>
                </div>
                {r.summary && <div className="text-gray-400 leading-snug">{r.summary}</div>}
              </div>
            </div>
          ))}
          {unknownRegions.length > 0 && (
            <div className="text-gray-500 pt-1 border-t border-border-subtle/50">
              {unknownRegions.length} nicht erreichbar: {unknownRegions.map(r => r.region).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Schreibrate (client-side Δ via localStorage, negative Werte → 0)
// =========================================================================

interface RateState {
  rows: number;
  ts: number;
}
function loadPrev(table: string): RateState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`ops:rate:${table}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function savePrev(table: string, state: RateState) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(`ops:rate:${table}`, JSON.stringify(state)); } catch { /* quota */ }
}
function ratePerSec(table: string, current: number | null): number | null {
  if (current == null) return null;
  const prev = loadPrev(table);
  const now = Date.now();
  savePrev(table, { rows: current, ts: now });
  if (!prev || prev.ts >= now) return null;
  const delta = current - prev.rows;
  if (delta <= 0) return 0;
  return delta / ((now - prev.ts) / 1000);
}

// =========================================================================
// Graph-Building
// =========================================================================

interface NodeData {
  id: string;
  label: string;
  layer: number;
  layerName: string;
  status: ServiceStatus;
  detail: string;
  rate: number | null;
  serviceName?: string;
  raw?: ServiceView | { estimated: number | null; today: number | null } | ManifestInfo | null;
}

type EdgeKind = 'write' | 'read' | 'serve' | 'request' | 'trigger';

interface EdgeData {
  from: string;
  to: string;
  color: string;
  active: boolean;
  kind: EdgeKind;
  label: string;
}

const EDGE_KIND_COLOR: Record<EdgeKind, string> = {
  write:   '#facc15', // Crawler schreibt in DB
  read:    '#3b82f6', // Publisher liest aus DB
  serve:   '#a855f7', // API liefert Snapshot
  request: '#ec4899', // User hittet API
  trigger: '#06b6d4', // Service triggert anderen Service
};

const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  write:   'schreibt nach',
  read:    'liest aus',
  serve:   'liefert an',
  request: 'fragt an',
  trigger: 'triggert',
};

const LAYER_NAMES = ['User', 'API', 'Snapshot', 'Datenbank', 'Crawler'];

function buildGraph(snap: Snapshot | null): { nodes: NodeData[]; edges: EdgeData[] } {
  if (!snap) return { nodes: [], edges: [] };
  const services = snap.services?.services || [];
  const counts = snap.db?.counts || {};
  const manifest = snap.manifest;

  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];

  // Layer 4 — Crawler-Services
  for (const s of services) {
    nodes.push({
      id: 'svc:' + s.name,
      serviceName: s.name,
      label: s.name.replace('metastats-', '').replace('.service', ''),
      layer: 4,
      layerName: LAYER_NAMES[4],
      status: s.status,
      detail: `${s.activeState}/${s.subState} · result=${s.result}` + (s.ageSinceLastRunMs ? ` · last ${humanAge(s.ageSinceLastRunMs)} ago` : ''),
      rate: null,
      raw: s,
    });
  }

  // Layer 3 — DB-Tabellen
  const tables = ['tft_daily_comp_stats', 'tft_player_marketvalue_snapshots', 'tft_player_match_cache'];
  for (const tbl of tables) {
    const c = counts[tbl];
    const rate = ratePerSec(tbl, c?.estimated ?? null);
    nodes.push({
      id: 'db:' + tbl,
      label: tbl.replace('tft_', ''),
      layer: 3,
      layerName: LAYER_NAMES[3],
      status: c?.estimated != null ? 'healthy' : 'unknown',
      detail: c?.estimated != null
        ? `${fmt(c.estimated)} rows total${c.today != null ? ` · ${fmt(c.today)} heute` : ''}`
        : 'no data',
      rate,
      raw: c,
    });
  }

  // Layer 2 — Snapshot-Bundle
  const manifestAge = manifest ? Date.now() - new Date(manifest.builtAt).getTime() : null;
  const manifestStatus: ServiceStatus = manifest
    ? manifestAge! < 26 * 3600_000 ? 'healthy' : manifestAge! < 50 * 3600_000 ? 'stalled' : 'failed'
    : 'unknown';
  nodes.push({
    id: 'blob:manifest',
    label: 'snapshot-bundle',
    layer: 2,
    layerName: LAYER_NAMES[2],
    status: manifestStatus,
    detail: manifest ? `${manifest.entries} entries · built ${humanAge(manifestAge!)} ago` : 'no manifest',
    rate: null,
    raw: manifest,
  });

  // Layer 1 — API-Endpoints
  const apis = ['comps', 'units', 'items', 'traits'];
  for (const a of apis) {
    nodes.push({
      id: 'api:' + a,
      label: `/api/tft/${a}`,
      layer: 1,
      layerName: LAYER_NAMES[1],
      status: 'healthy',
      detail: 'serves from snapshot bundle',
      rate: null,
    });
  }

  // Layer 0 — User
  nodes.push({ id: 'user', label: 'User', layer: 0, layerName: LAYER_NAMES[0], status: 'healthy', detail: 'you', rate: null });

  // ----- Edges: echte Pipeline-Abhängigkeiten -----
  // Helper, ergänzt eine Edge nur wenn beide Endpoints existieren.
  const nodeIds = new Set(nodes.map(n => n.id));
  const addEdge = (from: string, to: string, kind: EdgeKind, active: boolean) => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    edges.push({ from, to, color: EDGE_KIND_COLOR[kind], active, kind, label: EDGE_KIND_LABEL[kind] });
  };
  const svcStatus = (name: string) =>
    services.find(s => s.name === name)?.status || 'unknown';
  const svcWorking = (name: string) => svcStatus(name) === 'working';

  // Crawler-Services WRITE in DB-Tabellen
  // daily-crawl schreibt alle 3 Daily-Aggregat-Tabellen (wir haben nur die comp-Tabelle im Graph,
  // die anderen kommen mit V2 dazu).
  addEdge('svc:metastats-daily-crawl.service', 'db:tft_daily_comp_stats', 'write',
    svcWorking('metastats-daily-crawl.service'));
  // refresh-api schreibt on-demand in Match-Cache + Marketvalue-Snapshots
  addEdge('svc:metastats-refresh-api.service', 'db:tft_player_match_cache', 'write', false);
  addEdge('svc:metastats-refresh-api.service', 'db:tft_player_marketvalue_snapshots', 'write', false);
  // crawler (Legacy-Marketvalue-Vollsweep) schreibt auch dorthin — nur aktiv wenn manuell getriggert
  addEdge('svc:metastats-crawler.service', 'db:tft_player_match_cache', 'write',
    svcWorking('metastats-crawler.service'));
  addEdge('svc:metastats-crawler.service', 'db:tft_player_marketvalue_snapshots', 'write',
    svcWorking('metastats-crawler.service'));
  // companion-backfill verknüpft Companion-IDs mit echten Match-IDs im Cache
  addEdge('svc:metastats-companion-backfill.service', 'db:tft_player_match_cache', 'write',
    svcWorking('metastats-companion-backfill.service'));

  // Publisher READS aus DB (über die Live-API), schreibt nach Blob
  addEdge('db:tft_daily_comp_stats', 'svc:metastats-snapshot-publisher.service', 'read',
    svcWorking('metastats-snapshot-publisher.service'));
  addEdge('svc:metastats-snapshot-publisher.service', 'blob:manifest', 'write',
    svcWorking('metastats-snapshot-publisher.service'));

  // Trigger-Edges: OnSuccess-Ketten
  addEdge('svc:metastats-daily-crawl.service', 'svc:metastats-snapshot-publisher.service', 'trigger', false);
  addEdge('svc:metastats-daily-crawl.service', 'svc:metastats-daily-crawl-catchup.service', 'trigger', false);

  // Snapshot-Bundle SERVES API-Routes
  for (const a of apis) {
    addEdge('blob:manifest', 'api:' + a, 'serve', !!manifest);
  }
  // API-Routes serve User (Read-Pfad für /tft/*)
  for (const a of apis) {
    addEdge('api:' + a, 'user', 'request', true);
  }
  // refresh-api serves User direkt (Refresh-Button-Pfad)
  addEdge('svc:metastats-refresh-api.service', 'user', 'request', true);

  return { nodes, edges };
}

// =========================================================================
// 3D Components
// =========================================================================

function positionFor(node: NodeData, idx: number, total: number): [number, number, number] {
  const layerSpacing = 4.5;
  const y = node.layer * layerSpacing - 9;
  const radius = node.layer === 0 ? 0 : 4.5 + node.layer * 0.6;
  const angle = (idx / Math.max(1, total)) * Math.PI * 2;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return [x, y, z];
}

// Animierter Status-Ring um den Kern — gibt Tiefe + Status-Coloring auch aus
// Entfernung gut sichtbar. Selektierte Nodes bekommen einen zweiten outer Ring.
function NodeMesh({ position, color, pulsing, label, selected, onClick }: {
  position: [number, number, number];
  color: string;
  pulsing: boolean;
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      const intensity = pulsing ? 1 + Math.sin(t * 3) * 0.25 : 1;
      haloRef.current.scale.setScalar(1.6 * intensity);
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = pulsing ? 0.18 + Math.sin(t * 3) * 0.08 : 0.10;
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.4;
      ringRef.current.lookAt(0, ringRef.current.parent!.position.y + 100, 100);
    }
    if (outerRingRef.current && selected) {
      outerRingRef.current.rotation.z = -t * 0.6;
    }
  });

  return (
    <group
      position={position}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onPointerOver={e => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={e => { document.body.style.cursor = ''; }}
    >
      {/* Glowing core */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={1.2}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      {/* Soft halo */}
      <mesh ref={haloRef}>
        <sphereGeometry args={[0.48, 24, 24]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
      </mesh>
      {/* Status-Ring (Torus, billboard-facing) */}
      <mesh ref={ringRef}>
        <torusGeometry args={[0.6, 0.04, 12, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} />
      </mesh>
      {/* Selection-Ring outer (nur wenn selected) */}
      {selected && (
        <mesh ref={outerRingRef}>
          <torusGeometry args={[0.95, 0.025, 12, 64]} />
          <meshBasicMaterial color={'#ffffff'} transparent opacity={0.85} />
        </mesh>
      )}
      <Html distanceFactor={11} position={[0, 0.85, 0]} center>
        <div className={`text-[10px] whitespace-nowrap select-none pointer-events-none font-medium ${selected ? 'text-white' : 'text-gray-300'}`}>
          {label}
        </div>
      </Html>
    </group>
  );
}

function FlowEdge({ from, to, color, active, highlighted, dimmed }: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  active: boolean;
  highlighted: boolean;
  dimmed: boolean;
}) {
  const particleRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!particleRef.current || (!active && !highlighted)) return;
    const t = (clock.getElapsedTime() * 0.3) % 1;
    particleRef.current.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    );
  });
  // Highlight zeigt Selection, dimmed sind alle übrigen wenn etwas selektiert ist
  const opacity = highlighted ? 0.85 : dimmed ? 0.05 : 0.25;
  const lineWidth = highlighted ? 2 : 1;
  const showParticle = active || highlighted;
  return (
    <>
      <Line points={[from, to]} color={color} lineWidth={lineWidth} opacity={opacity} transparent />
      {showParticle && (
        <mesh ref={particleRef}>
          <sphereGeometry args={[highlighted ? 0.11 : 0.09, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </>
  );
}

function Scene({ snap, selectedId, onSelect }: {
  snap: Snapshot | null;
  selectedId: string | null;
  onSelect: (n: NodeData | null) => void;
}) {
  const graph = useMemo(() => buildGraph(snap), [snap]);
  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    const byLayer: Record<number, NodeData[]> = {};
    for (const n of graph.nodes) {
      (byLayer[n.layer] ||= []).push(n);
    }
    for (const nodes of Object.values(byLayer)) {
      nodes.forEach((n, i) => map.set(n.id, positionFor(n, i, nodes.length)));
    }
    return map;
  }, [graph.nodes]);

  return (
    <>
      <color attach="background" args={['#050810']} />
      <fog attach="fog" args={['#050810', 16, 50]} />
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={0.8} color="#ffffff" />
      <pointLight position={[-10, -5, -10]} intensity={0.6} color="#7B61FF" />
      <pointLight position={[0, 0, 8]} intensity={0.4} color="#22c55e" />

      {/* Klick auf leere Fläche: Selektion clearen */}
      <mesh position={[0, 0, -10]} onClick={() => onSelect(null)}>
        <planeGeometry args={[200, 200]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {graph.nodes.map(n => {
        const pos = positions.get(n.id);
        if (!pos) return null;
        return (
          <NodeMesh
            key={n.id}
            position={pos}
            color={STATUS_COLOR[n.status]}
            pulsing={n.status === 'working' || (n.rate ?? 0) > 0.5}
            label={n.label}
            selected={selectedId === n.id}
            onClick={() => onSelect(n)}
          />
        );
      })}

      {graph.edges.map((e, i) => {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return null;
        const touchesSelected = selectedId !== null && (e.from === selectedId || e.to === selectedId);
        const highlighted = touchesSelected;
        const dimmed = selectedId !== null && !touchesSelected;
        return (
          <FlowEdge
            key={i}
            from={from}
            to={to}
            color={e.color}
            active={e.active}
            highlighted={highlighted}
            dimmed={dimmed}
          />
        );
      })}

      <OrbitControls enablePan zoomSpeed={0.8} />
    </>
  );
}

// =========================================================================
// UI Shell
// =========================================================================

function humanAge(ms: number): string {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d`;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// Sammelt die direkten Abhängigkeiten eines Nodes — ein/ausgehend, nach Edge-Typ.
function dependenciesFor(nodeId: string, edges: EdgeData[], nodes: NodeData[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = { write: [] as NodeData[], read: [] as NodeData[], serve: [] as NodeData[], trigger: [] as NodeData[], request: [] as NodeData[] };
  const in_ = { write: [] as NodeData[], read: [] as NodeData[], serve: [] as NodeData[], trigger: [] as NodeData[], request: [] as NodeData[] };
  for (const e of edges) {
    if (e.from === nodeId) {
      const other = byId.get(e.to);
      if (other) out[e.kind].push(other);
    } else if (e.to === nodeId) {
      const other = byId.get(e.from);
      if (other) in_[e.kind].push(other);
    }
  }
  return { out, in: in_ };
}

function DependenciesList({ deps, onSelectNode }: {
  deps: ReturnType<typeof dependenciesFor>;
  onSelectNode: (id: string) => void;
}) {
  const sections: Array<{ heading: string; items: NodeData[]; color: string }> = [
    // Outgoing
    { heading: 'Schreibt nach', items: deps.out.write, color: EDGE_KIND_COLOR.write },
    { heading: 'Liest aus', items: deps.out.read, color: EDGE_KIND_COLOR.read },
    { heading: 'Liefert an', items: deps.out.serve, color: EDGE_KIND_COLOR.serve },
    { heading: 'Triggert', items: deps.out.trigger, color: EDGE_KIND_COLOR.trigger },
    { heading: 'Bedient', items: deps.out.request, color: EDGE_KIND_COLOR.request },
    // Incoming
    { heading: 'Wird beschrieben von', items: deps.in.write, color: EDGE_KIND_COLOR.write },
    { heading: 'Wird gelesen von', items: deps.in.read, color: EDGE_KIND_COLOR.read },
    { heading: 'Wird beliefert von', items: deps.in.serve, color: EDGE_KIND_COLOR.serve },
    { heading: 'Wird getriggert von', items: deps.in.trigger, color: EDGE_KIND_COLOR.trigger },
    { heading: 'Wird angefragt von', items: deps.in.request, color: EDGE_KIND_COLOR.request },
  ];
  const visible = sections.filter(s => s.items.length > 0);
  if (visible.length === 0) {
    return <div className="text-[11px] text-gray-500 italic">Keine direkten Abhängigkeiten</div>;
  }
  return (
    <div className="space-y-2">
      {visible.map(section => (
        <div key={section.heading}>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: section.color }} />
            <div className="text-[10px] uppercase tracking-wider text-gray-500">{section.heading}</div>
          </div>
          <div className="flex flex-wrap gap-1">
            {section.items.map(n => (
              <button
                key={n.id}
                onClick={() => onSelectNode(n.id)}
                className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay hover:bg-[#2a3a52] text-gray-300 hover:text-white transition-colors"
                title={n.layerName}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function NodeDetailPanel({ node, edges, nodes, onClose, onSelectNode }: {
  node: NodeData;
  edges: EdgeData[];
  nodes: NodeData[];
  onClose: () => void;
  onSelectNode: (id: string) => void;
}) {
  const deps = useMemo(() => dependenciesFor(node.id, edges, nodes), [node.id, edges, nodes]);
  const description = describeNode(node);
  const raw = node.raw as any;
  return (
    <div className="absolute top-3 right-3 z-20 w-[min(380px,calc(100vw-24px))] bg-surface-base/95 backdrop-blur border border-border-subtle rounded-lg p-4 shadow-2xl text-sm space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wider text-gray-500">{node.layerName}</div>
          <div className="font-semibold text-white truncate">{node.label}</div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-white transition-colors flex-shrink-0"
          aria-label="Schließen"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: STATUS_COLOR[node.status] }}
        />
        <span className="text-xs" style={{ color: STATUS_COLOR[node.status] }}>
          {STATUS_LABEL[node.status]}
        </span>
        <span className="text-gray-600 text-xs">·</span>
        <span className="text-gray-400 text-xs truncate">{node.detail}</span>
      </div>

      <div className="text-xs text-gray-300 leading-relaxed">
        {description}
      </div>

      {/* Live-Daten je nach Node-Typ */}
      {node.id.startsWith('svc:') && raw && (
        <div className="pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-[11px]">
          <div className="text-gray-500">ActiveState</div>
          <div className="text-gray-300 font-mono">{raw.activeState}</div>
          <div className="text-gray-500">SubState</div>
          <div className="text-gray-300 font-mono">{raw.subState}</div>
          <div className="text-gray-500">Result</div>
          <div className="text-gray-300 font-mono">{raw.result}</div>
          {raw.kind && (<>
            <div className="text-gray-500">Typ</div>
            <div className="text-gray-300 font-mono">{raw.kind}</div>
          </>)}
          {raw.lastRunStart && (<>
            <div className="text-gray-500">Letzter Start</div>
            <div className="text-gray-300 font-mono">{new Date(raw.lastRunStart).toLocaleString('de-DE')}</div>
          </>)}
          {raw.lastRunEnd && (<>
            <div className="text-gray-500">Letztes Ende</div>
            <div className="text-gray-300 font-mono">{new Date(raw.lastRunEnd).toLocaleString('de-DE')}</div>
          </>)}
          {raw.ageSinceLastRunMs && (<>
            <div className="text-gray-500">Seitdem</div>
            <div className="text-gray-300 font-mono">{humanAge(raw.ageSinceLastRunMs)}</div>
          </>)}
          {raw.expectedMaxAgeMs && (<>
            <div className="text-gray-500">Erwartete Cadence</div>
            <div className="text-gray-300 font-mono">≤ {humanAge(raw.expectedMaxAgeMs)}</div>
          </>)}
        </div>
      )}

      {node.id.startsWith('db:') && raw && (
        <div className="pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-[11px]">
          <div className="text-gray-500">Rows (estimated)</div>
          <div className="text-gray-300 font-mono">{raw.estimated != null ? fmt(raw.estimated) : '—'}</div>
          <div className="text-gray-500">Heute geschrieben</div>
          <div className="text-gray-300 font-mono">{raw.today != null ? fmt(raw.today) : '—'}</div>
          <div className="text-gray-500">Schreibrate</div>
          <div className="text-gray-300 font-mono">{node.rate != null ? `${node.rate.toFixed(1)}/s` : '—'}</div>
        </div>
      )}

      {node.id === 'blob:manifest' && raw && (
        <div className="pt-2 border-t border-border-subtle grid grid-cols-2 gap-2 text-[11px]">
          <div className="text-gray-500">Built</div>
          <div className="text-gray-300 font-mono">{new Date(raw.builtAt).toLocaleString('de-DE')}</div>
          <div className="text-gray-500">Entries</div>
          <div className="text-gray-300 font-mono">{raw.entries}</div>
          <div className="text-gray-500">Aktueller Patch</div>
          <div className="text-gray-300 font-mono">{raw.patches?.current ?? '—'}</div>
          <div className="text-gray-500">Voriger Patch</div>
          <div className="text-gray-300 font-mono">{raw.patches?.previous ?? '—'}</div>
        </div>
      )}

      <div className="pt-2 border-t border-border-subtle">
        <DependenciesList deps={deps} onSelectNode={onSelectNode} />
      </div>
    </div>
  );
}

export default function OpsGraph() {
  const { snap, lastUpdate } = useOpsSnapshot();
  const riotStatus = useRiotStatus();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graph = useMemo(() => buildGraph(snap), [snap]);
  const selectedNode = useMemo(
    () => (selectedId ? graph.nodes.find(n => n.id === selectedId) || null : null),
    [graph, selectedId],
  );

  const errs = snap?.errors;
  const hasErrors = !!(errs?.services || errs?.db || errs?.manifest);

  return (
    <div className="min-h-screen bg-[#050810] text-gray-200 relative overflow-hidden">
      <div className="absolute top-3 left-3 z-10 text-xs space-y-1 max-w-[min(420px,calc(100vw-24px))]">
        <div className="font-semibold tracking-wide text-white">metastats / ops</div>
        <div className="text-gray-500">
          {lastUpdate ? `aktualisiert vor ${humanAge(Date.now() - lastUpdate.getTime())}` : 'lade…'}
        </div>
        <RiotStatusBanner payload={riotStatus} />
        {hasErrors && (
          <div className="text-red-400 mt-2 space-y-0.5">
            {errs?.services && <div>hetzner: {errs.services}</div>}
            {errs?.db && <div>db: {errs.db}</div>}
            {errs?.manifest && <div>blob: {errs.manifest}</div>}
          </div>
        )}
      </div>

      {selectedNode && (
        <NodeDetailPanel
          node={selectedNode}
          edges={graph.edges}
          nodes={graph.nodes}
          onClose={() => setSelectedId(null)}
          onSelectNode={(id) => setSelectedId(id)}
        />
      )}

      {/* Legende für Edge-Farben links unten */}
      <div className="absolute bottom-12 left-3 z-10 text-[10px] text-gray-500 space-y-1 pointer-events-none">
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.write }} />schreibt</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.read }} />liest</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.serve }} />liefert</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.trigger }} />triggert</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.request }} />wird angefragt</div>
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-10 flex justify-between text-[10px] text-gray-500 pointer-events-none">
        <div>L4 Crawler · L3 DB · L2 Snapshot · L1 API · L0 User</div>
        <div>poll services/10s · db/60s · blob/120s · klick für details</div>
      </div>

      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 0, 22], fov: 50 }} dpr={[1, 2]} frameloop="always">
          <Scene snap={snap} selectedId={selectedId} onSelect={n => setSelectedId(n?.id || null)} />
        </Canvas>
      </div>
    </div>
  );
}

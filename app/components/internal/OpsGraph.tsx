'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line } from '@react-three/drei';
import * as THREE from 'three';
// Die Schnittstellen-Karte wird aus dem Quelltext erzeugt (scripts/build-api-map.mjs)
// und beim Push gegen den Code geprueft. Sie wird hier eingebunden statt ueber
// die Ops-Route geholt: sie aendert sich nur mit einem Deploy, und die
// Ops-Route antwortet bewusst ohne Zwischenspeicher — sie muesste die 64 KB
// sonst bei jeder Abfrage im Minutentakt neu mitschicken.
//
// Die Seite laedt diese Komponente ohne Server-Rendering nach
// (app/internal/3d-ops/page.tsx:8), die Karte landet also nur im internen
// Bruchstueck des Bundles, nicht in dem der oeffentlichen Seiten.
import apiMap from '../../../infra/api-map.json';

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
  if (node.id.startsWith('grp:')) {
    return `Sammelknoten fuer alle Adressen unter /api/${node.group}. Klick klappt den Bereich auf und zeigt jede Adresse einzeln mit ihren eigenen Verbindungen.`;
  }
  if (node.id.startsWith('api:')) {
    const short = node.label.replace('/api/tft/', '').replace('/api/', '');
    return API_DESCRIPTIONS[short]
      || `Schnittstelle ${node.label}. Quelle: ${node.detail || 'unbekannt'}. Was sie liest, ruft und holt, steht unten in den Abhaengigkeiten — die Liste stammt aus infra/api-map.json und wird bei jedem Push gegen den Quelltext geprueft.`;
  }
  if (node.id.startsWith('fn:')) {
    return node.status === 'failed'
      ? 'Diese Datenbank-Funktion wird aufgerufen, steht aber in keiner Migration. Der Aufruf laeuft ins Leere.'
      : 'Funktion in der Datenbank. Sie rechnet die Auswertung direkt dort, statt Rohzeilen an die Seite zu schicken.';
  }
  if (node.id.startsWith('file:')) {
    return 'Datei, die mit dem Auslieferungspaket mitgeht (public/). Sie wird beim Bauen erzeugt oder von einem Crawler aktualisiert und braucht zur Laufzeit keine Datenbank.';
  }
  if (node.id.startsWith('ext:')) {
    return 'Quelle ausserhalb unserer Systeme. Faellt sie aus, fehlen genau die Daten, die von hier kommen — deshalb steht sie im Bild.';
  }
  if (node.id === 'box:hetzner') {
    return 'Der eigene Server. Er beherbergt die Crawler-Dienste, den Match-Zwischenspeicher und den Aktualisierungs-Server auf Port 4100, den einige Schnittstellen direkt anfragen.';
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
  kind: NodeKind;
  /** Nur bei Sammelknoten und den Adressen darin: der Bereichsname. */
  group?: string;
  serviceName?: string;
  raw?: ServiceView | { estimated: number | null; today: number | null } | ManifestInfo | null;
}

type EdgeKind = 'write' | 'read' | 'serve' | 'request' | 'trigger' | 'call' | 'fetch';

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
  call:    '#22d3ee', // Schnittstelle ruft eine Datenbank-Funktion auf
  fetch:   '#f97316', // Schnittstelle holt bei einer fremden Quelle
};

const EDGE_KIND_LABEL: Record<EdgeKind, string> = {
  write:   'schreibt nach',
  read:    'liest aus',
  serve:   'liefert an',
  request: 'fragt an',
  trigger: 'triggert',
  call:    'ruft auf',
  fetch:   'holt von',
};

// Von unten nach oben: was der Besucher sieht, ganz unten — die Quellen, aus
// denen es stammt, ganz oben.
const LAYER_NAMES = [
  'User',
  'Schnittstellen',
  'Snapshot + Dateien',
  'Datenbank-Funktionen',
  'Datenbank',
  'Crawler',
  'Fremde Quellen',
];
const L_USER = 0, L_API = 1, L_STORE = 2, L_FN = 3, L_DB = 4, L_SVC = 5, L_EXT = 6;

type NodeKind = 'user' | 'group' | 'route' | 'blob' | 'file' | 'rpc' | 'table' | 'service' | 'external' | 'box';

interface ApiMapNode {
  id: string;
  kind: string;
  label: string;
  group?: string;
  file?: string;
  via?: string[];
  declared?: boolean;
}
interface ApiMapEdge { from: string; to: string; kind: string; }
const MAP = apiMap as unknown as {
  counts: Record<string, number>;
  groups: Array<{ name: string; count: number }>;
  nodes: ApiMapNode[];
  edges: ApiMapEdge[];
  unresolved: Array<{ node: string; reason: string; count: number }>;
};

// Kanten-Art aus der Karte auf die Farben des Graphen uebersetzen.
const MAP_EDGE_KIND: Record<string, EdgeKind> = { reads: 'read', calls: 'call', fetches: 'fetch' };

// Ein Sammelknoten pro Bereich („tft/marktwert" statt acht einzelner Adressen).
// Ohne das stehen 73 Adressen auf einem Ring, der Platz fuer rund 26 hat —
// gemessen: Umfang 32 Einheiten bei 1,2 Einheiten Knotenbreite.
const groupId = (name: string) => `grp:${name}`;

/**
 * Auf welchen Knoten eine Karten-Adresse im Graphen zeigt: auf sich selbst,
 * wenn ihr Bereich aufgeklappt ist — sonst auf den Sammelknoten.
 */
function resolveApiId(id: string, expanded: Set<string>, byId: Map<string, ApiMapNode>): string {
  if (!id.startsWith('api:')) return id;
  const g = byId.get(id)?.group;
  if (!g) return id;
  return expanded.has(g) ? id : groupId(g);
}

function buildGraph(snap: Snapshot | null, expanded: Set<string>): { nodes: NodeData[]; edges: EdgeData[] } {
  // Kein `if (!snap) return []` mehr: der statische Teil (Schnittstellen,
  // Tabellen, Funktionen, Dateien, fremde Quellen) steht in der Karte und
  // braucht keine Live-Abfrage. Ohne diese Zeile war die Seite bis zur ersten
  // Antwort der Ops-Route eine leere schwarze Flaeche.
  const services = snap?.services?.services || [];
  const counts = snap?.db?.counts || {};
  const manifest = snap?.manifest ?? null;

  const nodes: NodeData[] = [];
  const edges: EdgeData[] = [];
  const mapById = new Map(MAP.nodes.map(n => [n.id, n]));

  // Layer 5 — die Box und die Dienste, die darauf laufen
  for (const s of services) {
    nodes.push({
      id: 'svc:' + s.name,
      kind: 'service',
      serviceName: s.name,
      label: s.name.replace('metastats-', '').replace('.service', ''),
      layer: L_SVC,
      layerName: LAYER_NAMES[L_SVC],
      status: s.status,
      detail: `${s.activeState}/${s.subState} · result=${s.result}` + (s.ageSinceLastRunMs ? ` · last ${humanAge(s.ageSinceLastRunMs)} ago` : ''),
      rate: null,
      raw: s,
    });
  }
  nodes.push({
    id: 'box:hetzner',
    kind: 'box',
    label: 'Hetzner-Box',
    layer: L_SVC,
    layerName: LAYER_NAMES[L_SVC],
    status: services.length ? 'healthy' : 'unknown',
    detail: services.length ? `${services.length} Dienste` : 'keine Live-Daten',
    rate: null,
  });

  // Layer 4 — alle Tabellen aus der Karte; drei davon haben Live-Zahlen
  for (const t of MAP.nodes.filter(n => n.kind === 'table')) {
    const tbl = t.label;
    const c = counts[tbl];
    const rate = ratePerSec(tbl, c?.estimated ?? null);
    nodes.push({
      id: t.id,
      kind: 'table',
      label: tbl.replace('tft_', ''),
      layer: L_DB,
      layerName: LAYER_NAMES[L_DB],
      status: c?.estimated != null ? 'healthy' : 'unknown',
      detail: c?.estimated != null
        ? `${fmt(c.estimated)} Zeilen${c.today != null ? ` · ${fmt(c.today)} heute` : ''}`
        : (t.declared ? 'keine Live-Zahl' : 'ohne Migration angelegt'),
      rate,
      raw: c ?? null,
    });
  }

  // Layer 3 — Datenbank-Funktionen
  for (const f of MAP.nodes.filter(n => n.kind === 'rpc')) {
    nodes.push({
      id: f.id,
      kind: 'rpc',
      label: f.label.replace(/^get_/, ''),
      layer: L_FN,
      layerName: LAYER_NAMES[L_FN],
      status: f.declared ? 'healthy' : 'failed',
      detail: f.declared ? 'in einer Migration angelegt' : 'in keiner Migration — Aufruf laeuft ins Leere',
      rate: null,
    });
  }

  // Layer 2 — Snapshot-Bundle + die mitgelieferten Dateien
  const manifestAge = manifest ? Date.now() - new Date(manifest.builtAt).getTime() : null;
  const manifestStatus: ServiceStatus = manifest
    ? manifestAge! < 26 * 3600_000 ? 'healthy' : manifestAge! < 50 * 3600_000 ? 'stalled' : 'failed'
    : 'unknown';
  nodes.push({
    id: 'blob:manifest',
    kind: 'blob',
    label: 'snapshot-bundle',
    layer: L_STORE,
    layerName: LAYER_NAMES[L_STORE],
    status: manifestStatus,
    detail: manifest ? `${manifest.entries} Eintraege · gebaut vor ${humanAge(manifestAge!)}` : 'kein Manifest',
    rate: null,
    raw: manifest,
  });
  for (const f of MAP.nodes.filter(n => n.kind === 'file')) {
    nodes.push({
      id: f.id,
      kind: 'file',
      label: f.label.replace(/\.json$/, ''),
      layer: L_STORE,
      layerName: LAYER_NAMES[L_STORE],
      status: 'healthy',
      detail: 'liegt im Auslieferungspaket unter public/',
      rate: null,
    });
  }

  // Layer 1 — Schnittstellen: pro Bereich ein Sammelknoten, aufgeklappte
  // Bereiche zeigen ihre Adressen einzeln statt des Sammelknotens.
  for (const g of MAP.groups) {
    if (expanded.has(g.name)) continue;
    nodes.push({
      id: groupId(g.name),
      kind: 'group',
      group: g.name,
      label: `/${g.name}`,
      layer: L_API,
      layerName: LAYER_NAMES[L_API],
      status: 'healthy',
      detail: g.count === 1 ? '1 Adresse · klick zum Aufklappen' : `${g.count} Adressen · klick zum Aufklappen`,
      rate: null,
    });
  }
  for (const r of MAP.nodes.filter(n => n.kind === 'route')) {
    if (!r.group || !expanded.has(r.group)) continue;
    nodes.push({
      id: r.id,
      kind: 'route',
      group: r.group,
      label: r.label,
      layer: L_API,
      layerName: LAYER_NAMES[L_API],
      status: 'healthy',
      detail: r.file || '',
      rate: null,
    });
  }

  // Layer 6 — fremde Quellen
  for (const x of MAP.nodes.filter(n => n.kind === 'external')) {
    nodes.push({
      id: x.id,
      kind: 'external',
      label: x.label,
      layer: L_EXT,
      layerName: LAYER_NAMES[L_EXT],
      status: 'healthy',
      detail: 'Quelle ausserhalb unserer Systeme',
      rate: null,
    });
  }

  // Layer 0 — User
  nodes.push({
    id: 'user', kind: 'user', label: 'User', layer: L_USER, layerName: LAYER_NAMES[L_USER],
    status: 'healthy', detail: 'du', rate: null,
  });

  // ----- Kanten -----
  // Richtung ist immer Erzeuger → Verbraucher, also von oben nach unten zum
  // User. Die Beschriftungen im Detail-Fenster sind entsprechend gedreht
  // ("wird gelesen von" nach aussen, "liest aus" nach innen).
  const nodeIds = new Set(nodes.map(n => n.id));
  const seenEdges = new Set<string>();
  const addEdge = (from: string, to: string, kind: EdgeKind, active: boolean) => {
    if (from === to || !nodeIds.has(from) || !nodeIds.has(to)) return;
    const key = `${from}|${to}|${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from, to, color: EDGE_KIND_COLOR[kind], active, kind, label: EDGE_KIND_LABEL[kind] });
  };
  const svcStatus = (name: string) =>
    services.find(s => s.name === name)?.status || 'unknown';
  const svcWorking = (name: string) => svcStatus(name) === 'working';

  // Kanten aus der Karte. Mehrere Adressen desselben Bereichs, die dieselbe
  // Tabelle lesen, werden im zugeklappten Zustand zu einer Linie — sonst
  // laegen bis zu acht Linien exakt uebereinander.
  for (const e of MAP.edges) {
    const consumer = resolveApiId(e.from, expanded, mapById);
    const target = mapById.get(e.to);
    if (!target) continue;
    const kind: EdgeKind = target.kind === 'file' || target.kind === 'blob'
      ? 'serve'
      : (MAP_EDGE_KIND[e.kind] || 'read');
    addEdge(e.to, consumer, kind, false);
  }
  // Jede Schnittstelle bedient am Ende den Besucher. Der Laufpunkt auf dieser
  // Linie bleibt den Sammelknoten vorbehalten — bei 73 einzeln aufgeklappten
  // Adressen waeren 73 gleichzeitig laufende Punkte nur noch Flimmern.
  for (const n of nodes) {
    if (n.layer === L_API) addEdge(n.id, 'user', 'request', n.kind === 'group');
  }

  // Crawler-Services WRITE in DB-Tabellen.
  // Jede dieser Linien ist eine Behauptung ueber echtes Schreiben und steht
  // deshalb nur da, wenn sie im Skript hinter dem ExecStart nachweisbar ist.
  // daily-crawl: die upsertRows()-Aufrufe in scripts/lib/tft-supabase-writer.mjs.
  // tft_daily_augment_stats wird dort ebenfalls geschrieben, ist aber kein
  // Knoten (keine Route liest sie) — addEdge verwirft die Kante still, das ist
  // richtig so. tft_player_marketvalue_snapshots steht NICHT hier: der
  // Daily-Crawl fasst die Tabelle nur zum Aufraeumen an (MAINTENANCE_TABLES),
  // geschrieben wird sie vom Marktwert-Lauf.
  for (const t of ['tft_daily_comp_stats', 'tft_daily_unit_stats', 'tft_daily_item_stats',
    'tft_daily_trait_stats', 'tft_daily_trait_unitcount_stats', 'tft_daily_comp_pairs',
    'tft_daily_crawl_meta']) {
    addEdge('svc:metastats-daily-crawl.service', `db:${t}`, 'write',
      svcWorking('metastats-daily-crawl.service'));
  }
  // marketvalue-snapshot: der taegliche Marktwert-Lauf, INSERT ... ON CONFLICT
  // in scripts/lib/tft-marketvalue-pipeline.mjs.
  addEdge('svc:metastats-marketvalue-snapshot.service', 'db:tft_player_marketvalue_snapshots', 'write',
    svcWorking('metastats-marketvalue-snapshot.service'));
  // refresh-api schreibt on-demand in Match-Cache + Marketvalue-Snapshots
  addEdge('svc:metastats-refresh-api.service', 'db:tft_player_match_cache', 'write', false);
  addEdge('svc:metastats-refresh-api.service', 'db:tft_player_marketvalue_snapshots', 'write', false);
  // crawler (Legacy-Marketvalue-Vollsweep) schreibt auch dorthin — nur aktiv wenn manuell getriggert
  addEdge('svc:metastats-crawler.service', 'db:tft_player_match_cache', 'write',
    svcWorking('metastats-crawler.service'));
  addEdge('svc:metastats-crawler.service', 'db:tft_player_marketvalue_snapshots', 'write',
    svcWorking('metastats-crawler.service'));
  // companion-backfill traegt Platzierung + echte Riot-Match-ID in die
  // Positions-Beobachtungen nach (PATCH auf tft_position_observations). Die
  // fruehere Kante auf tft_player_match_cache war falsch — das Skript nennt
  // die Tabelle an keiner Stelle.
  addEdge('svc:metastats-companion-backfill.service', 'db:tft_position_observations', 'write',
    svcWorking('metastats-companion-backfill.service'));
  // position-aggregator: liest Beobachtungen + Match-Cache, schreibt die
  // comp-gebundene Zellzahl.
  addEdge('db:tft_position_observations', 'svc:metastats-position-aggregator.service', 'read',
    svcWorking('metastats-position-aggregator.service'));
  addEdge('db:tft_player_match_cache', 'svc:metastats-position-aggregator.service', 'read',
    svcWorking('metastats-position-aggregator.service'));
  addEdge('svc:metastats-position-aggregator.service', 'db:tft_position_comp_cell', 'write',
    svcWorking('metastats-position-aggregator.service'));

  // Publisher READS aus DB (über die Live-API), schreibt nach Blob
  addEdge('db:tft_daily_comp_stats', 'svc:metastats-snapshot-publisher.service', 'read',
    svcWorking('metastats-snapshot-publisher.service'));
  addEdge('svc:metastats-snapshot-publisher.service', 'blob:manifest', 'write',
    svcWorking('metastats-snapshot-publisher.service'));

  // Trigger-Edges: OnSuccess-Ketten
  addEdge('svc:metastats-daily-crawl.service', 'svc:metastats-snapshot-publisher.service', 'trigger', false);
  addEdge('svc:metastats-daily-crawl.service', 'svc:metastats-daily-crawl-catchup.service', 'trigger', false);

  // refresh-api serves User direkt (Refresh-Button-Pfad)
  addEdge('svc:metastats-refresh-api.service', 'user', 'request', true);

  return { nodes, edges };
}

// =========================================================================
// 3D Components
// =========================================================================

// Ein Knoten ist rund 1,2 Einheiten breit. Ein Ring mit Radius 4,5 hat einen
// Umfang von 28 Einheiten und damit Platz fuer gut 20 Knoten — bei 73
// Schnittstellen oder 28 Tabellen ueberlappt alles. Deshalb waechst der Radius
// mit der Anzahl, und ab einer Obergrenze wird auf mehrere Ringe verteilt,
// statt den Ring ins Unendliche zu ziehen (sonst passt keine Kameraposition
// mehr fuer beide Enden).
const NODE_SPACING = 1.45;
const MAX_RADIUS = 10.5;

function ringsFor(total: number): { rings: number; perRing: number } {
  let rings = 1;
  while ((Math.ceil(total / rings) * NODE_SPACING) / (2 * Math.PI) > MAX_RADIUS) rings++;
  return { rings, perRing: Math.ceil(total / rings) };
}

function positionFor(node: NodeData, idx: number, total: number): [number, number, number] {
  const layerSpacing = 4.5;
  const y = node.layer * layerSpacing - 11;
  if (node.layer === L_USER) return [0, y, 0];
  const { perRing } = ringsFor(total);
  const ring = Math.floor(idx / perRing);
  const inRing = idx % perRing;
  const countInRing = Math.min(perRing, total - ring * perRing);
  const base = Math.max(4.5 + node.layer * 0.4, (countInRing * NODE_SPACING) / (2 * Math.PI));
  const radius = base + ring * 1.9;
  // Halber Schritt Versatz je Ring, damit die Knoten des zweiten Rings nicht
  // exakt hinter denen des ersten stehen.
  const angle = ((inRing + (ring % 2) * 0.5) / Math.max(1, countInRing)) * Math.PI * 2;
  return [Math.cos(angle) * radius, y, Math.sin(angle) * radius];
}

// Beschriftungen als gezeichnete Bilder statt als HTML-Schnipsel.
//
// Vorher hing an jedem Knoten ein <Html>-Element. Das legt pro Knoten eine
// eigene React-Wurzel an und schreibt in JEDEM Bild eine neue CSS-Transform
// (node_modules/@react-three/drei/web/Html.js:143) — bei zwoelf Knoten
// unauffaellig, bei den jetzt bis zu 170 nicht mehr. Die naheliegende
// Alternative (Text-Geometrie von drei) faellt aus: troika-three-text hat
// `defaultFontURL: null` und unter public/ liegt keine Schriftdatei, die
// Beschriftung wuerde also zur Laufzeit eine fremde Schrift nachladen.
// Ein gezeichnetes Bild pro Beschriftungstext braucht beides nicht.
const labelTextures = new Map<string, THREE.CanvasTexture>();

function labelTexture(text: string, bright: boolean): THREE.CanvasTexture {
  const key = `${bright ? 'w' : 'g'}|${text}`;
  const cached = labelTextures.get(key);
  if (cached) return cached;
  const font = '600 44px ui-sans-serif, system-ui, -apple-system, sans-serif';
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const width = Math.max(16, Math.ceil(probe.measureText(text).width) + 16);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = bright ? '#ffffff' : '#c2cddb';
  ctx.fillText(text, width / 2, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  labelTextures.set(key, tex);
  return tex;
}

function LabelSprite({ text, bright, y }: { text: string; bright: boolean; y: number }) {
  const tex = useMemo(() => labelTexture(text, bright), [text, bright]);
  const img = tex.image as HTMLCanvasElement;
  const height = 0.4;
  return (
    <sprite position={[0, y, 0]} scale={[(height * img.width) / img.height, height, 1]}>
      <spriteMaterial map={tex} transparent depthWrite={false} opacity={bright ? 1 : 0.78} />
    </sprite>
  );
}

// Kern + Beschriftung fuer jeden Knoten. Halo und rotierender Ring gibt es nur
// dort, wo sie etwas aussagen (laufender Dienst, ausgewaehlter Knoten) — bei
// 170 Knoten waeren vier Koerper pro Knoten sonst 680 Zeichenvorgaenge.
function NodeMesh({ position, color, pulsing, label, selected, big, onClick }: {
  position: [number, number, number];
  color: string;
  pulsing: boolean;
  label: string;
  selected: boolean;
  big: boolean;
  onClick: () => void;
}) {
  const haloRef = useRef<THREE.Mesh>(null);
  const outerRingRef = useRef<THREE.Mesh>(null);
  const radius = big ? 0.38 : 0.26;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (haloRef.current) {
      haloRef.current.scale.setScalar(1.6 * (1 + Math.sin(t * 3) * 0.25));
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.18 + Math.sin(t * 3) * 0.08;
    }
    if (outerRingRef.current) {
      outerRingRef.current.rotation.z = -t * 0.6;
    }
  });

  return (
    <group
      position={position}
      onClick={e => { e.stopPropagation(); onClick(); }}
      onPointerOver={() => { document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = ''; }}
    >
      <mesh>
        <sphereGeometry args={[radius, 16, 16]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 1.8 : 1.2}
          roughness={0.3}
          metalness={0.6}
        />
      </mesh>
      {pulsing && (
        <mesh ref={haloRef}>
          <sphereGeometry args={[radius * 1.5, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
        </mesh>
      )}
      {selected && (
        <mesh ref={outerRingRef}>
          <torusGeometry args={[0.95, 0.025, 8, 48]} />
          <meshBasicMaterial color={'#ffffff'} transparent opacity={0.85} />
        </mesh>
      )}
      <LabelSprite text={label} bright={selected} y={radius + 0.42} />
    </group>
  );
}

// Alle ruhenden Linien in EINEM Zeichenvorgang. Vorher war jede Kante eine
// eigene Linie mit eigener Geometrie — bei 282 Kanten aus der Karte plus den
// Dienst-Kanten waren das ueber 300.
function BaseEdges({ edges, positions, dimmed }: {
  edges: EdgeData[];
  positions: Map<string, [number, number, number]>;
  dimmed: boolean;
}) {
  const geometry = useMemo(() => {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const e of edges) {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      if (!a || !b) continue;
      pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
      c.set(e.color).multiplyScalar(dimmed ? 0.16 : 0.6);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return g;
  }, [edges, positions, dimmed]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial vertexColors transparent opacity={0.55} depthWrite={false} />
    </lineSegments>
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

function Scene({ graph, selectedId, onSelect }: {
  graph: { nodes: NodeData[]; edges: EdgeData[] };
  selectedId: string | null;
  onSelect: (n: NodeData | null) => void;
}) {
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
      {/* Reicht jetzt weiter: die Ebenen stehen ueber 27 Einheiten verteilt,
          mit der alten Nebelgrenze bei 50 waere die oberste schwarz. */}
      <fog attach="fog" args={['#050810', 34, 110]} />
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
            big={n.kind === 'group' || n.kind === 'service' || n.kind === 'user' || n.kind === 'blob' || n.kind === 'box'}
            onClick={() => onSelect(n)}
          />
        );
      })}

      {/* Ruhende Kanten gebuendelt, bewegte einzeln: nur Kanten mit Fluss oder
          am ausgewaehlten Knoten brauchen eine eigene Linie samt Laufpunkt. */}
      <BaseEdges
        edges={graph.edges.filter(e => !(e.active || e.from === selectedId || e.to === selectedId))}
        positions={positions}
        dimmed={selectedId !== null}
      />

      {graph.edges.map((e, i) => {
        const touchesSelected = selectedId !== null && (e.from === selectedId || e.to === selectedId);
        if (!e.active && !touchesSelected) return null;
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return null;
        return (
          <FlowEdge
            key={i}
            from={from}
            to={to}
            color={e.color}
            active={e.active}
            highlighted={touchesSelected}
            dimmed={selectedId !== null && !touchesSelected}
          />
        );
      })}

      <OrbitControls enablePan zoomSpeed={0.8} target={[0, 1.5, 0]} />
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
function emptyBuckets(): Record<EdgeKind, NodeData[]> {
  return { write: [], read: [], serve: [], trigger: [], request: [], call: [], fetch: [] };
}

function dependenciesFor(nodeId: string, edges: EdgeData[], nodes: NodeData[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = emptyBuckets();
  const in_ = emptyBuckets();
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
  // Die Kanten laufen immer vom Erzeuger zum Verbraucher. Deshalb heisst die
  // ausgehende Seite einer Lese-Kante „wird gelesen von" und die eingehende
  // „liest aus" — nicht umgekehrt.
  const sections: Array<{ heading: string; items: NodeData[]; color: string }> = [
    // Ausgehend (dieser Knoten beliefert etwas)
    { heading: 'Schreibt nach', items: deps.out.write, color: EDGE_KIND_COLOR.write },
    { heading: 'Wird gelesen von', items: deps.out.read, color: EDGE_KIND_COLOR.read },
    { heading: 'Wird aufgerufen von', items: deps.out.call, color: EDGE_KIND_COLOR.call },
    { heading: 'Wird abgeholt von', items: deps.out.fetch, color: EDGE_KIND_COLOR.fetch },
    { heading: 'Liefert an', items: deps.out.serve, color: EDGE_KIND_COLOR.serve },
    { heading: 'Triggert', items: deps.out.trigger, color: EDGE_KIND_COLOR.trigger },
    { heading: 'Bedient', items: deps.out.request, color: EDGE_KIND_COLOR.request },
    // Eingehend (dieser Knoten holt sich etwas)
    { heading: 'Wird beschrieben von', items: deps.in.write, color: EDGE_KIND_COLOR.write },
    { heading: 'Liest aus', items: deps.in.read, color: EDGE_KIND_COLOR.read },
    { heading: 'Ruft auf', items: deps.in.call, color: EDGE_KIND_COLOR.call },
    { heading: 'Holt von', items: deps.in.fetch, color: EDGE_KIND_COLOR.fetch },
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
  // Aufgeklappte Bereiche. Leer = alles gesammelt, `allGroupNames` = alles offen.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const allGroupNames = useMemo(() => MAP.groups.map(g => g.name), []);
  const allOpen = expanded.size === allGroupNames.length;

  const toggleGroup = (name: string) => setExpanded(prev => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });

  const graph = useMemo(() => buildGraph(snap, expanded), [snap, expanded]);
  const selectedNode = useMemo(
    () => (selectedId ? graph.nodes.find(n => n.id === selectedId) || null : null),
    [graph, selectedId],
  );

  const handleSelect = (n: NodeData | null) => {
    // Klick auf einen Sammelknoten klappt den Bereich auf. Der Knoten
    // verschwindet dabei, deshalb wandert die Auswahl auf nichts.
    if (n && n.kind === 'group' && n.group) {
      toggleGroup(n.group);
      setSelectedId(null);
      return;
    }
    setSelectedId(n?.id || null);
  };

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

        <div className="flex flex-wrap items-center gap-2 pt-1 pointer-events-auto">
          <button
            onClick={() => setExpanded(allOpen ? new Set() : new Set(allGroupNames))}
            className="px-2 py-0.5 rounded border border-border-subtle bg-surface-overlay hover:bg-[#2a3a52] text-gray-300 hover:text-white transition-colors text-[11px]"
          >
            {allOpen ? 'alles zuklappen' : 'alles aufklappen'}
          </button>
          <span className="text-gray-500">
            {graph.nodes.length} Knoten · {graph.edges.length} Verbindungen
          </span>
        </div>

        {expanded.size > 0 && !allOpen && (
          <div className="flex flex-wrap gap-1 pointer-events-auto">
            {[...expanded].sort().map(name => (
              <button
                key={name}
                onClick={() => toggleGroup(name)}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-overlay hover:bg-[#2a3a52] text-gray-300 hover:text-white transition-colors"
                title="Bereich wieder zuklappen"
              >
                /{name} ×
              </button>
            ))}
          </div>
        )}

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
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.call }} />ruft Funktion</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.fetch }} />holt extern</div>
        <div className="flex items-center gap-1.5"><span className="w-3 h-0.5" style={{ backgroundColor: EDGE_KIND_COLOR.request }} />wird angefragt</div>
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-10 flex justify-between gap-3 text-[10px] text-gray-500 pointer-events-none">
        <div>von oben nach unten: {[...LAYER_NAMES].reverse().join(' · ')}</div>
        <div>poll services/30s · db/60s · blob/120s · klick für details</div>
      </div>

      <div className="absolute inset-0">
        {/* Die Ebenen stehen jetzt ueber rund 27 Einheiten Hoehe verteilt statt
            ueber 18 — mit der alten Kamera bei z=22 waeren oben und unten
            abgeschnitten. */}
        <Canvas camera={{ position: [0, 4, 44], fov: 50 }} dpr={[1, 2]} frameloop="always">
          <Scene graph={graph} selectedId={selectedId} onSelect={handleSelect} />
        </Canvas>
      </div>
    </div>
  );
}

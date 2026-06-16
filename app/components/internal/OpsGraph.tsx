'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Line, Html } from '@react-three/drei';
import * as THREE from 'three';

// Multi-Tier-Polling-Intervalle wie vom Perf-Critic empfohlen. Schreibrate
// wird Client-side via localStorage gemerkt — kein Server-State nötig.
const POLL_SERVICES_MS = 10_000;
const POLL_DB_MS = 60_000;
const POLL_MANIFEST_MS = 120_000;

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

// =========================================================================
// Polling Hook — multi-tier per slice, mergt in einen Snapshot
// =========================================================================

function useOpsSnapshot(): { snap: Snapshot | null; lastUpdate: Date | null } {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function pull(slice: 'services' | 'db' | 'manifest' | 'all') {
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
    return () => { alive = false; clearInterval(tServices); clearInterval(tDb); clearInterval(tManifest); };
  }, []);

  return { snap, lastUpdate };
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
// Layout — 3 Layer in Y, X/Z innerhalb des Layers via Force-Free Spreading
// =========================================================================

interface NodeData {
  id: string;
  label: string;
  layer: number;     // 0 = unten (User), 1 = API, 2 = Blob, 3 = DB, 4 = Crawler
  status: ServiceStatus;
  detail: string;
  rate: number | null;
}

interface EdgeData {
  from: string;
  to: string;
  color: string;
  active: boolean;
}

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
      id: s.name,
      label: s.name.replace('metastats-', '').replace('.service', ''),
      layer: 4,
      status: s.status,
      detail: `${s.activeState}/${s.subState} · result=${s.result}` + (s.ageSinceLastRunMs ? ` · last ${humanAge(s.ageSinceLastRunMs)} ago` : ''),
      rate: null,
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
      status: c?.estimated != null ? 'healthy' : 'unknown',
      detail: c?.estimated != null
        ? `${fmt(c.estimated)} rows total${c.today != null ? ` · ${fmt(c.today)} heute` : ''}`
        : 'no data',
      rate,
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
    status: manifestStatus,
    detail: manifest ? `${manifest.entries} entries · built ${humanAge(manifestAge!)} ago` : 'no manifest',
    rate: null,
  });

  // Layer 1 — API-Endpoints
  const apis = ['comps', 'units', 'items', 'traits'];
  for (const a of apis) {
    nodes.push({
      id: 'api:' + a,
      label: `/api/tft/${a}`,
      layer: 1,
      status: 'healthy',
      detail: 'serves from snapshot bundle',
      rate: null,
    });
  }

  // Layer 0 — User
  nodes.push({ id: 'user', label: 'User', layer: 0, status: 'healthy', detail: 'you', rate: null });

  // Edges: Daten-Flow
  const crawlerToDb: Record<string, string[]> = {
    'metastats-daily-crawl.service': ['db:tft_daily_comp_stats'],
    'metastats-snapshot-publisher.service': ['blob:manifest'],
  };
  for (const [from, tos] of Object.entries(crawlerToDb)) {
    const svc = services.find(s => s.name === from);
    if (!svc) continue;
    for (const to of tos) {
      edges.push({ from, to, color: '#facc15', active: svc.status === 'working' });
    }
  }
  // DB → Blob (publisher reads DB to build snapshots)
  for (const tbl of tables) {
    edges.push({ from: 'db:' + tbl, to: 'blob:manifest', color: '#3b82f6', active: false });
  }
  // Blob → API
  for (const a of apis) {
    edges.push({ from: 'blob:manifest', to: 'api:' + a, color: '#a855f7', active: !!manifest });
  }
  // API → User
  for (const a of apis) {
    edges.push({ from: 'api:' + a, to: 'user', color: '#ec4899', active: true });
  }

  return { nodes, edges };
}

// =========================================================================
// 3D Components
// =========================================================================

function positionFor(node: NodeData, idx: number, total: number): [number, number, number] {
  const layerSpacing = 4;
  const y = node.layer * layerSpacing - 8;
  const radius = node.layer === 0 ? 0 : 5 + node.layer * 0.5;
  const angle = (idx / Math.max(1, total)) * Math.PI * 2;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return [x, y, z];
}

function NodeMesh({ position, color, pulsing, label, detail, onHover }: {
  position: [number, number, number];
  color: string;
  pulsing: boolean;
  label: string;
  detail: string;
  onHover: (info: { label: string; detail: string } | null) => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!pulsing || !glowRef.current) return;
    const t = clock.getElapsedTime();
    const scale = 1.3 + Math.sin(t * 3) * 0.2;
    glowRef.current.scale.setScalar(scale);
  });
  return (
    <group
      position={position}
      onPointerOver={() => onHover({ label, detail })}
      onPointerOut={() => onHover(null)}
    >
      <mesh ref={meshRef}>
        <sphereGeometry args={[0.4, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.4} />
      </mesh>
      {pulsing && (
        <mesh ref={glowRef}>
          <sphereGeometry args={[0.5, 24, 24]} />
          <meshBasicMaterial color={color} transparent opacity={0.15} />
        </mesh>
      )}
      <Html distanceFactor={12} position={[0, 0.7, 0]} center>
        <div className="text-[10px] text-gray-300 whitespace-nowrap select-none pointer-events-none">
          {label}
        </div>
      </Html>
    </group>
  );
}

function FlowEdge({ from, to, color, active }: {
  from: [number, number, number];
  to: [number, number, number];
  color: string;
  active: boolean;
}) {
  const particleRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!particleRef.current || !active) return;
    const t = (clock.getElapsedTime() * 0.3) % 1;
    particleRef.current.position.set(
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
      from[2] + (to[2] - from[2]) * t,
    );
  });
  return (
    <>
      <Line points={[from, to]} color={color} lineWidth={1} opacity={0.3} transparent />
      {active && (
        <mesh ref={particleRef}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </>
  );
}

function Scene({ snap, onHover }: { snap: Snapshot | null; onHover: (i: { label: string; detail: string } | null) => void }) {
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
      <ambientLight intensity={0.4} />
      <pointLight position={[10, 10, 10]} intensity={0.6} />
      <pointLight position={[-10, -5, -10]} intensity={0.3} color="#7B61FF" />

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
            detail={n.detail}
            onHover={onHover}
          />
        );
      })}

      {graph.edges.map((e, i) => {
        const from = positions.get(e.from);
        const to = positions.get(e.to);
        if (!from || !to) return null;
        return <FlowEdge key={i} from={from} to={to} color={e.color} active={e.active} />;
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

export default function OpsGraph() {
  const { snap, lastUpdate } = useOpsSnapshot();
  const [hover, setHover] = useState<{ label: string; detail: string } | null>(null);

  const errs = snap?.errors;
  const hasErrors = !!(errs?.services || errs?.db || errs?.manifest);

  return (
    <div className="min-h-screen bg-[#0a0f1c] text-gray-200 relative overflow-hidden">
      <div className="absolute top-3 left-3 z-10 text-xs space-y-1">
        <div className="font-semibold">metastats ops</div>
        <div className="text-gray-500">
          {lastUpdate ? `updated ${humanAge(Date.now() - lastUpdate.getTime())} ago` : 'loading…'}
        </div>
        {hasErrors && (
          <div className="text-red-400 mt-2 space-y-0.5">
            {errs?.services && <div>hetzner: {errs.services}</div>}
            {errs?.db && <div>db: {errs.db}</div>}
            {errs?.manifest && <div>blob: {errs.manifest}</div>}
          </div>
        )}
      </div>

      <div className="absolute top-3 right-3 z-10 text-xs text-right space-y-1 max-w-xs">
        {hover ? (
          <>
            <div className="font-semibold">{hover.label}</div>
            <div className="text-gray-400">{hover.detail}</div>
          </>
        ) : (
          <div className="text-gray-500">hover a node for details</div>
        )}
      </div>

      <div className="absolute bottom-3 left-3 right-3 z-10 flex justify-between text-[10px] text-gray-500">
        <div>L4 Crawler · L3 DB · L2 Snapshot · L1 API · L0 User</div>
        <div>poll services/10s · db/60s · blob/120s</div>
      </div>

      <div className="absolute inset-0">
        <Canvas camera={{ position: [0, 0, 18], fov: 50 }} dpr={[1, 2]} frameloop="always">
          <Scene snap={snap} onHover={setHover} />
        </Canvas>
      </div>
    </div>
  );
}

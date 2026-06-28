#!/usr/bin/env node
/**
 * Phase-1-Beobachtungs-Probe: misst die 6 Decision-Tree-Metriken aus
 * infra/specs/2026-06-25-stats-aggregator-v2.md Sektion 7.
 *
 * Lifecycle:
 *   - Manuelle Ausführung: `node scripts/probe-aggregator-readiness.mjs`
 *   - Daily-Cron: `node scripts/probe-aggregator-readiness.mjs --json
 *     >> phase1-probes.log`
 *   - Output ist 1 JSON-Zeile pro Run, append-only
 *
 * Phase-2-Decision-Tree nach 7 Tagen:
 *   - Alle Tail-Metriken Option-C-Schwelle    → Option C (1-2d struktureller Härtung)
 *   - Coverage 85-95%, keine neuen Outages     → Option B (3-5d Minimal-Aggregator)
 *   - Coverage <85% nach 3d ODER neue Outage   → Option A (10-14d Full-Aggregator)
 *
 * Metriken:
 *   1. Manifest-Coverage real-existing-Permutationen
 *   2. Bucket-Fix-Drift in anderen RPCs (units/items/traits diamond_plus)
 *   3. Patch-Resolver-Drift (inline-SQL vs Live-API)
 *   4. Edge-Cache-Hit-Rate Default-Filter
 *   5. Cold-RPC-p99 Tail-Permutationen
 *   6. Supabase-Outage-Status (HTTP 522 Detect-Curl)
 *
 * Memory-Anker: reference_supabase_outage_runbook.md, reference_internal_ops_dashboard.md
 */

import { SNAPSHOT_MATRIX, snapshotKey } from '../app/lib/snapshot-matrix.generated.mjs';

const BASE = process.env.PUBLIC_BASE_URL || 'https://www.metastats.gg';
const MANIFEST_URL = 'https://unyv1wum3kbegjer.public.blob.vercel-storage.com/tft/manifest.json';
const SUPABASE_HOST = 'https://bwawxwgxxfafbruebixa.supabase.co';

const JSON_OUT = process.argv.includes('--json');
const VERBOSE = process.argv.includes('--verbose');

function log(...args) { if (!JSON_OUT) console.log(...args); }

// ─────────────────────────────────────────────────────────────────────────────
// Probe 1: Manifest-Coverage real-existing-Permutationen
// ─────────────────────────────────────────────────────────────────────────────

async function probeManifestCoverage() {
  const t0 = Date.now();
  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const manifest = await res.json();
    const entries = new Set(Object.keys(manifest.entries || {}));

    // Expected: alle Permutationen aus snapshot-matrix.ts mit resolvedPatch-Substitution
    // Wir vergleichen filename-basiert: <endpoint>/<resolvedPatch>/<key>.json
    // resolvedPatch ist current (z.B. 17.5) — wir lesen patches.current aus dem Manifest
    const currentPatch = manifest.patches?.current;
    const previousPatch = manifest.patches?.previous;

    const counts = {};
    for (const [endpoint, spec] of Object.entries(SNAPSHOT_MATRIX)) {
      const perms = spec.permutations || [];
      let inManifest = 0;
      let expected = 0;
      for (const p of perms) {
        const resolvedPatch = p.patch === 'current' ? currentPatch : (p.patch === 'previous' ? previousPatch : p.patch);
        if (!resolvedPatch) continue;
        expected++;
        // Use the canonical snapshotKey() (same one the publisher writes) instead
        // of re-deriving the key inline — an inline copy drifts from the real key
        // format and would silently report wrong 0% coverage. Audit drift-#3.
        const key = snapshotKey(endpoint, { ...p, patch: resolvedPatch });
        if (entries.has(key)) inManifest++;
      }
      counts[endpoint] = { expected, in_manifest: inManifest, pct: expected > 0 ? Math.round((inManifest / expected) * 1000) / 10 : 0 };
    }

    const totalExpected = Object.values(counts).reduce((s, c) => s + c.expected, 0);
    const totalInManifest = Object.values(counts).reduce((s, c) => s + c.in_manifest, 0);
    const totalPct = totalExpected > 0 ? Math.round((totalInManifest / totalExpected) * 1000) / 10 : 0;

    return {
      ok: true,
      duration_ms: Date.now() - t0,
      manifest_built_at: manifest.builtAt,
      current_patch: currentPatch,
      previous_patch: previousPatch,
      total_entries: entries.size,
      total_expected: totalExpected,
      total_in_manifest: totalInManifest,
      coverage_pct: totalPct,
      by_endpoint: counts,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 2: Bucket-Fix-Drift in 4 RPCs (units/items/traits/comps mit diamond_plus)
// ─────────────────────────────────────────────────────────────────────────────

async function probeBucketDrift() {
  const t0 = Date.now();
  const endpoints = [
    { name: 'comps', path: '/api/tft/comps', filters: 'region=all&days=3&bucket=diamond_plus&source=data' },
    { name: 'units', path: '/api/tft/units', filters: 'region=euw1&days=3&bucket=diamond_plus' },
    { name: 'items', path: '/api/tft/items', filters: 'region=euw1&days=3&bucket=diamond_plus' },
    { name: 'traits', path: '/api/tft/traits', filters: 'region=all&days=3&bucket=diamond_plus' },
  ];
  const results = {};
  for (const ep of endpoints) {
    try {
      const url = `${BASE}${ep.path}?${ep.filters}`;
      const tEp = Date.now();
      const res = await fetch(url, { redirect: 'follow' });
      const body = res.ok ? await res.json() : null;
      const itemCount = body ? (body.comps?.length ?? body.units?.length ?? body.items?.length ?? body.traits?.length ?? 0) : 0;
      results[ep.name] = {
        http: res.status,
        has_data: body?.hasData === true,
        item_count: itemCount,
        duration_ms: Date.now() - tEp,
      };
    } catch (err) {
      results[ep.name] = { error: err.message };
    }
  }
  // Bucket-Drift = ANY endpoint mit has_data:false oder item_count:0
  const broken = Object.entries(results).filter(([_, r]) => !r.has_data || r.item_count === 0).map(([k]) => k);
  return {
    duration_ms: Date.now() - t0,
    by_endpoint: results,
    broken_endpoints: broken,
    drift_count: broken.length,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 3: Patch-Resolver-Drift (Live-API patches.current vs DB-Probe oben)
// ─────────────────────────────────────────────────────────────────────────────
//
// Wir können nicht direkt DB queryen (Supabase nicht von Vercel-Edge), aber
// Manifest hat current/previous-Patches plus eine Live-API-Probe gibt
// patches[]-Array zurück. Drift = unterschiedliche Patch-Listen.

async function probePatchResolverDrift() {
  const t0 = Date.now();
  try {
    const apiUrl = `${BASE}/api/tft/comps?region=all&days=3&bucket=master_plus&source=data`;
    const res = await fetch(apiUrl, { redirect: 'follow' });
    if (!res.ok) return { ok: false, error: `Live-API HTTP ${res.status}` };
    const body = await res.json();
    const livePatches = (body.patches || []).map(p => p.patch);

    const manifestRes = await fetch(MANIFEST_URL, { cache: 'no-store' });
    if (!manifestRes.ok) return { ok: false, error: `Manifest HTTP ${manifestRes.status}` };
    const manifest = await manifestRes.json();
    const manifestPatches = {
      current: manifest.patches?.current,
      previous: manifest.patches?.previous,
    };

    const liveCurrent = livePatches[0] || null;
    const livePrevious = livePatches[1] || null;
    const drift = (liveCurrent !== manifestPatches.current) || (livePrevious !== manifestPatches.previous);

    return {
      ok: true,
      duration_ms: Date.now() - t0,
      live_api: { current: liveCurrent, previous: livePrevious, all: livePatches },
      manifest: manifestPatches,
      drift,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 4: Edge-Cache-Hit-Rate Default-Filter
// ─────────────────────────────────────────────────────────────────────────────

async function probeEdgeCacheHitRate() {
  const t0 = Date.now();
  // 4 Endpoints × 3 Calls = 12 Samples. Wir messen X-Vercel-Cache Header.
  // Cache-Bust-Param NICHT setzen — wir wollen echtes Hit-Rate sehen.
  const probes = [
    { ep: 'comps', filters: 'region=all&days=3&bucket=master_plus&source=data' },
    { ep: 'comps', filters: 'region=west&days=3&bucket=master_plus&source=data' },
    { ep: 'comps', filters: 'region=kr&days=3&bucket=master_plus&source=data' },
    { ep: 'units', filters: 'region=euw1&days=3&bucket=diamond_plus' },
    { ep: 'units', filters: 'region=all&days=7&bucket=master_plus' },
    { ep: 'items', filters: 'region=euw1&days=3&bucket=diamond_plus' },
    { ep: 'items', filters: 'region=all&days=3&bucket=all' },
    { ep: 'traits', filters: 'region=all&days=3&bucket=master_plus' },
    { ep: 'traits', filters: 'region=west&days=7&bucket=master_plus' },
  ];

  const samples = [];
  for (const probe of probes) {
    try {
      const url = `${BASE}/api/tft/${probe.ep}?${probe.filters}`;
      const tProbe = Date.now();
      const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
      samples.push({
        ep: probe.ep,
        filters: probe.filters,
        cache: res.headers.get('x-vercel-cache') || 'unknown',
        age: parseInt(res.headers.get('age') || '0', 10),
        snapshot: res.headers.get('x-snapshot') || null,
        http: res.status,
        duration_ms: Date.now() - tProbe,
      });
    } catch (err) {
      samples.push({ ep: probe.ep, filters: probe.filters, error: err.message });
    }
  }

  const valid = samples.filter(s => !s.error);
  const hits = valid.filter(s => s.cache === 'HIT' || s.cache === 'STALE').length;
  const hitRate = valid.length > 0 ? Math.round((hits / valid.length) * 1000) / 10 : 0;

  return {
    duration_ms: Date.now() - t0,
    samples,
    sample_count: valid.length,
    hit_count: hits,
    hit_rate_pct: hitRate,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 5: Cold-RPC-p99 Tail-Permutationen
// ─────────────────────────────────────────────────────────────────────────────

async function probeColdRpcP99() {
  const t0 = Date.now();
  // Tail = nicht-Default-Permutationen. Wir nehmen 3 die früher 502 erzeugten:
  // diamond_plus, all-7d, previous-Patch. Cache-bust via &_t=<ts>.
  const tailProbes = [
    { name: 'diamond_plus', path: '/api/tft/comps?region=all&days=3&bucket=diamond_plus&source=data' },
    { name: 'all_7d', path: '/api/tft/comps?region=all&days=7&bucket=master_plus&source=data' },
    { name: 'previous', path: '/api/tft/comps?patch=previous&region=all&days=3&bucket=master_plus&source=data' },
    { name: 'asia_7d_diamond', path: '/api/tft/comps?region=asia&days=7&bucket=diamond_plus&source=data' },
  ];

  const latencies = [];
  const results = [];
  for (const probe of tailProbes) {
    try {
      const url = `${BASE}${probe.path}&_t=${Date.now()}`;
      const tProbe = Date.now();
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      const ms = Date.now() - tProbe;
      latencies.push(ms);
      results.push({ name: probe.name, http: res.status, ms });
    } catch (err) {
      results.push({ name: probe.name, error: err.message });
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
  const p99 = latencies[Math.floor(latencies.length * 0.99)] || latencies[latencies.length - 1] || 0;
  const timeouts = results.filter(r => r.http === 502 || r.error).length;

  return {
    duration_ms: Date.now() - t0,
    results,
    p50_ms: p50,
    p99_ms: p99,
    timeout_count: timeouts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Probe 6: Supabase-Outage-Status (HTTP 522 Detect-Curl)
// ─────────────────────────────────────────────────────────────────────────────

async function probeSupabaseStatus() {
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(`${SUPABASE_HOST}/rest/v1/`, { method: 'HEAD', signal: ctrl.signal });
    clearTimeout(t);
    return {
      ok: true,
      duration_ms: Date.now() - t0,
      http: res.status,
      outage: res.status === 522 || res.status === 521,
      status: res.status === 401 ? 'up' : res.status === 522 ? 'outage' : `unknown_${res.status}`,
    };
  } catch (err) {
    return {
      ok: false,
      duration_ms: Date.now() - t0,
      error: err.name === 'AbortError' ? 'timeout' : err.message,
      outage: true,
      status: 'outage',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const t0 = Date.now();
  log('=== Phase-1-Aggregator-Readiness-Probe ===');
  log(`    timestamp: ${new Date().toISOString()}`);
  log(`    base:      ${BASE}`);
  log('');

  log('[1/6] Manifest-Coverage ...');
  const coverage = await probeManifestCoverage();
  log(`      ${coverage.ok ? `${coverage.coverage_pct}% (${coverage.total_in_manifest}/${coverage.total_expected})` : `FAIL: ${coverage.error}`}`);

  log('[2/6] Bucket-Drift ...');
  const bucket = await probeBucketDrift();
  log(`      drift_count=${bucket.drift_count} broken=[${bucket.broken_endpoints.join(',')}]`);

  log('[3/6] Patch-Resolver-Drift ...');
  const patches = await probePatchResolverDrift();
  log(`      ${patches.ok ? `drift=${patches.drift} (live=${patches.live_api?.current}/${patches.live_api?.previous}, manifest=${patches.manifest?.current}/${patches.manifest?.previous})` : `FAIL: ${patches.error}`}`);

  log('[4/6] Edge-Cache-Hit-Rate ...');
  const cache = await probeEdgeCacheHitRate();
  log(`      hit_rate=${cache.hit_rate_pct}% (${cache.hit_count}/${cache.sample_count})`);

  log('[5/6] Cold-RPC-p99 Tail ...');
  const rpc = await probeColdRpcP99();
  log(`      p50=${rpc.p50_ms}ms p99=${rpc.p99_ms}ms timeouts=${rpc.timeout_count}`);

  log('[6/6] Supabase-Status ...');
  const supabase = await probeSupabaseStatus();
  log(`      status=${supabase.status} http=${supabase.http} outage=${supabase.outage}`);

  const result = {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    coverage,
    bucket,
    patches,
    cache,
    rpc,
    supabase,
    // Decision-Tree-Indicator: welche Phase-2-Option würde heute getriggert?
    decision_indicator: classifyOption({ coverage, bucket, patches, cache, rpc, supabase }),
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(result));
  } else {
    log('');
    log(`=== Decision-Indicator: ${result.decision_indicator.option} ===`);
    log(`    reason: ${result.decision_indicator.reason}`);
  }
}

function classifyOption({ coverage, bucket, patches, cache, rpc, supabase }) {
  // Sofort-Trigger Option A: neue Outage oder Coverage <85%
  if (supabase.outage) return { option: 'A', reason: 'Supabase-Outage gerade jetzt' };
  if (coverage.ok && coverage.coverage_pct < 85) return { option: 'A', reason: `Coverage ${coverage.coverage_pct}% < 85%` };
  if (rpc.timeout_count >= 3) return { option: 'A', reason: `Timeouts ${rpc.timeout_count} >= 3` };

  // Option B: Coverage 85-95%, Timeouts 1-2
  if (coverage.ok && coverage.coverage_pct < 95) return { option: 'B', reason: `Coverage ${coverage.coverage_pct}% in [85,95]` };
  if (rpc.timeout_count >= 1) return { option: 'B', reason: `Timeouts ${rpc.timeout_count}` };

  // Option C: alles grün
  return { option: 'C', reason: `Coverage ${coverage.coverage_pct}% >=95, Timeouts 0, no Outage` };
}

main().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

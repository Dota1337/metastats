#!/usr/bin/env node
// Supabase Database-Restart via Management API.
//
// Auth: Personal Access Token (sbp_*) aus Supabase-Dashboard →
// Account → Tokens. In .env.local als SUPABASE_MANAGEMENT_TOKEN.
//
// Funktion:
//   1. POST /v1/projects/{ref}/restart-services mit body {"services":["postgresql"]}
//      → triggert DB-Restart. Antwort 200 = akzeptiert (asynchron).
//   2. Poll /v1/projects/{ref}/health bis Status "ACTIVE_HEALTHY".
//
// Usage:
//   node scripts/supabase-restart.mjs              # restart + verify
//   node scripts/supabase-restart.mjs --check      # nur Health-Check, kein Restart
//   node scripts/supabase-restart.mjs --force      # restart ohne Pre-Check
//
// Konfiguration via .env.local:
//   SUPABASE_MANAGEMENT_TOKEN   (Pflicht)
//   SUPABASE_PROJECT_REF        (default: aus NEXT_PUBLIC_SUPABASE_URL abgeleitet)

import { readFileSync, existsSync } from 'node:fs';

const MGMT_API = 'https://api.supabase.com';

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function deriveProjectRef(env) {
  if (env.SUPABASE_PROJECT_REF) return env.SUPABASE_PROJECT_REF;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  // https://<ref>.supabase.co
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
  return m ? m[1] : null;
}

async function call(token, method, path, body) {
  const url = `${MGMT_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    // Bound every Management-API call — this script runs precisely when the DB
    // is unreachable, so an un-timed fetch would hang the restart indefinitely
    // (and waitHealthy's wall-clock guard is meaningless during a blocking
    // await). Audit H5, 2026-06-28.
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}

async function health(token, ref) {
  // Liefert { healthy: true|false, status, message, services[] }
  const r = await call(token, 'GET', `/v1/projects/${ref}/health?services=db,pooler,rest,auth`);
  return r;
}

async function restart(token, ref) {
  // Korrekter Management-API-Endpoint ist /restart (ohne Body).
  // /restart-services existiert nicht → HTTP 404 (verifiziert 2026-06-28).
  return call(token, 'POST', `/v1/projects/${ref}/restart`);
}

async function waitHealthy(token, ref, timeoutMs = 180_000) {
  const start = Date.now();
  let lastStatus = '';
  while (Date.now() - start < timeoutMs) {
    const r = await health(token, ref);
    if (r.ok && Array.isArray(r.data)) {
      const dbStatus = r.data.find(s => s.name === 'db')?.status || r.data[0]?.status;
      if (dbStatus !== lastStatus) {
        console.log(`      health: db=${dbStatus} (${Math.floor((Date.now() - start) / 1000)}s)`);
        lastStatus = dbStatus;
      }
      if (dbStatus === 'ACTIVE_HEALTHY') return true;
    }
    await new Promise(res => setTimeout(res, 5000));
  }
  return false;
}

async function main() {
  const env = { ...process.env, ...loadDotEnv('.env.local') };
  const token = env.SUPABASE_MANAGEMENT_TOKEN;
  if (!token) {
    console.error('FAIL: SUPABASE_MANAGEMENT_TOKEN missing in .env.local');
    console.error('Generate at https://supabase.com/dashboard/account/tokens');
    process.exit(1);
  }
  const ref = deriveProjectRef(env);
  if (!ref) {
    console.error('FAIL: SUPABASE_PROJECT_REF missing + cannot derive from NEXT_PUBLIC_SUPABASE_URL');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const checkOnly = args.includes('--check');
  const force = args.includes('--force');

  console.log(`[1/3] Project: ${ref}`);
  if (!force) {
    console.log('[2/3] Pre-restart health check…');
    const r = await health(token, ref);
    if (!r.ok) {
      console.log(`      Management-API antwortet: HTTP ${r.status}`, r.data);
    } else {
      const services = Array.isArray(r.data) ? r.data : [];
      for (const s of services) console.log(`      ${s.name}: ${s.status}${s.error ? ' · ' + s.error : ''}`);
      if (checkOnly) return;
      const dbHealthy = services.find(s => s.name === 'db')?.status === 'ACTIVE_HEALTHY';
      if (dbHealthy) {
        console.log('      DB ist bereits healthy — restart trotzdem? Use --force.');
        if (!args.includes('--anyway')) return;
      }
    }
  }
  if (checkOnly) return;

  console.log('[3/3] Triggering project restart…');
  const rr = await restart(token, ref);
  if (!rr.ok) {
    console.error(`      FAIL: HTTP ${rr.status}`, rr.data);
    process.exit(2);
  }
  console.log('      Accepted. Polling /health (max 3 min)…');
  const healthy = await waitHealthy(token, ref);
  if (healthy) {
    console.log('Done. DB is ACTIVE_HEALTHY again.');
  } else {
    console.error('TIMEOUT: DB nicht innerhalb 3 min healthy. Dashboard checken.');
    process.exit(3);
  }
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

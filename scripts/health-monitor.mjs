#!/usr/bin/env node
// Health-Monitor: alle 5 min (via systemd-Timer) checkt die metastats Vercel-API
// + Supabase. Bei 2× Fail in Folge wird Supabase-DB-Restart via Management-API
// getriggert + Discord/Slack/Webhook-Notification verschickt.
//
// Anti-Spam:
//   - Cool-Down 15 min nach jedem Auto-Restart (kein Loop wenn Restart hängt)
//   - max 4 Restarts pro 24h (sonst nur Notification, keine weiteren Restarts)
//   - Recovery-Notification wenn nach Fail wieder healthy
//
// State liegt in /var/lib/metastats-health/state.json (oder
// HEALTH_STATE_PATH env override für lokale Tests).
//
// Config (.env.local oder Hetzner /etc/metastats-crawler/env):
//   SUPABASE_MANAGEMENT_TOKEN    (Pflicht für Auto-Restart)
//   NEXT_PUBLIC_SUPABASE_URL     (für project-ref-Ableitung)
//   HEALTH_NOTIFY_WEBHOOK        (optional — Discord/Slack-Webhook-URL)
//   HEALTH_PROBE_URL             (default: https://www.metastats.gg/api/tft/available-patches)
//
// Usage:
//   node scripts/health-monitor.mjs                # eine probe + ggf. Aktion
//   node scripts/health-monitor.mjs --check        # nur Probe, keine Aktion

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_DIR = '/var/lib/metastats-health';
const STATE_FILE = process.env.HEALTH_STATE_PATH
  || (existsSync(STATE_DIR) || canMkdir(STATE_DIR) ? `${STATE_DIR}/state.json` : 'health-state.json');

const PROBE_TIMEOUT_MS = 15_000;
const COOL_DOWN_MS = 15 * 60 * 1000;
const MAX_RESTARTS_PER_DAY = 4;
const FAILS_BEFORE_RESTART = 2;

function canMkdir(path) {
  try { mkdirSync(path, { recursive: true }); return true; }
  catch { return false; }
}

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { consecutiveFails: 0, lastRestartAt: 0, restartsLast24h: [], lastNotifiedState: 'healthy' }; }
}

function saveState(s) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) {
    console.error(`[state] write failed: ${e.message}`);
  }
}

async function probe(url, timeoutMs = PROBE_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    const ms = Date.now() - start;
    const ok = res.status >= 200 && res.status < 500;   // 502/504 sind unhealthy
    return { ok: ok && res.status !== 502 && res.status !== 504, status: res.status, ms };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - start, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(timer);
  }
}

async function supabaseHealth(token, ref) {
  if (!token || !ref) return null;
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/health?services=db,pooler,rest`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, status: res.status };
    const data = await res.json();
    const db = Array.isArray(data) ? data.find(s => s.name === 'db') : null;
    return { ok: db?.status === 'ACTIVE_HEALTHY', dbStatus: db?.status || 'unknown', services: data };
  } catch (e) {
    return { ok: false, error: e.name === 'TimeoutError' ? 'timeout' : e.message };
  }
}

async function notify(webhook, payload) {
  if (!webhook) return false;
  try {
    // Discord + Slack share a simple text-payload shape ({"content":"..."} vs
    // {"text":"..."}). Wir senden beides — der jeweils unbekannte Key wird
    // ignoriert vom Empfänger.
    const body = JSON.stringify({ content: payload, text: payload });
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

function deriveProjectRef(url) {
  if (!url) return null;
  const m = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
  return m ? m[1] : null;
}

async function triggerRestart(token, ref) {
  // Correct Management-API endpoint is POST /restart WITHOUT a body. The old
  // /restart-services returns HTTP 404 — verified in the 2026-06-28 live outage
  // (see scripts/supabase-restart.mjs). This is the auto-restart path, so a 404
  // here means the health monitor detects the outage but never recovers it.
  // Keep in sync with supabase-restart.mjs.
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/restart`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  return { ok: res.ok, status: res.status };
}

async function main() {
  const env = { ...process.env, ...loadDotEnv('.env.local'), ...loadDotEnv('/etc/metastats-crawler/env') };
  const probeUrl = env.HEALTH_PROBE_URL || 'https://www.metastats.gg/api/tft/available-patches';
  const supaToken = env.SUPABASE_MANAGEMENT_TOKEN;
  const supaRef = deriveProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const webhook = env.HEALTH_NOTIFY_WEBHOOK;
  const checkOnly = process.argv.includes('--check');

  const state = loadState();
  const now = Date.now();

  // 1) API-Probe
  const apiResult = await probe(probeUrl);
  // 2) Supabase Management-API parallel
  const supaResult = supaToken && supaRef ? await supabaseHealth(supaToken, supaRef) : null;

  const apiHealthy = apiResult.ok;
  const supaHealthy = supaResult == null || supaResult.ok !== false;
  const overallHealthy = apiHealthy && supaHealthy;

  console.log(`[probe] api=${apiResult.status}/${apiResult.ms}ms${apiResult.error ? ` err=${apiResult.error}` : ''} · supa=${supaResult?.dbStatus || 'skip'} · healthy=${overallHealthy}`);

  if (checkOnly) return;

  if (overallHealthy) {
    if (state.consecutiveFails > 0 || state.lastNotifiedState === 'unhealthy') {
      await notify(webhook,
        `:white_check_mark: metastats wieder healthy (api ${apiResult.status} in ${apiResult.ms}ms, db ${supaResult?.dbStatus || 'n/a'})`);
      state.lastNotifiedState = 'healthy';
    }
    state.consecutiveFails = 0;
    saveState(state);
    return;
  }

  // Unhealthy
  state.consecutiveFails = (state.consecutiveFails || 0) + 1;
  console.log(`[unhealthy] consecutive=${state.consecutiveFails}`);

  // Garbage-collect restart-Timestamps älter als 24h
  state.restartsLast24h = (state.restartsLast24h || []).filter(t => now - t < 86_400_000);

  const inCoolDown = now - (state.lastRestartAt || 0) < COOL_DOWN_MS;
  const rateLimited = state.restartsLast24h.length >= MAX_RESTARTS_PER_DAY;

  if (state.consecutiveFails >= FAILS_BEFORE_RESTART && !inCoolDown && !rateLimited) {
    if (!supaToken || !supaRef) {
      await notify(webhook,
        `:warning: metastats unhealthy (api=${apiResult.status} supa=${supaResult?.dbStatus}). Auto-Restart skipped: SUPABASE_MANAGEMENT_TOKEN/ref missing.`);
      saveState(state);
      return;
    }
    console.log('[action] triggering Supabase restart');
    const rr = await triggerRestart(supaToken, supaRef);
    if (rr.ok) {
      state.lastRestartAt = now;
      state.restartsLast24h.push(now);
      await notify(webhook,
        `:rotating_light: metastats DB-Restart ausgelöst (api=${apiResult.status} ${apiResult.ms}ms, db=${supaResult?.dbStatus}). #${state.restartsLast24h.length}/24h`);
    } else {
      await notify(webhook,
        `:rotating_light: metastats unhealthy — Restart-API antwortete HTTP ${rr.status}`);
    }
    state.lastNotifiedState = 'unhealthy';
  } else if (state.consecutiveFails === FAILS_BEFORE_RESTART && rateLimited) {
    await notify(webhook,
      `:no_entry: metastats unhealthy + Auto-Restart-Limit (${MAX_RESTARTS_PER_DAY}/24h) erreicht. Manuelles Eingreifen nötig.`);
    state.lastNotifiedState = 'unhealthy';
  }

  saveState(state);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

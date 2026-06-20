#!/usr/bin/env node
// Stellt sicher dass der AgentDB-Daemon auf localhost:7878 läuft.
// Wenn /healthz nicht antwortet: detached Background-Spawn von server.mjs.
// Wartet bis ready oder timeout. Idempotent — kann beliebig oft aufgerufen werden.
//
// Use-Cases:
// - Spec-Architect-Subagent: vor Vector-Search auf relevante Memories
// - Trajectory-Tracker: vor Trajectory-Start/End
// - Verdict-Re-Score: vor Re-Score-Call
//
// Exit-Codes: 0 = daemon running, 1 = failed to start, 2 = startup timeout

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.AGENTDB_PORT || '7878', 10);
const HEALTHZ_URL = `http://127.0.0.1:${PORT}/healthz`;
const STARTUP_TIMEOUT_MS = 15000;  // Cold-Start fastembed ~1s + WAL-init etc.
const HEALTH_POLL_INTERVAL_MS = 200;

async function checkHealth() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 2000);
    const res = await fetch(HEALTHZ_URL, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const json = await res.json();
    return json.status === 'ok';
  } catch {
    return false;
  }
}

async function spawnDaemon() {
  const serverPath = resolve(__dirname, 'server.mjs');
  // detached: true + unref() → Daemon überlebt Parent-Exit. Windows-kompatibel.
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--use-system-ca' },
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

async function waitReady(deadline) {
  while (Date.now() < deadline) {
    if (await checkHealth()) return true;
    await new Promise(r => setTimeout(r, HEALTH_POLL_INTERVAL_MS));
  }
  return false;
}

async function main() {
  // Schon up?
  if (await checkHealth()) {
    if (!process.argv.includes('--quiet')) console.log(`[ensure-daemon] already running on :${PORT}`);
    process.exit(0);
  }

  // Spawnen
  const pid = await spawnDaemon();
  if (!process.argv.includes('--quiet')) console.log(`[ensure-daemon] spawned PID ${pid}, waiting for /healthz...`);

  // Polling-Wait
  const ready = await waitReady(Date.now() + STARTUP_TIMEOUT_MS);
  if (!ready) {
    console.error(`[ensure-daemon] FAIL — daemon not ready after ${STARTUP_TIMEOUT_MS}ms`);
    process.exit(2);
  }
  if (!process.argv.includes('--quiet')) console.log(`[ensure-daemon] ready on :${PORT}`);
  process.exit(0);
}

main().catch(err => {
  console.error(`[ensure-daemon] ERROR ${err.message}`);
  process.exit(1);
});

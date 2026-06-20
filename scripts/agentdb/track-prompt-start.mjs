#!/usr/bin/env node
// UserPromptSubmit-Hook: triggert /trajectory/start im Daemon und persistiert
// trajectory_id für den späteren Stop-Hook. Idempotent — vorheriger Stop wird
// erzwungen falls neuer Prompt vor altem Stop kommt.

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';

const STATE_FILE = join(os.homedir(), '.claude', 'agentdb', 'current-trajectory.json');
const DAEMON_URL = 'http://127.0.0.1:7878';

// Read prompt from stdin (UserPromptSubmit-Hook-Convention)
let stdinData = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdinData += chunk;
let payload = {};
try { payload = JSON.parse(stdinData); } catch { /* not JSON, treat as raw prompt */ }
const prompt = payload.prompt || payload.user_prompt || stdinData.slice(0, 500);

if (!prompt || prompt.length < 5) process.exit(0);  // silent skip

// Ensure Daemon (synchronously block until ready; quiet mode)
async function ensureDaemonRunning() {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1000);
    const r = await fetch(`${DAEMON_URL}/healthz`, { signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) return true;
  } catch { /* not running */ }

  // Spawn detached
  const child = spawn(process.execPath, [join(import.meta.dirname, 'server.mjs')], {
    detached: true, stdio: 'ignore', windowsHide: true,
    env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--use-system-ca' },
  });
  child.unref();

  // Wait up to 15s for ready
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 200));
    try {
      const r = await fetch(`${DAEMON_URL}/healthz`);
      if (r.ok) return true;
    } catch { /* wait */ }
  }
  return false;
}

const ready = await ensureDaemonRunning();
if (!ready) process.exit(0);  // silent — Hook darf User-Prompt nicht blockieren

// Force-end vorherige Trajectory wenn noch offen
if (existsSync(STATE_FILE)) {
  try {
    const prev = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (prev.trajectory_id && !prev.ended_at) {
      await fetch(`${DAEMON_URL}/trajectory/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trajectory_id: prev.trajectory_id,
          verdict: 'abandoned',
          verdict_source: 'auto',
          summary: 'New prompt received before previous trajectory ended',
        }),
      });
    }
  } catch { /* silent */ }
}

// Start new trajectory
try {
  const res = await fetch(`${DAEMON_URL}/trajectory/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, set_version: 17 }),
  });
  const data = await res.json();
  if (data.trajectory_id) {
    writeFileSync(STATE_FILE, JSON.stringify({
      trajectory_id: data.trajectory_id,
      prompt_hash: data.prompt_hash,
      started_at: Math.floor(Date.now() / 1000),
      prompt_excerpt: prompt.slice(0, 200),
      ended_at: null,
    }), 'utf8');
  }
} catch { /* silent */ }

process.exit(0);

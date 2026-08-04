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
// Exit-Codes: 0 = daemon running, 1 = failed to start ODER startup timeout.
//
// WICHTIG: hier darf NIE mit 2 terminiert werden. Dieses Script steht als
// Schritt 0 in mehreren Agent-Definitionen, und Exit 2 aus einem
// UserPromptSubmit-Hook LOESCHT den Prompt des Users. Ein nicht startender
// Daemon ist ein Telemetrie-Ausfall, kein Grund, Eingaben wegzuwerfen.
//
// Ebenso: alle Ausgaben gehen auf stderr. stdout eines UserPromptSubmit-Hooks
// wird bei Exit 0 in den Prompt-Kontext injiziert — Startmeldungen haetten
// dort nichts zu suchen.

import { spawn } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, statSync, unlinkSync } from 'node:fs';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.AGENTDB_PORT || '7878', 10);
const HEALTHZ_URL = `http://127.0.0.1:${PORT}/healthz`;
const STARTUP_TIMEOUT_MS = 15000;  // Cold-Start fastembed ~1s + WAL-init etc.
const HEALTH_POLL_INTERVAL_MS = 200;
const STATE_DIR = join(os.homedir(), '.claude', 'agentdb');
const LOCK_FILE = join(STATE_DIR, 'daemon.lock');
const LOG_FILE = join(STATE_DIR, 'daemon.log');
const LOCK_STALE_MS = 60000;

const log = (msg) => { if (!process.argv.includes('--quiet')) console.error(msg); };

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

// Verhindert, dass mehrere gleichzeitig startende Aufrufer (Prompt-Hook plus
// zwei parallel laufende Review-Subagents) je einen Daemon spawnen. Der Port
// selbst ist zwar auch ein Mutex (server.mjs beendet sich bei EADDRINUSE),
// aber erst NACHDEM ~300MB Modell geladen wurden — auf einer Maschine, die
// gerade ohnehin unter Last steht. Der Lock spart diese Ladungen ganz.
function acquireSpawnLock() {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    if (existsSync(LOCK_FILE)) {
      const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
      // Ein Lock vom abgestuerzten Vorgaenger darf nicht ewig blockieren.
      if (age < LOCK_STALE_MS) return false;
      unlinkSync(LOCK_FILE);
    }
    // 'wx' schlaegt fehl wenn die Datei zwischen Check und Write entsteht.
    writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseSpawnLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

async function spawnDaemon() {
  const serverPath = resolve(__dirname, 'server.mjs');
  // Frueher stdio:'ignore' — Startfehler des Daemons waren damit unsichtbar,
  // sichtbar war nur ein Timeout ohne Ursache. Jetzt haengen stdout+stderr
  // an einer Log-Datei.
  let out = 'ignore';
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    out = openSync(LOG_FILE, 'a');
  } catch {}
  // detached: true + unref() → Daemon überlebt Parent-Exit. Windows-kompatibel.
  const child = spawn(process.execPath, [serverPath], {
    detached: true,
    stdio: out === 'ignore' ? 'ignore' : ['ignore', out, out],
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

function checkDailyExport() {
  // Triggert export-jsonl.mjs wenn letzter Export >24h alt.
  // Detached spawn damit ensure-daemon nicht auf Export-Completion wartet.
  try {
    const stateDir = join(os.homedir(), '.claude', 'agentdb');
    if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
    const stampFile = join(stateDir, 'last-export.txt');
    const now = Math.floor(Date.now() / 1000);
    let lastExport = 0;
    if (existsSync(stampFile)) {
      try { lastExport = parseInt(readFileSync(stampFile, 'utf8').trim(), 10) || 0; } catch {}
    }
    const ageHours = (now - lastExport) / 3600;
    if (ageHours >= 24) {
      const exportPath = resolve(__dirname, 'export-jsonl.mjs');
      const child = spawn(process.execPath, [exportPath], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--use-system-ca' },
      });
      child.unref();
      writeFileSync(stampFile, String(now), 'utf8');
      log(`[ensure-daemon] daily-export triggered (last ${ageHours.toFixed(1)}h ago)`);
    }
  } catch (err) {
    log(`[ensure-daemon] export check failed: ${err.message}`);
  }
}

async function main() {
  // Schon up?
  if (await checkHealth()) {
    log(`[ensure-daemon] already running on :${PORT}`);
    checkDailyExport();
    process.exit(0);
  }

  // Spawnen
  if (!acquireSpawnLock()) {
    log('[ensure-daemon] spawn already in progress elsewhere, waiting');
  } else {
    const pid = await spawnDaemon();
    log(`[ensure-daemon] spawned PID ${pid}, waiting for /healthz...`);
  }

  // Polling-Wait
  const ready = await waitReady(Date.now() + STARTUP_TIMEOUT_MS);
  releaseSpawnLock();
  if (!ready) {
    // Exit 1, nicht 2 — siehe Kopfkommentar. Exit 2 aus einem Hook loescht
    // den User-Prompt; ein fehlender Daemon darf das nie ausloesen.
    console.error(`[ensure-daemon] FAIL — daemon not ready after ${STARTUP_TIMEOUT_MS}ms`);
    process.exit(1);
  }
  log(`[ensure-daemon] ready on :${PORT}`);
  checkDailyExport();
  process.exit(0);
}

main().catch(err => {
  console.error(`[ensure-daemon] ERROR ${err.message}`);
  process.exit(1);
});

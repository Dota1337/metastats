#!/usr/bin/env node
// UserPromptSubmit-Hook: oeffnet eine Trajectory im Daemon und legt die
// trajectory_id fuer den Stop-Hook und fuer recall.mjs ab.
//
// Harte Regel dieses Scripts: es darf den Prompt des Users NIE spuerbar
// verzoegern und NIE blockieren.
//   - Exit immer 0. Exit 2 wuerde den Prompt loeschen.
//   - Kein Warten auf einen kalten Daemon. Frueher stand hier eine
//     15s-Polling-Schleife; ein toter Daemon hat damit jeden Prompt um 15s
//     verzoegert. Jetzt wird nur angestossen und sofort zurueckgekehrt — der
//     erste Prompt nach einem Kaltstart hat dann eben keine Trajectory.
//   - Nichts auf stdout: stdout eines UserPromptSubmit-Hooks wird bei Exit 0
//     in den Prompt-Kontext injiziert. Diagnose geht auf stderr.

import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import {
  stateFileFor, writeState, readState, pruneOldStates,
  readStdinJson, fetchJson, DAEMON_URL,
} from './lib/hook-state.mjs';

const HEALTHZ_TIMEOUT_MS = 250;

// Es gibt keine zentrale Set-Konstante im Repo; die faktische Quelle ist der
// Dateiname public/tft-assets-<N>.json. Hoechstes N gewinnt, damit der Wert
// beim naechsten Set nicht wieder haendisch nachgezogen werden muss.
function currentSetVersion() {
  try {
    const dir = join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), 'public');
    const sets = readdirSync(dir)
      .map((f) => /^tft-assets-(\d+)\.json$/.exec(f))
      .filter(Boolean)
      .map((m) => parseInt(m[1], 10));
    if (sets.length) return Math.max(...sets);
  } catch {}
  return null;
}

async function main() {
  const { payload, raw } = await readStdinJson();
  const prompt = payload.prompt || payload.user_prompt || raw.slice(0, 500);
  if (!prompt || prompt.length < 5) return;

  const stateFile = stateFileFor(payload.session_id);
  pruneOldStates();

  // Ein Fehlschlag hier ist ECONNREFUSED in wenigen Millisekunden; das
  // Timeout greift nur gegen einen haengenden (nicht toten) Daemon.
  let healthy = false;
  try {
    const h = await fetchJson(`${DAEMON_URL}/healthz`, {}, HEALTHZ_TIMEOUT_MS);
    healthy = h.status === 'ok';
  } catch {}

  if (!healthy) {
    // Anstossen und gehen. Der naechste Prompt findet den Daemon warm vor.
    try {
      const child = spawn(process.execPath, [join(import.meta.dirname, 'ensure-daemon.mjs'), '--quiet'], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || '--use-system-ca' },
      });
      child.unref();
    } catch {}
    return;
  }

  // Vorherige Trajectory derselben Session schliessen, falls der Stop-Hook
  // ausgefallen ist. Betrifft ausschliesslich die eigene Session-Datei.
  const prev = readState(stateFile);
  if (prev?.trajectory_id && !prev.ended_at) {
    try {
      await fetchJson(`${DAEMON_URL}/trajectory/end`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trajectory_id: prev.trajectory_id,
          verdict: 'abandoned',
          verdict_source: 'auto',
          summary: 'New prompt received before previous trajectory ended',
        }),
      }, 1000);
    } catch {}
  }

  try {
    const data = await fetchJson(`${DAEMON_URL}/trajectory/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, set_version: currentSetVersion() }),
    }, 1500);
    if (data.trajectory_id) {
      writeState(stateFile, {
        trajectory_id: data.trajectory_id,
        session_id: payload.session_id || null,
        prompt_hash: data.prompt_hash,
        started_at: Math.floor(Date.now() / 1000),
        prompt_excerpt: prompt.slice(0, 200),
        ended_at: null,
      });
    }
  } catch {}
}

main()
  .catch((err) => { console.error(`[track-start] ${err.message}`); })
  .finally(() => process.exit(0));

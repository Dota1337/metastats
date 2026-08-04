// Gemeinsamer State-Layer der beiden Trajectory-Hooks und von recall.mjs.
//
// Warum session-scoped: frueher lag der State in EINER globalen Datei
// current-trajectory.json. Zwei parallel laufende Claude-Sessions (oder auch
// nur zwei parallel gespawnte Review-Subagents) haben sich darin gegenseitig
// ueberschrieben — der Stop-Hook der einen Session beendete die Trajectory der
// anderen. Der Fehlerzustand war nicht Datenverlust, sondern etwas
// Schlimmeres: korrekt aussehende Zeilen mit falschem Inhalt im Recall-Graph.
// Beobachtet am 04.08.: vier 'abandoned' innerhalb von zwei Sekunden.

import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

export const STATE_DIR = join(os.homedir(), '.claude', 'agentdb');
export const DAEMON_URL = `http://127.0.0.1:${process.env.AGENTDB_PORT || 7878}`;
const MAX_STATE_AGE_MS = 24 * 60 * 60 * 1000;

// session_id kommt aus dem Hook-Payload und landet in einem Dateinamen —
// alles ausserhalb dieser Zeichenklasse wird ersetzt, damit kein '..' oder
// Pfadtrenner durchkommt.
export function stateFileFor(sessionId) {
  const safe = String(sessionId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return join(STATE_DIR, `current-trajectory.${safe}.json`);
}

// tmp + rename: ein waehrend des Schreibens gekillter Hook (Timeout) darf kein
// halb geschriebenes JSON hinterlassen, das jeder spaetere Leser wegwirft.
export function writeState(file, obj) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj), 'utf8');
  renameSync(tmp, file);
}

export function readState(file) {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function clearState(file) {
  try { unlinkSync(file); } catch {}
}

// Sessions enden auch mal ohne Stop-Hook (Crash, Kill). Ohne das hier waechst
// das Verzeichnis unbegrenzt mit toten Session-Dateien.
export function pruneOldStates() {
  try {
    const now = Date.now();
    for (const name of readdirSync(STATE_DIR)) {
      if (!name.startsWith('current-trajectory.')) continue;
      const p = join(STATE_DIR, name);
      try {
        if (now - statSync(p).mtimeMs > MAX_STATE_AGE_MS) unlinkSync(p);
      } catch {}
    }
  } catch {}
}

// Hooks bekommen ihren Payload auf stdin. Ohne Timeout blockiert ein Aufruf
// ohne angeschlossenes stdin (manueller Test, fremder Aufrufer) fuer immer —
// und mit ihm der Prompt des Users.
export async function readStdinJson(timeoutMs = 500) {
  const collect = (async () => {
    let data = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) data += chunk;
    return data;
  })();
  const raw = await Promise.race([
    collect,
    new Promise((r) => setTimeout(() => r(''), timeoutMs)),
  ]);
  try { return { payload: JSON.parse(raw), raw }; } catch { return { payload: {}, raw }; }
}

export async function fetchJson(url, options = {}, timeoutMs = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: ctl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

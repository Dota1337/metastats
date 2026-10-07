#!/usr/bin/env node
// SessionStart-Hook: startet den Prozess-Waechter (process-watcher.mjs), falls
// auf diesem Rechner noch keiner laeuft, und senkt die Claude-Sitzung sofort —
// ihre Kinder erben die Prioritaet nur, wenn sie danach entstehen.
//
// Kein stdout: was ein SessionStart-Hook ausgibt, landet im Kontext.
// Endet immer mit 0: ein fehlender Waechter darf den Sitzungsstart nie
// blockieren. Notschalter: PROCESS_WATCHER=0.
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { waechterLebt } from './watcher-policy.mjs';
import { lebt, sperreLesen } from './process-watcher.mjs';

try {
  if (process.env.PROCESS_WATCHER !== '0' && process.platform === 'win32') {
    const claude = Number(process.env.CLAUDE_PID);
    if (claude > 0) {
      try { os.setPriority(claude, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* der Waechter holt es nach */ }
    }
    if (!waechterLebt(sperreLesen(), Date.now(), lebt)) {
      const skript = path.join(path.dirname(fileURLToPath(import.meta.url)), 'process-watcher.mjs');
      spawn(process.execPath, [skript], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  }
} catch { /* siehe Kopf: nie den Start blockieren */ }
process.exit(0);

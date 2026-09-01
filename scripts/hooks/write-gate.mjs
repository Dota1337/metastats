#!/usr/bin/env node
// PreToolUse-Gate auf jeden Schreibweg ins Projekt: Edit/Write/MultiEdit/
// NotebookEdit UND die Shell-Kanaele Bash + PowerShell.
//
// Warum neu und nicht plan-gate.mjs weiterbenutzt: das alte Gate deckte nur
// die Datei-Tools ab. Gemessen ueber 46 Transcripts: 4.567 Bash- und 161
// PowerShell-Aufrufe gegen 1.088 Edits und 284 Writes — die Seitentuer war
// groesser als die Vordertuer, und sie wurde beim Bau dieses Plans benutzt.
//
// Drei Eigenschaften, ohne die das Gate abgeschaltet werden wuerde:
//   1. Kill-Switch WRITE_GATE=0.
//   2. Rein lesend. Kein Schreiber auf den Session-State, deshalb keine
//      Lost-Update-Race gegen prompt-submit/answer-check (writeState ist
//      read-merge-write ohne Lock).
//   3. Fail-open bei jedem eigenen Fehler. Ein Gate, das wegen eines Bugs in
//      sich selbst alles sperrt, kostet mehr als es schuetzt.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_DIR, readInput, approvalStatus, PLAN_FILE } from './lib/state.mjs';
import { isExempt, toRel, planQuality, pathsWrittenByShell, denyText } from './lib/gate-policy.mjs';

function allow() { process.exit(0); }

if (process.env.WRITE_GATE === '0') allow();

let rel = '';
let input;
try {
  input = readInput();
  const tool = input?.tool_name || '';
  const ti = input?.tool_input || {};

  const candidates = [];
  if (ti.file_path) candidates.push({ path: ti.file_path, base: PROJECT_DIR });
  if (ti.notebook_path) candidates.push({ path: ti.notebook_path, base: PROJECT_DIR });
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (e?.file_path) candidates.push({ path: e.file_path, base: PROJECT_DIR });
  }
  if (/^(Bash|PowerShell)$/i.test(tool) && ti.command) {
    candidates.push(...pathsWrittenByShell(ti.command, PROJECT_DIR));
  }

  const blocked = candidates
    .map((c) => toRel(c.path, PROJECT_DIR, c.base))
    .filter((r) => !isExempt(r));

  if (!blocked.length) allow();
  // Leerer relativer Pfad heisst "der ganze Arbeitsbaum" (git reset --hard,
  // git clean) — im Deny-Text soll das lesbar sein, nicht leer.
  rel = [...new Set(blocked.map((r) => r || 'den Arbeitsbaum'))].join(', ');
} catch (err) {
  // Eigener Fehler ist kein Grund, die Arbeit des Users zu stoppen.
  process.stderr.write(`[write-gate] uebersprungen: ${err?.message || err}\n`);
  allow();
}

const status = approvalStatus(input.session_id);

if (status.ok) {
  // Der Trivial-Ausweg des Users haengt die Review-Pflicht mit ab.
  const trivial = /\b(trivial|spot-?fix)\b/i.test(String(status.state?.approvedBy || ''));
  const q = trivial ? { ok: true } : planQuality(PLAN_FILE);
  if (q.ok) allow();
  status.ok = false;
  status.reason = `Freigabe liegt vor, aber der Plan belegt keine Review: ${q.why}`;
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason: denyText(rel, status.reason, existsSync(resolve(PLAN_FILE))),
  },
}));
process.exit(0);

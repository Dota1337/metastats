#!/usr/bin/env node
// PreToolUse-Gate auf Edit/Write/MultiEdit/NotebookEdit.
//
// Das eigentliche Problem, gemessen ueber 6 Sessions: 216 Writes, 31
// Agent-Calls, aber nur 3 Writes vor dem ersten Agent-Call — der Plan kommt
// also meistens NACH dem Code. Und der `Code:`-Prefix, an dem der gesamte
// AGENTS.md-Workflow haengt, kam in 2 von 94 User-Messages vor. Ein Gate, das
// auf `Code:` triggert, feuert praktisch nie.
//
// Dieses Gate triggert stattdessen auf die Schreib-Aktion selbst und verlangt
// eine an eine Plan-Datei gebundene Freigabe.
//
// Absichtlich NICHT gesperrt (sonst wird das Gate zum Gateguard und
// abgeschaltet — siehe feedback_disable_gateguard.md):
//   - alles ausserhalb des Projekts (Scratchpad, Temp, Memory)
//   - .claude/ selbst, inkl. der Plan-Datei
//   - reine Doku-/Notiz-Dateien im Projekt (*.md ausserhalb von app/ + scripts/)
import { existsSync } from 'node:fs';
import { relative, isAbsolute, resolve } from 'node:path';
import { PROJECT_DIR, readInput, approvalStatus, PLAN_FILE } from './lib/state.mjs';

const input = readInput();
const file = input?.tool_input?.file_path || input?.tool_input?.notebook_path || '';

function allow() { process.exit(0); }

if (!file) allow();

const abs = isAbsolute(file) ? resolve(file) : resolve(PROJECT_DIR, file);
const rel = relative(PROJECT_DIR, abs).replace(/\\/g, '/');

// Ausserhalb des Projekts: geht das Gate nichts an.
if (rel.startsWith('..') || isAbsolute(rel)) allow();
// .claude/ (Plan-Datei, Settings, Agents) und .git/ sind Werkzeug, nicht Produkt.
if (rel.startsWith('.claude/') || rel.startsWith('.git/')) allow();
if (resolve(abs) === resolve(PLAN_FILE)) allow();
// Notizen und Doku ausserhalb des Codes: kein Plan noetig.
if (/\.(md|txt)$/i.test(rel) && !/^(app|scripts|infra)\//.test(rel)) allow();

const status = approvalStatus(input.session_id);
if (status.ok) allow();

const planExists = existsSync(PLAN_FILE);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'deny',
    permissionDecisionReason:
`Schreiben auf ${rel} ohne freigegebenen Plan blockiert (${status.reason}).

So kommst du weiter — in dieser Reihenfolge, ohne Abkuerzung:
1. Schreib den Plan nach .claude/plan-current.md${planExists ? ' (existiert bereits — ueberschreiben)' : ''}:
   Ziel in einem Satz · betroffene Dateien · >=3 Alternativen mit Trade-offs ·
   gewaehlte Option mit Begruendung · wie du das Ergebnis pruefst.
2. Zeig dem User den Kern des Plans (kurz) und WARTE auf Freigabe.
3. Der User gibt frei mit: go / ok / passt / freigabe / los.
   Erst dann oeffnet dieses Gate — automatisch, du musst nichts weiter tun.

Trivial-Ausweg (nur wenn es wirklich zutrifft): der User schreibt "trivial"
oder "spot-fix" in seinen Prompt. Das entscheidest NICHT du.`,
  },
}));
process.exit(0);

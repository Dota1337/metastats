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
//
// Seit Runde 10 (24.10.2026) faellt es LAUT offen aus: bis dahin waren die
// Bibliotheken statisch importiert, eine fehlende Datei oder ein Tippfehler
// darin liess den Hook mit Exit 1 sterben — Claude Code wertet das als
// nicht-blockierenden Fehler, jede Aenderung lief ungebremst und ungemeldet
// durch (gate-faellt-offen-bei-fehlender-datei). Jetzt wird jede Bibliothek
// einzeln geladen, und wer ungeprueft durchgelassen wird, erfaehrt es — der
// User ueber systemMessage, der Assistent ueber additionalContext.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Bewusst hier und nicht aus lib/state.mjs: ohne Eingabe und Projektordner
// kann das Gate nicht einmal melden, dass es kaputt ist.
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { input = {}; }

const tool = input?.tool_name || '';
const ti = input?.tool_input || {};
const SCHREIB_TOOLS = /^(Edit|Write|MultiEdit|NotebookEdit|Bash|PowerShell)$/i;

function allow() { process.exit(0); }

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  }));
  process.exit(0);
}

/** Durchlassen, aber laut. Ohne permissionDecision: der normale Ablauf entscheidet. */
function lautDurch(was, err) {
  const grund = String(err?.message || err || 'unbekannt').split('\n')[0].slice(0, 200);
  process.stdout.write(JSON.stringify({
    systemMessage: `[metastats] Schreib-Gate defekt (${was}: ${grund}) — ${tool} wurde UNGEPRUEFT durchgelassen.`,
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: `Das Schreib-Gate konnte ${was} nicht laden (${grund}) und hat diesen ${tool}-Aufruf ungeprueft durchgelassen. Repariere scripts/hooks/ zuerst (der Ordner ist frei schreibbar) und sag dem User diesen Befund, bevor du weiter am Projekt aenderst.`,
    },
  }));
  process.exit(0);
}

// Schritt 1: Suchsperre (eigener Notschalter SEARCH_GATE=0). Steht vor dem
// WRITE_GATE-Schalter, weil sie auch mit abgeschaltetem Plan-Gate gelten soll —
// eine Suche durch node_modules bremst das Spiel des Users unabhaengig davon,
// ob gerade ein Plan freigegeben ist (Vorfall 07.10.2026). Ein Fehler hier darf
// die Schreibsperre darunter nicht mitnehmen.
if (process.env.SEARCH_GATE !== '0') {
  let v = null;
  let sp = null;
  try {
    sp = await import('./lib/search-policy.mjs');
    v = sp.checkSearch(tool, ti.command, input?.cwd || PROJECT_DIR, { projectDir: PROJECT_DIR });
  } catch (err) {
    process.stderr.write(`[write-gate] Suchsperre uebersprungen: ${err?.message || err}\n`);
  }
  if (v) deny(sp.searchDenyText(v));
}

if (process.env.WRITE_GATE === '0') allow();
if (!SCHREIB_TOOLS.test(tool)) allow();

let gp;
let st;
// Literale Pfade, damit check-hook-load.mjs sie findet und gegen die Exporte
// prueft — vor dem Hochladen und bei jedem Sitzungsstart.
try { gp = await import('./lib/gate-policy.mjs'); } catch (err) { lautDurch('lib/gate-policy.mjs', err); }
try { st = await import('./lib/state.mjs'); } catch (err) { lautDurch('lib/state.mjs', err); }

let rel = '';
try {
  const candidates = [];
  if (ti.file_path) candidates.push({ path: ti.file_path, base: PROJECT_DIR });
  if (ti.notebook_path) candidates.push({ path: ti.notebook_path, base: PROJECT_DIR });
  if (Array.isArray(ti.edits)) {
    for (const e of ti.edits) if (e?.file_path) candidates.push({ path: e.file_path, base: PROJECT_DIR });
  }
  if (/^(Bash|PowerShell)$/i.test(tool) && ti.command) {
    // Arbeitsordner des Befehls: relative Ziele wie `../app/x.ts` nach einem
    // frueheren `cd scripts` gelten sonst als ausserhalb des Projekts
    // (schreibziel-ohne-arbeitsordner, 24.10.2026).
    candidates.push(...gp.pathsWrittenByShell(ti.command, PROJECT_DIR, undefined, 0, {
      base: input?.cwd || PROJECT_DIR,
      shell: /^PowerShell$/i.test(tool) ? 'pwsh' : 'bash',
    }));
  }

  const blocked = candidates
    .map((c) => gp.toRel(c.path, PROJECT_DIR, c.base))
    .filter((r) => !gp.isExempt(r));

  if (!blocked.length) allow();
  // Leerer relativer Pfad heisst "der ganze Arbeitsbaum" (git reset --hard,
  // git clean) — im Deny-Text soll das lesbar sein, nicht leer.
  rel = [...new Set(blocked.map((r) => r || 'den Arbeitsbaum'))].join(', ');
} catch (err) {
  // Eigener Fehler ist kein Grund, die Arbeit des Users zu stoppen — aber
  // einer, ihn zu melden.
  lautDurch('die Pfad-Pruefung', err);
}

let status;
try {
  status = st.approvalStatus(input.session_id);
  if (status.ok) {
    // Der Trivial-Ausweg des Users haengt die Review-Pflicht mit ab.
    const q = st.isTrivialApproval(status.state) ? { ok: true } : gp.planQuality(st.PLAN_FILE);
    if (q.ok) allow();
    status.ok = false;
    status.reason = `Freigabe liegt vor, aber der Plan belegt keine Review: ${q.why}`;
  }
} catch (err) {
  lautDurch('die Freigabe-Pruefung', err);
}

deny(gp.denyText(rel, status.reason, existsSync(resolve(st.PLAN_FILE))));

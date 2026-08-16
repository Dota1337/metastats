#!/usr/bin/env node
// SessionStart-Hook.
//
// Zweck 1: das Tier-1-Memory-Bundle automatisch laden. Bisher musste der User
// jede Session mit „lade memory" anfangen — eine Regel, die davon abhaengt,
// dass ein Mensch sie befolgt, ist keine Regel.
//
// Zweck 2: einmal pro Woche den Drift-Audit fahren und das Ergebnis zeigen.
// Ohne Messung merkt niemand, dass die Disziplin-Hooks wieder abgeschaltet
// oder umgangen wurden.
//
// Der Hook beendet sich IMMER mit 0. Ein kaputter SessionStart-Hook, der die
// Session blockiert, wird binnen einer Woche deaktiviert — und dann ist gar
// nichts mehr da.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PROJECT_DIR, readInput, readState, writeState, pruneOldState, clearApproval, readGlobal, writeGlobal, APPROVAL_SURVIVES_COMPACT } from './lib/state.mjs';

const input = readInput();
const source = String(input.source || '');
const sessionId = input.session_id;

// Bei `resume` ist der Kontext noch da — das Bundle nochmal einzuspielen waere
// reine Verdopplung. startup und clear brauchen es.
const wantsMemory = source !== 'resume';

const parts = [];
const notes = [];

// --- Tier-1-Memory-Bundle -------------------------------------------------
const home = process.env.USERPROFILE || process.env.HOME || '';
const slug = PROJECT_DIR.replace(/[:\\/]/g, '-');
const memDir = join(home, '.claude', 'projects', slug, 'memory');
const bundle = join(memDir, '_TIER1_BUNDLE.md');

if (wantsMemory && existsSync(memDir)) {
  // Das Bundle ist generiert; ohne Rebuild spielt der Hook eventuell einen
  // veralteten Stand ein. Fehler hier sind egal — dann kommt der alte Stand.
  try {
    execFileSync(process.execPath, ['_build-bundle.mjs'], { cwd: memDir, timeout: 20_000, stdio: 'ignore' });
  } catch { /* Bundle bleibt wie es ist */ }

  if (existsSync(bundle)) {
    const text = readFileSync(bundle, 'utf8');
    parts.push(`<memory-tier1 source="${bundle}">\n${text}\n</memory-tier1>`);
    notes.push(`Tier-1-Memory geladen (${Math.round(text.length / 1024)} KB)`);
  } else {
    notes.push('Tier-1-Bundle nicht gefunden — Memory NICHT geladen');
  }
}

// --- Kernregeln ans Ende des Kontexts -------------------------------------
const rules = join(PROJECT_DIR, 'infra', 'claude-settings', 'discipline.md');
if (existsSync(rules)) {
  parts.push(readFileSync(rules, 'utf8'));
}

// --- Freigabe-Zustand ------------------------------------------------------
// Eine neue Session startet ohne Freigabe: startup, clear und resume sind
// menschlich gesetzte Grenzen mit beliebig langer Luecke davor.
//
// Der Compact ist keine solche Grenze, sondern eine Kontextfenster-Mechanik —
// er feuert hier mit source="compact" VOR dem PostCompact-Hook. Ihn wie einen
// Sessionstart zu behandeln hat die Freigabe mitten in laufender Arbeit
// getoetet (gemessen: 14 Compacts in einer Session). Der Plan kommt in
// post-compact.mjs zurueck in den Kontext, die Wachen in approvalStatus()
// (Plan-Hash, beide Prompt-Deckel) bleiben scharf.
//
// Ausnahme von der Ausnahme: eine Freigabe OHNE Plan-Bindung (Trivial-Ausweg)
// hat keine Themengrenze und stirbt weiterhin am Compact.
if (sessionId) {
  if (source === 'compact' && APPROVAL_SURVIVES_COMPACT) {
    const s = readState(sessionId);
    if (s.approvedAt && s.planHash) {
      writeState(sessionId, { survivedCompact: true });
      notes.push('Plan-Freigabe ueber den Compact hinweg erhalten');
    } else if (s.approvedAt) {
      clearApproval(sessionId, 'Compact — Freigabe ohne Plan-Bindung verfaellt');
    }
  } else {
    clearApproval(sessionId, `Session-Start (${source || 'unbekannt'})`);
  }
}
pruneOldState();

// --- Woechentlicher Drift-Audit -------------------------------------------
const g = readGlobal();
const lastAudit = g.lastAuditRun ? Date.parse(g.lastAuditRun) : 0;
if (source === 'startup' && Date.now() - lastAudit > 7 * 864e5) {
  try {
    const out = execFileSync(process.execPath, [join(PROJECT_DIR, 'scripts', 'drift-audit.mjs')], {
      cwd: PROJECT_DIR, timeout: 60_000, encoding: 'utf8',
    });
    parts.push(`<drift-audit hinweis="woechentlicher Compliance-Report. Zeig dem User die GESAMT-Zeile und sag, ob sich die Werte gegen die Baseline verbessert oder verschlechtert haben.">\n${out}\n</drift-audit>`);
    notes.push('Wochen-Drift-Audit gelaufen');
    writeGlobal({ lastAuditRun: new Date().toISOString() });
  } catch {
    // Kein Transcript, kein Node, egal — der Audit ist Diagnose, kein Gate.
  }
}

process.stdout.write(JSON.stringify({
  systemMessage: notes.length ? `[metastats] ${notes.join(' · ')}` : undefined,
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: parts.join('\n\n'),
  },
}));
process.exit(0);

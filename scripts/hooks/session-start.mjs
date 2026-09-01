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
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

// Zustellung laeuft NICHT mehr ueber diesen Hook. Am 2026-09-01 im CLI-Binary
// gemessen: `additionalContext` ueber 10.000 Zeichen (LlK=1e4) wird in eine
// Datei ausgelagert, nur 2.000 Zeichen (KQH=2000) erreichen den Kontext. Das
// Bundle ist ~64 KB — es kam also nie an, ohne dass irgendwas gemeldet haette.
// Der Hook baut jetzt nur noch `.claude/rules/tier1-*.md`; die laedt Claude
// Code selbst als Projekt-Instruktion in den stabilen Prefix.
const rulesDir = join(PROJECT_DIR, '.claude', 'rules');

if (wantsMemory && existsSync(memDir)) {
  try {
    execFileSync(process.execPath, ['_build-bundle.mjs', '--rules-dir', rulesDir], {
      cwd: memDir, timeout: 20_000, stdio: 'ignore',
    });
  } catch {
    notes.push('FEHLER: Regel-Build fehlgeschlagen — .claude/rules koennte veraltet sein');
  }

  // Verifizieren statt annehmen: die Teile muessen existieren und juenger sein
  // als die neueste Quelldatei, sonst laedt Claude Code einen alten Stand.
  let parts1 = [];
  try {
    parts1 = readdirSync(rulesDir).filter((f) => f.startsWith('tier1-') && f.endsWith('.md'));
  } catch { /* Ordner fehlt */ }

  if (!parts1.length) {
    notes.push('FEHLER: keine .claude/rules/tier1-*.md — Tier-1-Regeln sind NICHT geladen');
  } else {
    const bytes = parts1.reduce((a, f) => a + statSync(join(rulesDir, f)).size, 0);
    const oldest = Math.min(...parts1.map((f) => statSync(join(rulesDir, f)).mtimeMs));
    const srcNewest = Math.max(...readdirSync(memDir)
      .filter((f) => f.endsWith('.md') && !f.startsWith('_'))
      .map((f) => statSync(join(memDir, f)).mtimeMs));
    if (srcNewest > oldest + 5_000) {
      notes.push('FEHLER: .claude/rules ist aelter als die Memory-Quellen — Build haengt');
    } else {
      notes.push(`Tier-1-Regeln: ${parts1.length} Teile, ${Math.round(bytes / 1024)} KB (via .claude/rules)`);
    }
  }
  if (existsSync(bundle)) notes.push('Bundle-Fallback vorhanden');
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

// --- Groessenbremse --------------------------------------------------------
// Harte Grenze der Zustellung, im CLI-Binary gemessen (2026-09-01):
// `additionalContext` laenger als 10.000 Zeichen wird in eine Datei ausgelagert
// und nur die ersten 2.000 Zeichen erreichen den Kontext — lautlos. Genau so
// ist das 64-KB-Bundle monatelang verschwunden. Ab jetzt schlaegt es an:
// lieber ein sichtbarer Fehler als still zugestellte Regeln, die nie ankamen.
const HOOK_LIMIT = 10_000;
let context = parts.join('\n\n');
if (context.length > HOOK_LIMIT) {
  const over = context.length;
  context = [
    'FEHLER — SessionStart-Hook ueber der Zustellgrenze.',
    `Der Hook wollte ${over} Zeichen einspielen, die Grenze liegt bei ${HOOK_LIMIT}.`,
    'Darueber landet alles in einer Datei und nur 2.000 Zeichen erreichen den Kontext.',
    'Der Inhalt wurde deshalb NICHT eingespielt. Sag dem User zuerst diesen Satz,',
    'bevor du irgendetwas anderes tust: der SessionStart-Hook liefert zu viel und',
    'muss in scripts/hooks/session-start.mjs gekuerzt werden.',
  ].join('\n');
  notes.push(`FEHLER: Hook-Kontext ${over} > ${HOOK_LIMIT} Zeichen — nichts eingespielt`);
}

process.stdout.write(JSON.stringify({
  systemMessage: notes.length ? `[metastats] ${notes.join(' · ')}` : undefined,
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: context,
  },
}));
process.exit(0);

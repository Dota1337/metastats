// Gemeinsamer Zustand der Disziplin-Hooks.
//
// Warum unter .git/ und nicht unter .claude/: .claude/ ist auf dieser
// Workstation ein Symlink in einen Dropbox-Ordner (siehe Kommentarkopf in
// infra/claude-settings/hooks.json — dort ist am 28.06. schon einmal eine
// Konfiguration in einer Conflicted Copy verschwunden). Der Freigabe-Zustand
// darf NICHT zwischen Rechnern syncen: eine Freigabe gilt fuer genau eine
// Session auf genau einer Maschine. .git/ ist garantiert lokal, wird nie
// committed und ueberlebt `git reset --hard`.
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

export const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const STATE_DIR = join(PROJECT_DIR, '.git', 'metastats-discipline');

/** Plan-Datei, an die eine Freigabe gebunden ist. Liegt in .claude/ (lokal). */
export const PLAN_FILE = join(PROJECT_DIR, '.claude', 'plan-current.md');

/**
 * Freigabe verfaellt nach so vielen User-Prompts. Gemessen (6 Sessions):
 * 216 Writes auf 94 User-Messages = 2,3 Writes pro Prompt. Eine
 * session-weite Freigabe waere damit ein Freibrief fuer alles Folgende.
 * 8 Prompts sind grosszuegig genug, dass ein normaler Umsetzungs-Block
 * nicht mittendrin abbricht, und eng genug, dass die Freigabe nicht drei
 * Themen ueberdauert.
 */
export const MAX_PROMPTS_PER_APPROVAL = 8;

function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
  return join(STATE_DIR, `${safe || 'unknown'}.json`);
}

function ensureDir() {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
}

export function readState(sessionId) {
  try {
    return JSON.parse(readFileSync(statePath(sessionId), 'utf8'));
  } catch {
    return {};
  }
}

export function writeState(sessionId, patch) {
  ensureDir();
  const next = { ...readState(sessionId), ...patch };
  writeFileSync(statePath(sessionId), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

export function clearApproval(sessionId, why) {
  writeState(sessionId, { approvedAt: null, planHash: null, promptsSinceApproval: 0, clearedBy: why || null });
}

/** Globaler (nicht session-gebundener) Zustand — z.B. wann der Drift-Audit zuletzt lief. */
export function readGlobal() {
  try {
    return JSON.parse(readFileSync(join(STATE_DIR, '_global.json'), 'utf8'));
  } catch {
    return {};
  }
}

export function writeGlobal(patch) {
  ensureDir();
  const next = { ...readGlobal(), ...patch };
  writeFileSync(join(STATE_DIR, '_global.json'), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return next;
}

/** Hash des aktuellen Plan-Files. null wenn kein Plan existiert. */
export function planHash() {
  try {
    return createHash('sha1').update(readFileSync(PLAN_FILE)).digest('hex').slice(0, 12);
  } catch {
    return null;
  }
}

/**
 * Gilt die Freigabe noch? Vier Verfallsgruende, alle mechanisch:
 *   1. es gab nie eine
 *   2. Compact hat sie geloescht (PreCompact-Hook)
 *   3. mehr als MAX_PROMPTS_PER_APPROVAL User-Prompts seither
 *   4. die Plan-Datei wurde nach der Freigabe geaendert (Hash-Drift)
 */
export function approvalStatus(sessionId) {
  const s = readState(sessionId);
  if (!s.approvedAt) return { ok: false, reason: s.clearedBy || 'keine Freigabe fuer diese Session' };
  if ((s.promptsSinceApproval || 0) > MAX_PROMPTS_PER_APPROVAL) {
    return { ok: false, reason: `Freigabe abgelaufen (${s.promptsSinceApproval} Prompts seit der Freigabe, Limit ${MAX_PROMPTS_PER_APPROVAL})` };
  }
  const now = planHash();
  if (s.planHash && now && s.planHash !== now) {
    return { ok: false, reason: 'Plan-Datei wurde nach der Freigabe geaendert — der User hat diesen Plan nicht freigegeben' };
  }
  return { ok: true, state: s };
}

/** Alte Session-Dateien aufraeumen (>14 Tage). Laeuft beim SessionStart. */
export function pruneOldState() {
  if (!existsSync(STATE_DIR)) return;
  const cutoff = Date.now() - 14 * 864e5;
  for (const f of readdirSync(STATE_DIR)) {
    if (f === '_global.json') continue;
    const p = join(STATE_DIR, f);
    try {
      if (statSync(p).mtimeMs < cutoff) rmSync(p);
    } catch { /* egal */ }
  }
}

/** stdin als JSON lesen. Bei jedem Fehler {} — ein Hook darf nie die Session kippen. */
export function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return {};
  }
}

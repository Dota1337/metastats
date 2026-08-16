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

/**
 * Absoluter Deckel: so viele User-Prompts nach der ERSTEN Freigabe eines
 * Themas, unabhaengig davon wie oft zwischendurch „ok" faellt.
 *
 * Warum es den zusaetzlich zu MAX_PROMPTS_PER_APPROVAL braucht: jedes „ok"
 * setzt in prompt-submit.mjs `promptsSinceApproval` auf 0 zurueck. Solange der
 * Compact eine Freigabe toetete, war er der faktische Endpunkt (gemessen: 20
 * Compacts in 6 Sessions). Faellt der weg, ist das 8er-Fenster kein Deckel
 * mehr, sondern eines das sich selbst nachfuellt. 30 ist grosszuegig genug fuer
 * einen mehrstuendigen Umsetzungsblock und eng genug, dass eine Freigabe nicht
 * eine ganze Session ueberdauert.
 */
export const MAX_PROMPTS_PER_TOPIC = 30;

/**
 * Ueberlebt eine Freigabe den Compact? Der eine Schalter fuer den gesamten
 * Umbau vom 2026-08-16 — auf `false` ist das alte Verhalten zurueck (Freigabe
 * verfaellt bei jedem Compact), ohne dass irgendwo sonst etwas zu aendern ist.
 *
 * Der urspruengliche Loeschgrund war nicht „Compact ist gefaehrlich", sondern
 * „der Plan ist danach nicht mehr im Kontext". Seit post-compact.mjs den Plan
 * wieder einspielt, faellt der Grund weg. `resume`, `startup` und `clear`
 * loeschen weiterhin: das sind menschlich gesetzte Sessiongrenzen mit beliebig
 * langer Luecke, der Compact ist eine reine Kontextfenster-Mechanik.
 */
export const APPROVAL_SURVIVES_COMPACT = true;

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
 * Gilt die Freigabe noch? Fuenf Verfallsgruende, alle mechanisch:
 *   1. es gab nie eine
 *   2. Sessiongrenze hat sie geloescht (startup / clear / resume; Compact nur
 *      noch wenn APPROVAL_SURVIVES_COMPACT auf false steht)
 *   3. mehr als MAX_PROMPTS_PER_APPROVAL User-Prompts seit der letzten Freigabe
 *   4. mehr als MAX_PROMPTS_PER_TOPIC User-Prompts seit der ERSTEN Freigabe
 *      dieses Themas — den setzt kein „ok" zurueck
 *   5. Plan-Bindung kaputt: Datei nach der Freigabe geaendert (Hash-Drift) ODER
 *      es gab bei der Freigabe gar keinen Plan
 */
export function approvalStatus(sessionId) {
  const s = readState(sessionId);
  if (!s.approvedAt) return { ok: false, reason: s.clearedBy || 'keine Freigabe fuer diese Session' };
  if ((s.promptsSinceApproval || 0) > MAX_PROMPTS_PER_APPROVAL) {
    return { ok: false, reason: `Freigabe abgelaufen (${s.promptsSinceApproval} Prompts seit der Freigabe, Limit ${MAX_PROMPTS_PER_APPROVAL})` };
  }
  if ((s.promptsSinceFirstApproval || 0) > MAX_PROMPTS_PER_TOPIC) {
    return { ok: false, reason: `Freigabe abgelaufen (${s.promptsSinceFirstApproval} Prompts seit der ersten Freigabe zu diesem Plan, Limit ${MAX_PROMPTS_PER_TOPIC}) — leg den Plan neu vor` };
  }
  // Eine Freigabe ohne Plan-Bindung (Trivial-Ausweg, kein Plan vorhanden) hat
  // keine Themengrenze ausser der Session selbst. Innerhalb einer Sitzung ist
  // das gewollt; ueber einen Compact hinweg darf sie NICHT weiterleben — sonst
  // ueberdauert der Ausweg genau die Grenze, die ihn bisher beendet hat.
  // Belegt in .git/metastats-discipline/280fe6e6-….json: approvedAt gesetzt,
  // planHash null. session-start.mjs raeumt solche Freigaben beim Compact ab;
  // die Wache hier ist der zweite Boden.
  const now = planHash();
  if (s.survivedCompact && !s.planHash) {
    return { ok: false, reason: 'Freigabe ohne Plan-Bindung ueberlebt keinen Compact' };
  }
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

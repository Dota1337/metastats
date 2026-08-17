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
import { existsSync, readFileSync } from 'node:fs';
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
// Regel- und Spec-Prosa unter infra/: Text, kein Code. User-Entscheidung vom
// 2026-08-17, nachdem das Gate einen 3-Zeilen-Prosa-Edit an discipline.md mit
// voller 3-Alternativen-plus-Multi-Review-Pflicht belegt hat. Der logic-flow-
// critic hat widersprochen (discipline.md liest sich der Assistant jeden Turn
// selbst ein, also selbstgeschriebene Regeln ohne User-Signatur); der User hat
// die Freistellung danach bestaetigt. infra/claude-agents/ bleibt bewusst
// GESPERRT — die Dateien definieren das Verhalten der Reviewer selbst.
if (/^infra\/(claude-settings|specs)\/.+\.md$/i.test(rel)) allow();

const status = approvalStatus(input.session_id);

// Eine Freigabe allein reicht nicht. Gemessen ueber 6 Sessions: 216 Writes bei
// 31 Agent-Calls — die Multi-Review aus AGENTS.md wird nicht durch fehlende
// Freigabe umgangen, sondern DURCH sie: einmal "go", danach beliebig viele
// Writes ohne dass je ein Review stattgefunden haette. Der Plan muss deshalb
// belegen, dass er reviewt wurde. Rein lesend — kein zusaetzlicher Schreiber
// auf den Session-State (sonst Lost-Update gegen prompt-submit/answer-check).
function planQuality() {
  let text;
  try {
    text = readFileSync(PLAN_FILE, 'utf8');
  } catch (err) {
    // Nur "Datei fehlt" ist ein Plan-Problem. Alles andere (Bug in diesem
    // Hook, Rechte, kaputter Symlink) darf sich NICHT als "kein Plan"
    // tarnen — genau das hat beim Bau dieser Aenderung 10 Minuten gekostet.
    if (err?.code === 'ENOENT') return { ok: false, why: 'keine Plan-Datei' };
    return { ok: true, note: `Plan-Pruefung uebersprungen: ${err?.message || err}` };
  }

  const hasVerdictHeading = /^#{1,4}\s*verdicts?\b/im.test(text);
  const AGENT = /\b(metastats-[a-z-]+|classification-reviewer|Explore)\b/i;
  const verdictLines = text.split('\n').filter(l => AGENT.test(l) && /[-*|]/.test(l.trim()[0] || ''));
  if (!hasVerdictHeading || !verdictLines.length) {
    return { ok: false, why: 'kein "## Verdicts"-Block mit mindestens einem Agent-Verdict' };
  }

  // >=3 Alternativen: entweder Datenzeilen einer Tabelle oder nummerierte Liste.
  const tableRows = text.split('\n').filter(l => /^\s*\|/.test(l) && !/^\s*\|[\s|:-]+\|?\s*$/.test(l)).length;
  const numbered = (text.match(/^\s*(\d+[.)]|[A-C]\))\s+\S/gm) || []).length;
  if (Math.max(tableRows - 1, numbered) < 3) {
    return { ok: false, why: 'weniger als 3 Alternativen mit Trade-offs im Plan' };
  }
  return { ok: true };
}

if (status.ok) {
  // Der Trivial-Ausweg des Users haengt die Review-Pflicht mit ab.
  const trivial = /\b(trivial|spot-?fix)\b/i.test(String(status.state?.approvedBy || ''));
  const q = trivial ? { ok: true } : planQuality();
  if (q.ok) allow();
  status.ok = false;
  status.reason = `Freigabe liegt vor, aber der Plan belegt keine Review: ${q.why}`;
}

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
2. Spawne die passenden Review-Agents (AGENTS.md) und schreib ihre Verdicts
   unter eine Ueberschrift "## Verdicts" in denselben Plan — eine Zeile pro
   Agent, beginnend mit "- " oder in einer Tabelle. Ohne diesen Block oeffnet
   das Gate auch MIT Freigabe nicht.
3. Zeig dem User den Kern des Plans (kurz) und WARTE auf Freigabe.
4. Der User gibt frei mit: go / ok / passt / freigabe / los.
   Erst dann oeffnet dieses Gate — automatisch, du musst nichts weiter tun.

Trivial-Ausweg (nur wenn es wirklich zutrifft): der User schreibt "trivial"
oder "spot-fix" in seinen Prompt. Das entscheidest NICHT du.`,
  },
}));
process.exit(0);

#!/usr/bin/env node
/**
 * Letzter Schritt von tft-data-refresh.yml: Issue anlegen, ergaenzen oder schliessen,
 * danach den Lauf rot machen, wenn ein Schritt fehlschlug.
 *
 * Regeln (User 01.11.2026 „immer aktuell“, aber ohne Issue-Flut, Lauf alle 3 Stunden):
 * - Ein Schritt fehlgeschlagen: erst beim zweiten Mal in Folge melden. Tactics.tools
 *   oder CDragon sind oft nur kurz weg, die naechste Runde holt es nach.
 * - Veraltete Zahl (Melder) oder Patchtag-Alarm: sofort.
 * - Hoechstens ein offenes Issue. Kommentar nur, wenn sich der Befund geaendert hat.
 * - Geschlossen wird nur nach einem echten, sauberen Lauf: eine Runde ohne Arbeit hat
 *   nichts geprueft.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = 'tft-data-refresh';
const MARK = /<!-- befund:([0-9a-f]+) -->/;

/** Reine Entscheidung. Rueckgabe: { action, lines, mark }, action = none|create|comment|close. */
export function decideIssue({ ran, failures, findings, alarm, previousConclusion, openIssue, lastMark }) {
  const lines = [
    ...findings,
    ...(alarm ? [alarm] : []),
    ...(failures.length && previousConclusion === 'failure' ? failures : []),
  ];
  if (!lines.length) {
    const clean = ran && !failures.length && !alarm;
    return { action: clean && openIssue ? 'close' : 'none', lines, mark: null };
  }
  const mark = createHash('sha256').update([...lines].sort().join('\n')).digest('hex').slice(0, 12);
  if (!openIssue) return { action: 'create', lines, mark };
  return { action: mark === lastMark ? 'none' : 'comment', lines, mark };
}

/** Welche Schritte fehlschlugen. Der Melder zaehlt nur mit Fehler, nicht mit Befund. */
export function failedSteps(steps, melderLog) {
  const out = [];
  for (const [id, step] of Object.entries(steps ?? {})) {
    if (id === 'melder' || step?.outcome !== 'failure') continue;
    out.push(`Schritt ${id} fehlgeschlagen`);
  }
  if (/^FAIL:/m.test(melderLog)) out.push('Melder fehlgeschlagen');
  return out;
}

export const findingsOf = melderLog => melderLog.split('\n').filter(l => l.startsWith('BEFUND ')).map(l => l.slice(7).trim());

function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1]}: ${r.stderr}`);
  return r.stdout;
}

function main() {
  const melderLog = process.env.MELDER_LOG && existsSync(process.env.MELDER_LOG) ? readFileSync(process.env.MELDER_LOG, 'utf8') : '';
  const failures = failedSteps(JSON.parse(process.env.STEPS_JSON || '{}'), melderLog);
  const findings = findingsOf(melderLog);
  const alarm = process.env.ALARM || null;

  const open = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,body,comments', '--limit', '1']))[0] ?? null;
  const texts = open ? [open.body, ...(open.comments ?? []).map(c => c.body)] : [];
  const lastMark = texts.map(t => MARK.exec(t ?? '')?.[1]).filter(Boolean).at(-1) ?? null;

  const { action, lines, mark } = decideIssue({
    ran: process.env.RAN === 'true',
    failures, findings, alarm,
    previousConclusion: process.env.PREVIOUS_CONCLUSION || null,
    openIssue: open?.number ?? null,
    lastMark,
  });
  console.log(`Fehlschlaege ${failures.length}, Befunde ${findings.length}, Alarm ${alarm ? 'ja' : 'nein'}: ${action}`);

  const bodyFile = `${process.env.RUNNER_TEMP || '.'}/tft-data-refresh-issue.md`;
  writeFileSync(bodyFile, `Lauf: ${process.env.RUN_URL ?? ''}\n\n${lines.map(l => `- ${l}`).join('\n')}\n\n<!-- befund:${mark} -->\n`);
  if (action === 'create') {
    spawnSync('gh', ['label', 'create', LABEL, '--color', 'D93F0B', '--description', 'Befund des TFT-Daten-Laufs', '--force'], { encoding: 'utf8' });
    gh(['issue', 'create', '--title', `TFT-Daten: Befund vom ${new Date().toISOString().slice(0, 10)}`, '--label', LABEL, '--body-file', bodyFile]);
  } else if (action === 'comment') {
    gh(['issue', 'comment', String(open.number), '--body-file', bodyFile]);
  } else if (action === 'close') {
    gh(['issue', 'close', String(open.number), '--comment', `Sauberer Lauf: ${process.env.RUN_URL ?? ''}`]);
  }
  process.exitCode = failures.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

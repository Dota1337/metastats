#!/usr/bin/env node
/**
 * Letzter Schritt von tft-data-refresh.yml: Befund-Issue anlegen, ergaenzen oder
 * schliessen, danach den Lauf rot machen, wenn ein Schritt fehlschlug.
 *
 * Regeln (User 01.11.2026 „immer aktuell“, aber ohne Issue-Flut, Lauf alle 3 Stunden):
 * - Ein fehlgeschlagener Schritt legt hier KEIN Issue mehr an (seit 12.11.2026): der
 *   Lauf endet rot, und der Fehler-Melder (failure-watch.yml) meldet ab dem zweiten
 *   roten Lauf in Folge (FAILURE_WATCH_AFTER im Workflow).
 * - Veraltete Zahl (Melder) oder Patchtag-Alarm: sofort.
 * - Hoechstens ein offenes Issue. Kommentar nur, wenn sich der Befund geaendert hat.
 * - Geschlossen wird nur nach einem echten, sauberen Lauf: eine Runde ohne Arbeit hat
 *   nichts geprueft, ein Lauf mit Fehlschlag auch nicht.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeGh, ownerOf } from './lib/gh-issues.mjs';
import { syncOutage } from './lib/tft-cdragon-outage.mjs';

const LABEL = 'tft-data-refresh';
const MARK = /<!-- befund:([0-9a-f]+) -->/;

/** Reine Entscheidung. Rueckgabe: { action, lines, mark }, action = none|create|comment|close. */
export function decideIssue({ ran, failures, findings, alarm, openIssue, lastMark }) {
  const lines = [...findings, ...(alarm ? [alarm] : [])];
  if (!lines.length) {
    const clean = ran && !failures.length && !alarm;
    return { action: clean && openIssue ? 'close' : 'none', lines, mark: null };
  }
  const mark = createHash('sha256').update([...lines].sort().join('\n')).digest('hex').slice(0, 12);
  if (!openIssue) return { action: 'create', lines, mark };
  return { action: mark === lastMark ? 'none' : 'comment', lines, mark };
}

/** Antwortete CommunityDragon nicht? fetch-tft-assets schreibt das vor Exit 75. */
export const sourceDownOf = steps => steps?.bundle?.outputs?.source_down === 'true';

/**
 * Welche Schritte fehlschlugen. Der Melder zaehlt nur mit Fehler, nicht mit Befund.
 * CDragon-Ausfall zaehlt nicht (User 13.11.2026: gruen, Alarm erst nach 24 h ueber
 * tft-cdragon-outage.mjs).
 */
export function failedSteps(steps, melderLog) {
  const out = [];
  const sourceDown = sourceDownOf(steps);
  for (const [id, step] of Object.entries(steps ?? {})) {
    if (id === 'melder' || step?.outcome !== 'failure') continue;
    if (id === 'bundle' && sourceDown) continue;
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

async function main() {
  const melderLog = process.env.MELDER_LOG && existsSync(process.env.MELDER_LOG) ? readFileSync(process.env.MELDER_LOG, 'utf8') : '';
  const steps = JSON.parse(process.env.STEPS_JSON || '{}');
  const sourceDown = sourceDownOf(steps);
  const failures = failedSteps(steps, melderLog);
  const findings = findingsOf(melderLog);
  const alarm = process.env.ALARM || null;

  // Ausfall-Merker zuerst und abgeschirmt: eine Panne hier darf weder den Befund-Teil
  // stoppen noch den Lauf rot machen.
  try {
    const repo = process.env.GITHUB_REPOSITORY;
    const hours = Number(process.env.CDRAGON_DOWN_ALARM_HOURS);
    const outage = await syncOutage({
      gh: makeGh({ repo, token: process.env.GH_TOKEN }),
      owner: ownerOf(repo),
      sourceDown,
      delivered: steps.bundle?.outcome === 'success',
      nowMs: Date.now(),
      alarmHours: Number.isFinite(hours) ? hours : 24,
      runUrl: process.env.RUN_URL,
    });
    if (sourceDown) console.log(`::warning::CommunityDragon nicht erreichbar — alte Daten bleiben (Ausfall-Issue: ${outage})`);
    else if (outage !== 'none') console.log(`Ausfall-Issue: ${outage}`);
  } catch (e) {
    console.log(`::warning::Ausfall-Issue nicht abgeglichen: ${e.message}`);
  }

  const open = JSON.parse(gh(['issue', 'list', '--label', LABEL, '--state', 'open', '--json', 'number,body,comments', '--limit', '1']))[0] ?? null;
  const texts = open ? [open.body, ...(open.comments ?? []).map(c => c.body)] : [];
  const lastMark = texts.map(t => MARK.exec(t ?? '')?.[1]).filter(Boolean).at(-1) ?? null;

  const { action, lines, mark } = decideIssue({
    // Ein Ausfall-Lauf hat nichts geprueft und schliesst deshalb kein Befund-Issue.
    ran: process.env.RAN === 'true' && !sourceDown,
    failures, findings, alarm,
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

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(e => { console.error(`FAIL: ${e.message}`); process.exitCode = 1; });
}

#!/usr/bin/env node
// PostCompact-Hook: Kernregeln — und wenn eine Freigabe lebt, den Plan —
// nach dem Compact neu einspielen.
//
// Der Compact fasst den Gespraechsverlauf zusammen, nicht die Regeln — die
// fallen mit dem alten Kontext weg. Ohne diesen Hook ist der Assistant nach
// jedem Compact auf Default-Verhalten zurueckgesetzt, und in einer langen
// Session passiert das ein Dutzend Mal.
//
// Seit 2026-08-16 kommt der Plan-Text dazu. Genau das war der Grund, aus dem
// die Freigabe frueher am Compact starb ("Plan ist nicht mehr im Kontext").
// Er kommt zurueck, also darf sie leben. Der Zustand wird hier NUR gelesen —
// entschieden hat ihn session-start.mjs, das beim Compact vorher laeuft.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DIR, readInput, approvalStatus, planHash, PLAN_FILE } from './lib/state.mjs';

const input = readInput();
const rules = join(PROJECT_DIR, 'infra', 'claude-settings', 'discipline.md');
const parts = [existsSync(rules) ? readFileSync(rules, 'utf8') : ''];

const status = approvalStatus(input.session_id);
let systemMessage;

if (status.ok) {
  // Beide Hashes mitgeben: weicht der Plan vom freigegebenen Stand ab, soll
  // das hier sichtbar sein und nicht erst beim ersten geblockten Write.
  const plan = (() => { try { return readFileSync(PLAN_FILE, 'utf8'); } catch { return ''; } })();
  const drift = status.state?.planHash !== planHash();
  parts.push(
    `<freigegebener-plan hinweis="Der User hat DIESEN Plan freigegeben; die Freigabe gilt ueber den Compact hinweg weiter. Arbeite ihn ab. Fuer alles ausserhalb dieses Plans brauchst du eine neue Freigabe."` +
    ` freigegeben-am="${status.state?.approvedAt || '?'}"` +
    ` freigegeben-mit="${String(status.state?.approvedBy || '').replace(/"/g, "'")}"` +
    ` hash-bei-freigabe="${status.state?.planHash || '-'}" hash-jetzt="${planHash() || '-'}"` +
    `${drift ? ' WARNUNG="Plan wurde nach der Freigabe geaendert — das Gate blockt"' : ''}>\n${plan}\n</freigegebener-plan>`
  );
  systemMessage = '[metastats] Kernregeln + freigegebener Plan nach Compact neu eingespielt · Freigabe gilt weiter';
} else {
  parts.push(`Hinweis: es wurde gerade komprimiert. Es liegt KEINE gueltige Freigabe vor (${status.reason}). Wenn Code-Aenderungen offen sind, leg den Plan vor und hol dir die Freigabe.`);
  systemMessage = '[metastats] Kernregeln nach Compact neu eingespielt · keine gueltige Freigabe';
}

process.stdout.write(JSON.stringify({
  suppressOutput: true,
  systemMessage,
  hookSpecificOutput: {
    hookEventName: 'PostCompact',
    additionalContext: parts.filter(Boolean).join('\n\n'),
  },
}));
process.exit(0);

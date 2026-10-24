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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Wie session-start.mjs seit Runde 10 (24.10.2026): lib/state.mjs dynamisch,
// fehlende Kernregeln laut statt still (kernregeln-fehlen-still).
const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let st = null;
let stFehler = '';
try { st = await import('./lib/state.mjs'); } catch (err) { stFehler = String(err?.message || err).split('\n')[0]; }
let input = {};
try { input = JSON.parse(readFileSync(0, 'utf8')); } catch { input = {}; }

const rules = join(PROJECT_DIR, 'infra', 'claude-settings', 'discipline.md');
const parts = [];
const fehler = [];
try {
  parts.push(readFileSync(rules, 'utf8'));
} catch (err) {
  fehler.push('Kernregeln nicht lesbar');
  parts.push(`<gate-warnung>infra/claude-settings/discipline.md ist nicht lesbar (${err?.code || err?.message}) — die Kernregeln wurden nach dem Compact NICHT eingespielt. Sag dem User diesen Befund.</gate-warnung>`);
}

const status = st
  ? st.approvalStatus(input.session_id)
  : { ok: false, reason: `lib/state.mjs nicht ladbar (${stFehler})` };
if (!st) fehler.push('lib/state.mjs nicht ladbar');
let systemMessage;

if (status.ok) {
  const { planHash, PLAN_FILE } = st;
  // Beide Hashes mitgeben: wurde der Plan nach der Freigabe ergaenzt, soll das
  // sichtbar sein. Blocken tut es seit 2026-09-27 nicht mehr (state.mjs).
  const plan = (() => { try { return readFileSync(PLAN_FILE, 'utf8'); } catch { return ''; } })();
  const drift = status.state?.planHash !== planHash();
  parts.push(
    `<freigegebener-plan hinweis="Der User hat dieses Thema freigegeben; die Freigabe gilt ueber den Compact hinweg weiter und deckt auch Plan-Ergaenzungen nach dem go. Arbeite den Plan ab. Fuer ein neues Thema brauchst du eine neue Freigabe."` +
    ` freigegeben-am="${status.state?.approvedAt || '?'}"` +
    ` freigegeben-mit="${String(status.state?.approvedBy || '').replace(/"/g, "'")}"` +
    ` hash-bei-freigabe="${status.state?.planHash || '-'}" hash-jetzt="${planHash() || '-'}"` +
    `${drift ? ' HINWEIS="Plan wurde nach der Freigabe ergaenzt — nur im freigegebenen Thema weiterarbeiten"' : ''}>\n${plan}\n</freigegebener-plan>`
  );
  systemMessage = '[metastats] Kernregeln + freigegebener Plan nach Compact neu eingespielt · Freigabe gilt weiter';
} else {
  parts.push(`Hinweis: es wurde gerade komprimiert. Es liegt KEINE gueltige Freigabe vor (${status.reason}). Wenn Code-Aenderungen offen sind, leg den Plan vor und hol dir die Freigabe.`);
  systemMessage = '[metastats] Kernregeln nach Compact neu eingespielt · keine gueltige Freigabe';
}

if (fehler.length) systemMessage = `[metastats] FEHLER nach Compact: ${fehler.join(' · ')}`;

process.stdout.write(JSON.stringify({
  suppressOutput: true,
  systemMessage,
  hookSpecificOutput: {
    hookEventName: 'PostCompact',
    additionalContext: parts.filter(Boolean).join('\n\n'),
  },
}));
process.exit(0);

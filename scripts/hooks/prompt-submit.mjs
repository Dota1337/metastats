#!/usr/bin/env node
// UserPromptSubmit-Hook. Zwei Aufgaben:
//
// 1. Freigabe-Zustand fortschreiben (Zaehler hoch, Freigabe setzen, bei neuem
//    Thema loeschen). Das ist die einzige Stelle, an der eine Freigabe
//    ENTSTEHT — der Assistant kann sich selbst keine ausstellen.
// 2. Die Kernregeln ans Ende des Kontexts haengen. AGENTS.md steht am Kopf und
//    verliert in langen Sessions gegen die Rezenz; hier landet der Text direkt
//    vor der Antwort.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DIR, readInput, readState, writeState, clearApproval, planHash } from './lib/state.mjs';

const input = readInput();
const sessionId = input.session_id;
const prompt = String(input.prompt || '').trim();

// Kurz genug, um eine reine Freigabe zu sein. „ok, aber mach X anders" ist
// keine Freigabe des vorgelegten Plans, sondern ein neuer Auftrag — deshalb
// die Laengenschranke statt eines blossen Praefix-Matches.
const SHORT = prompt.length <= 120;
const APPROVAL = /^\s*(go|ok|okay|k|passt|freigabe|freigegeben|los|jo|ja|yes|approved|genehmigt|mach)\b/i;
const TRIVIAL = /\b(trivial|spot-?fix)\b/i;
const NEW_TOPIC = /^\s*code\s*:/i;

if (sessionId) {
  if (NEW_TOPIC.test(prompt)) {
    // Neuer `Code:`-Task = neues Thema. Alte Freigabe verfaellt, und zwar
    // sichtbar: der Assistant sieht den Grund im Gate-Text wieder.
    clearApproval(sessionId, 'neuer Code:-Task — alte Freigabe verfallen');
  } else if ((SHORT && APPROVAL.test(prompt)) || TRIVIAL.test(prompt)) {
    writeState(sessionId, {
      approvedAt: new Date().toISOString(),
      planHash: planHash(),
      promptsSinceApproval: 0,
      approvedBy: prompt.slice(0, 60),
      clearedBy: null,
    });
  } else {
    const s = readState(sessionId);
    writeState(sessionId, { promptsSinceApproval: (s.promptsSinceApproval || 0) + 1 });
  }
}

const rules = join(PROJECT_DIR, 'infra', 'claude-settings', 'discipline.md');
if (existsSync(rules)) {
  process.stdout.write(JSON.stringify({
    suppressOutput: true,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: readFileSync(rules, 'utf8'),
    },
  }));
}
process.exit(0);

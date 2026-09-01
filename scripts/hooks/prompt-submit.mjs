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
// `k`, `jo` und `mach` sind hier bewusst NICHT dabei: sie kamen in keiner der
// bisher erteilten Freigaben vor (`.git/metastats-discipline/*.json` am
// 2026-09-01: go, Go, "Ja und go", "Go B", "Go Freigabe", "Passt, …"), sind aber
// die haeufigsten Anfaenge normaler Auftraege („mach weiter mit X").
const APPROVAL = /^\s*(go|ok|okay|passt|freigabe|freigegeben|los|ja|yes|approved|genehmigt)\b/i;
const TRIVIAL = /\b(trivial|spot-?fix)\b/i;
const NEW_TOPIC = /^\s*code\s*:/i;
// Prompts, die nicht vom User stammen: Subagent-Fertigmeldungen, Hook-Reminder,
// Bash-Echos. Sie kommen ueber denselben Kanal an und duerfen niemals eine
// Freigabe erzeugen. Belegt eingetreten (2026-09-01): in
// `.git/metastats-discipline/060ef0f3-….json` steht `approvedBy:
// "<task-notification>…"` — eine 18k Zeichen lange Agent-Meldung enthielt das
// Wort „trivial" und hat sich damit selbst freigegeben, weil TRIVIAL frueher
// ausserhalb der Laengenschranke geprueft wurde.
const MACHINE = /^\s*</.test(prompt);

if (sessionId) {
  if (MACHINE) {
    // Erteilt nichts, loescht nichts — und zaehlt seit 2026-09-01 auch NICHT
    // mehr mit. Die Zaehler heissen `promptsSince…` und sollen messen, wie weit
    // die Arbeit vom letzten echten User-Wort entfernt ist. Eine Subagent-
    // Fertigmeldung ist kein User-Wort: sie kommt als Folge der freigegebenen
    // Arbeit selbst. Vorher verbrauchte eine Zweier-Multi-Review 2 der 8
    // erlaubten Prompts — die Review, die AGENTS.md vorschreibt, hat also die
    // Freigabe fuer die anschliessende Implementation aufgezehrt. Genau daran
    // ist Runde 4 gescheitert (reference_discipline_hooks.md).
  } else if (NEW_TOPIC.test(prompt) && !(SHORT && APPROVAL.test(prompt.replace(NEW_TOPIC, '')))) {
    // Neuer `Code:`-Task = neues Thema. Alte Freigabe verfaellt, und zwar
    // sichtbar: der Assistant sieht den Grund im Gate-Text wieder.
    clearApproval(sessionId, 'neuer Code:-Task — alte Freigabe verfallen');
  } else if (SHORT && (APPROVAL.test(prompt.replace(NEW_TOPIC, '')) || TRIVIAL.test(prompt))) {
    // Ein zweites „ok" zum selben Plan erneuert das 8er-Fenster, aber NICHT
    // den absoluten Deckel: sonst waere jede beilaeufige Zustimmung eine
    // Verlaengerung ohne Ende. Zurueckgesetzt wird der Deckel nur, wenn sich
    // die Plan-Datei seit der letzten Freigabe geaendert hat — dann ist es ein
    // anderer Plan, den der User frisch freigibt.
    const s = readState(sessionId);
    const hash = planHash();
    const samePlan = Boolean(s.approvedAt) && s.planHash === hash;
    writeState(sessionId, {
      approvedAt: new Date().toISOString(),
      planHash: hash,
      promptsSinceApproval: 0,
      promptsSinceFirstApproval: samePlan ? (s.promptsSinceFirstApproval || 0) : 0,
      approvedBy: prompt.slice(0, 60),
      clearedBy: null,
      survivedCompact: samePlan ? Boolean(s.survivedCompact) : false,
    });
  } else {
    const s = readState(sessionId);
    writeState(sessionId, {
      promptsSinceApproval: (s.promptsSinceApproval || 0) + 1,
      promptsSinceFirstApproval: s.approvedAt ? (s.promptsSinceFirstApproval || 0) + 1 : 0,
    });
  }
}

// Der Regeltext selbst steht seit 2026-09-01 im Prefix (.claude/rules/00-kernregeln.md,
// von session-start.mjs dorthin gespiegelt). Hier bleibt nur ein Zeiger: kurz genug,
// um pro Turn nicht ins Gewicht zu fallen, konkret genug, um nachschlagbar zu sein.
// Faellt der Prefix weg — nach einem Compact —, spielt post-compact.mjs den vollen
// Text nach.
const POINTER = [
  'Kernregeln gelten unveraendert: verifizieren vor behaupten (selbst messen, keine',
  'Subagent-Zahlen ungeprueft), Befund zuerst in max. drei Zeilen, Beleg-Pflicht fuer',
  'jede Zahl, Plan vor Code, unabhaengige Tool-Calls in EINE Message.',
  'Volltext: .claude/rules/00-kernregeln.md (Quelle infra/claude-settings/discipline.md).',
].join(' ');

// Groessenbremse: waechst der Zeiger zum zweiten Regeltext heran, ist der Zweck
// verfehlt. Dann lieber abschneiden als still teuer werden.
const POINTER_LIMIT = 500;
process.stdout.write(JSON.stringify({
  suppressOutput: true,
  hookSpecificOutput: {
    hookEventName: 'UserPromptSubmit',
    additionalContext: POINTER.length > POINTER_LIMIT
      ? `FEHLER: Per-Turn-Zeiger ist ${POINTER.length} Zeichen lang, erlaubt sind ${POINTER_LIMIT}. Kuerze ihn in scripts/hooks/prompt-submit.mjs.`
      : POINTER,
  },
}));
process.exit(0);
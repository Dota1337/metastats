#!/usr/bin/env node
// UserPromptSubmit-Hook. Zwei Aufgaben:
//
// 1. Freigabe-Zustand fortschreiben (Zaehler hoch, Freigabe setzen, bei neuem
//    Thema loeschen). Das ist die einzige Stelle, an der eine Freigabe
//    ENTSTEHT — der Assistant kann sich selbst keine ausstellen.
// 2. Die Kernregeln ans Ende des Kontexts haengen. AGENTS.md steht am Kopf und
//    verliert in langen Sessions gegen die Rezenz; hier landet der Text direkt
//    vor der Antwort.
import { readInput, readState, writeState, clearApproval, planHash } from './lib/state.mjs';
import { isApprovalPrompt, isTrivialPrompt, isNewTopic, isMachinePrompt } from './lib/prompt-words.mjs';

const input = readInput();
const sessionId = input.session_id;
const prompt = String(input.prompt || '').trim();

// Was als Freigabe, Trivial-Ausweg, neues Thema oder Maschinen-Meldung zaehlt,
// steht seit Runde 10 (24.10.2026) in lib/prompt-words.mjs — samt Laengengrenze,
// Rueckfrage-, Vorbehalts- und Verneinungs-Regel und den Belegen dazu.
const MACHINE = isMachinePrompt(prompt);
const APPROVAL = isApprovalPrompt(prompt);
const TRIVIAL = isTrivialPrompt(prompt);

/**
 * Freigabe setzen. Ein zweites „ok" zum selben Plan erneuert das 8er-Fenster,
 * aber NICHT den absoluten Deckel: sonst waere jede beilaeufige Zustimmung eine
 * Verlaengerung ohne Ende. Zurueckgesetzt wird der Deckel nur, wenn es gar
 * keine Freigabe mehr gab — geloescht durch neues `Code:`-Thema oder
 * Sessiongrenze. Frueher reichte ein geaenderter Plan-Hash; seit
 * Plan-Aenderungen nicht mehr blocken, haette stilles Umschreiben plus
 * beilaeufiges „ja" den Deckel sonst wieder aufgefuellt (logic-flow-critic,
 * 27.09.2026). Ein abgelaufener Deckel bleibt abgelaufen, bis das Thema neu
 * per `Code:` aufgemacht wird.
 */
function freigeben(trivial) {
  const s = readState(sessionId);
  const fresh = !s.approvedAt;
  writeState(sessionId, {
    approvedAt: new Date().toISOString(),
    planHash: planHash(),
    promptsSinceApproval: 0,
    promptsSinceFirstApproval: fresh ? 0 : (s.promptsSinceFirstApproval || 0),
    approvedBy: prompt.slice(0, 60),
    trivial,
    clearedBy: null,
    survivedCompact: fresh ? false : Boolean(s.survivedCompact),
  });
}

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
  } else if (isNewTopic(prompt) && !APPROVAL) {
    // Neuer `Code:`-Task = neues Thema. Alte Freigabe verfaellt, und zwar
    // sichtbar: der Assistant sieht den Grund im Gate-Text wieder.
    clearApproval(sessionId, 'neuer Code:-Task — alte Freigabe verfallen');
    // „Code: trivial, Tippfehler in X" ist neues Thema UND Trivial-Ausweg. Bis
    // 24.10.2026 loeschte er nur die alte Freigabe und erteilte keine — der
    // vom User gewaehlte Ausweg lief ins Leere.
    if (TRIVIAL) freigeben(true);
  } else if (APPROVAL || TRIVIAL) {
    freigeben(TRIVIAL);
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
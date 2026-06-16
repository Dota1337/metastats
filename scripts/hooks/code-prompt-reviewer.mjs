#!/usr/bin/env node
// UserPromptSubmit-Hook: aktiver Enforcement-Layer für das Multi-Agent-Review-
// Pattern. Memory ist passiver Kontext, wird gelesen aber nicht erzwungen — bei
// langen Sessions oder komplexem Task-Druck kann der Assistant in das alte
// "schnelle Lösung"-Muster zurückfallen. Dieser Hook injiziert bei jedem
// "Code:"-Prefix einen Reminder als zusätzlicher Konversations-Kontext, den der
// Assistant nicht überlesen kann.
//
// Aktivierung: ~/.claude/settings.json → hooks.UserPromptSubmit
//
// Trivial-Skip: Wenn der Prompt klar trivial ist (Typo, i18n, ein-Wort-Edit),
// feuert kein Reminder. Trigger-Heuristik = bewusst konservativ; im Zweifel
// soll der Reminder kommen.

import { readFileSync } from 'node:fs';

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf-8'));
} catch {
  // Hook wurde anders aufgerufen (Test, leer, etc.) — schweigend exit.
  process.exit(0);
}

const prompt = String(input?.prompt || '').trim();

// Nur Code: Prefix triggert. Andere User-Prompts unberührt lassen.
if (!/^Code\s*:/i.test(prompt)) process.exit(0);

// Trivial-Marker → kein Reminder. Bewusst restriktive Liste, nur eindeutige
// Cases. Bei Unsicherheit (z.B. "Code: refactor minGames" — könnte Pattern-
// Impact haben) feuert der Reminder.
const TRIVIAL_MARKERS = [
  /\btrivial\b/i,
  /\bspot[- ]?fix\b/i,
  /\btypo\b/i,
  /\b(fix|change|update) (a |the )?(comment|wording|label|i18n|string)\b/i,
  /\bonly (i18n|texts?|translations?)\b/i,
];
const isTrivial = TRIVIAL_MARKERS.some(re => re.test(prompt));
if (isTrivial) process.exit(0);

// Reminder als zusätzlicher Konversations-Kontext. Geht direkt in die User-
// Message-Pipeline und ist für den Assistant sichtbar.
process.stdout.write(`<system-reminder source="metastats-multi-review-hook">
Dieser \`Code:\`-Task verlangt das in AGENTS.md festgeschriebene Multi-Review-Pattern. BEVOR du Code änderst:

1. Liste ≥3 Alternativen mit explizitem Trade-off-Vergleich (Tabelle oder nummerierte Liste mit Vorteil/Nachteil pro Option).
2. Spawne PARALLEL 2-3 passende Custom-Sub-Agents in EINER Message via \`Agent\`-Tool:
   - \`metastats-data-skeptic\` bei Stats/Filter/Aggregation/DB-Datenlage
   - \`metastats-perf-critic\` bei API/Cache/DB-Query/Snapshot-Pipeline
   - \`metastats-architect\` bei Pattern/Storage-Wahl/mehrere Files
   - \`classification-reviewer\` bei Klassifikation/Tier/Whitelist
3. Zeige die Verdicts dem User transparent (eine Zeile pro Agent + zusammengefasste Empfehlung).
4. Erst dann implementieren — Plan ggf. anpassen.

Triviale Spot-Fixes (i18n, Typo, einzelner Konstanten-Wert) sind ausgenommen. Im Zweifel: Multi-Review fahren.

Memory-Anker: feedback_pre_implementation_multi_review.md, feedback_alternatives_with_tradeoffs.md.
</system-reminder>
`);

process.exit(0);

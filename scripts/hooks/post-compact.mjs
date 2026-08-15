#!/usr/bin/env node
// PostCompact-Hook: Kernregeln nach dem Compact neu einspielen.
//
// Der Compact fasst den Gespraechsverlauf zusammen, nicht die Regeln — die
// fallen mit dem alten Kontext weg. Ohne diesen Hook ist der Assistant nach
// jedem Compact auf Default-Verhalten zurueckgesetzt, und in einer langen
// Session passiert das ein Dutzend Mal.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_DIR, readInput } from './lib/state.mjs';

readInput();
const rules = join(PROJECT_DIR, 'infra', 'claude-settings', 'discipline.md');
const text = existsSync(rules) ? readFileSync(rules, 'utf8') : '';

process.stdout.write(JSON.stringify({
  suppressOutput: true,
  systemMessage: '[metastats] Kernregeln nach Compact neu eingespielt · Freigabe ist verfallen',
  hookSpecificOutput: {
    hookEventName: 'PostCompact',
    additionalContext: `${text}\n\nHinweis: es wurde gerade komprimiert. Die Plan-Freigabe ist verfallen. Wenn noch Code-Aenderungen offen sind, leg den Plan neu vor und hol dir die Freigabe.`,
  },
}));
process.exit(0);

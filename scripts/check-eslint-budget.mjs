#!/usr/bin/env node
// Ratsche auf die ESLint-Fehler. Laeuft in der CI (.github/workflows/ci.yml),
// bewusst NICHT im pre-push: der Hook braucht heute ~14 s, ein voller
// ESLint-Lauf kostet gemessen 43,7 s (kalt) — ein Hook, der dreimal so lange
// braucht, wird abgeschaltet, und dann greift gar nichts mehr.
//
// Warum ueberhaupt: ESLint lief bis 02.09.2026 an KEINER Stelle. Nicht in der
// CI, nicht im Hook, und Next 16 lintet beim Build nicht mehr. Die 748 Fehler
// haben also nichts geblockt und niemand hat gemerkt, wenn welche dazukamen.
//
// Warum ein Deckel je Regel statt „0 Fehler": der Bestand sind 645x
// no-explicit-any plus 103 Fehler in 8 weiteren Regeln. Ein hartes Null waere
// ein Refactor von 103 Stellen, darunter 33x react-hooks/set-state-in-effect —
// das aendert Effekt-Verhalten und gehoert nicht in einen Waechter-Commit.
// Der Deckel friert den Bestand ein: kein neuer Fehler kommt durch, jede
// unbekannte Regel ist sofort rot, und wenn eine Zahl faellt, sagt der Check
// selbst, auf welchen Wert der Deckel zu senken ist.
//
// Warum ESLint selbst zaehlt und kein eigener Regex: eine zweite Messquelle
// driftet. Probe 02.09.2026 — Regex ueber `git ls-files '*.ts' '*.tsx'` fand
// 628 `any` in 111 Dateien, ESLint 645 in 110. Zwei Waechter, die sich
// widersprechen, sind schlimmer als einer.
//
// Aufruf: node scripts/check-eslint-budget.mjs

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Nicht ueber `npx`: Node startet auf Windows seit der .cmd-Haertung keine
// Batch-Datei mehr ohne Shell (gemessen: `spawnSync npx.cmd EINVAL`). Wir
// starten stattdessen die ESLint-Datei direkt mit demselben Node — das
// funktioniert auf der CI (Linux) und lokal (Windows) gleich.
const require_ = createRequire(import.meta.url);
const ESLINT_BIN = join(dirname(require_.resolve('eslint/package.json')), 'bin', 'eslint.js');

// Stand 02.09.2026, gemessen mit `npx eslint . --format json`.
// Beim Senken das Datum mitziehen.
const BUDGET = {
  '@typescript-eslint/no-explicit-any': 645,
  '@next/next/no-html-link-for-pages': 40,
  'react-hooks/set-state-in-effect': 33,
  'prefer-const': 9,
  'react-hooks/immutability': 9,
  'react-hooks/static-components': 5,
  'react/no-unescaped-entities': 4,
  '@typescript-eslint/no-require-imports': 2,
  'react-hooks/purity': 1,
};

// ESLint beendet sich mit Code 1, SOBALD ein einziger Fehler existiert — und
// das ist hier der Normalfall. Der Exit-Code taugt also nicht als Signal, wir
// muessen die JSON-Ausgabe lesen. Genau deshalb ist der naechste Absatz
// wichtig: kaputte oder leere Ausgabe MUSS hart scheitern, sonst waere
// „ESLint abgestuerzt" nicht von „alles sauber" zu unterscheiden.
let raw;
try {
  raw = execFileSync(
    process.execPath,
    [ESLINT_BIN, '.', '--format', 'json'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
  );
} catch (e) {
  // Exit 1 = Lint-Fehler gefunden, stdout ist trotzdem gueltiges JSON.
  // Exit 2 = ESLint selbst kaputt (Config, Parser) — dann ist stdout leer.
  raw = e.stdout ? String(e.stdout) : '';
  if (!raw.trim()) {
    console.error(`ESLint lieferte keine Ausgabe (Exit ${e.status}). Das ist ein Werkzeug-Fehler, kein sauberer Lauf.`);
    process.exit(1);
  }
}

let report;
try {
  report = JSON.parse(raw);
} catch {
  console.error('ESLint-Ausgabe ist kein gueltiges JSON. Abbruch statt gruen.');
  process.exit(1);
}

if (!Array.isArray(report) || report.length === 0) {
  console.error('ESLint hat 0 Dateien geprueft. Das ist ein Konfigurations-Fehler, kein sauberes Ergebnis.');
  process.exit(1);
}

const counts = {};
const samples = {};
for (const file of report) {
  for (const m of file.messages || []) {
    if (m.severity !== 2) continue;
    const rule = m.ruleId || '(fatal)';
    counts[rule] = (counts[rule] || 0) + 1;
    if (!samples[rule]) samples[rule] = `${file.filePath}:${m.line} — ${m.message}`;
  }
}

let failed = false;

for (const [rule, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  const cap = BUDGET[rule];
  if (cap === undefined) {
    console.error(`Neue Fehler-Regel ohne Deckel: ${rule} (${n}x)`);
    console.error(`  z.B. ${samples[rule]}`);
    failed = true;
  } else if (n > cap) {
    console.error(`${rule}: ${n} > Deckel ${cap}`);
    console.error(`  z.B. ${samples[rule]}`);
    failed = true;
  }
}

if (failed) {
  console.error('');
  console.error('Neue Lint-Fehler beheben — oder, wenn sie bewusst sind, den Deckel in');
  console.error('scripts/check-eslint-budget.mjs mit Begruendung anheben.');
  process.exit(1);
}

const lowered = Object.entries(BUDGET)
  .filter(([rule, cap]) => (counts[rule] || 0) < cap)
  .map(([rule, cap]) => `  ${rule}: ${cap} -> ${counts[rule] || 0}`);

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`ESLint-Fehler: ${total} (alle unter/auf Deckel), Dateien geprueft: ${report.length}.`);
if (lowered.length > 0) {
  console.log('Deckel senken in scripts/check-eslint-budget.mjs:');
  for (const l of lowered) console.log(l);
}

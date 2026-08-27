#!/usr/bin/env node
// Waechter gegen Rueckfall auf Roh-Hex-Utilities im Markup (Welle 2).
//
// Zwei Stufen, weil die Migration in Wellen laeuft:
//
//   1. HARTE NULL fuer die in Commit A migrierten 10 neutralen Farben. Diese
//      Hexe haben ein Token und duerfen im Markup nicht mehr auftauchen --
//      hier gibt es keine Toleranz und damit auch kein Schlupfloch, bei dem
//      man eine Stelle entfernt und dafuer eine neue einbaut.
//
//   2. RATSCHE fuer alles andere (Accent, Win/Loss, Einzelfarben). Die sind
//      noch nicht migriert; ein Deckel auf der Gesamtzahl verhindert, dass die
//      Menge weiter waechst, ohne den offenen Rest zu blocken. Wenn Commit B
//      oder C landet, sinkt die Zahl und der Deckel wird mitgesenkt -- der
//      Check sagt selbst, auf welchen Wert.
//
// Nur *.tsx: das Markup. In *.ts stehen Hexe als Datenwerte (Chart-Farben,
// Sprite-Paletten) und haben dort nichts mit Utilities zu tun.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Deckel fuer Stufe 2. Beim Senken auch dieses Kommentar-Datum mitziehen.
// Stand nach Welle 2 / Commit B (2026-08-09): 321.
//
// Warum die Accent-Familie NICHT in MIGRATED (harte Null) steht, obwohl sie
// jetzt Tokens hat: es bleiben bewusst Roh-Hexe stehen, die kein Token
// bekommen duerfen -- Gold im Root-Chrome (Nav/Footer, 43x) und zwei
// Fundstellen in Dateien, die keine Route erreicht. Eine harte Null wuerde
// genau die melden. Sie kommt, wenn diese Reste geklaert sind.
const BASELINE = 315;

// Die 10 Farben aus app/globals.css, die seit Commit A ein Token haben.
const MIGRATED = new Set([
  '0a0e1a', '0e1525', '0d1526', '141c2e', '1e2a3a',
  '2a3a50', 'a0b0c5', '7a8aa0', '5a6a80', 'cdd6e0',
]);

// Anker ist "-[#" -- der Klammer-Ausdruck trennt Tailwind-Utilities von
// nackten JS-Strings ('#141c2e'), die legitim sind und nicht mitzaehlen.
const RE = /-\[#([0-9a-fA-F]{3,8})\]/g;

const files = execSync('git ls-files app', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.tsx'));

const violations = [];
let rest = 0;

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(RE)) {
      if (MIGRATED.has(m[1].toLowerCase())) {
        violations.push(`${file}:${i + 1}  #${m[1]}`);
      } else {
        rest += 1;
      }
    }
  });
}

let failed = false;

if (violations.length > 0) {
  console.error(`Roh-Hex-Utility fuer eine migrierte Farbe (${violations.length}x):`);
  for (const v of violations.slice(0, 20)) console.error('  ' + v);
  if (violations.length > 20) console.error(`  ... und ${violations.length - 20} weitere`);
  console.error('');
  console.error('Diese 10 Farben haben Tokens. Statt -[#hex] die Token-Utility nutzen,');
  console.error('Namen stehen im @theme-inline-Block in app/globals.css.');
  failed = true;
}

if (rest > BASELINE) {
  console.error(`Roh-Hex-Utilities gestiegen: ${rest} > Deckel ${BASELINE}.`);
  console.error('Neue Farben gehoeren als Token nach app/globals.css, nicht ins Markup.');
  failed = true;
}

if (failed) process.exit(1);

if (rest < BASELINE) {
  console.log(`Roh-Hex-Utilities: ${rest} (Deckel ${BASELINE}).`);
  console.log(`Deckel senken: BASELINE in scripts/check-raw-hex-utilities.mjs auf ${rest}.`);
} else {
  console.log(`Roh-Hex-Utilities: ${rest} (= Deckel), migrierte Farben: 0.`);
}

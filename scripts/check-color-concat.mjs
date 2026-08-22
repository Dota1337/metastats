#!/usr/bin/env node
// Waechter gegen angeschweisste Alpha-Suffixe an Farbwerten.
//
// Worum es geht: `` `${tierColor}20` `` haengt zwei Hex-Ziffern Deckkraft an
// einen Farbwert. Das funktioniert genau so lange, wie `tierColor` ein
// 6-stelliger Hex ist. Sobald daraus ein Token wird, entsteht
// `var(--fg-muted)20` — ungueltiges CSS. Der Browser wirft die Deklaration
// still weg, die Flaeche verschwindet, und **es gibt keinen Build-Fehler**.
// Genau dieses Muster hat die Token-Migration blockiert (70 Fundstellen,
// Commit 2b-a).
//
// Der Ersatz ist `withAlpha(farbe, 0xNN)` aus `app/lib/color.ts`: der Helfer
// entscheidet zur Laufzeit zwischen Hex-Anhaengen und `color-mix`, statt die
// Entscheidung beim Schreiben festzunageln.
//
// Zwei Anker, bewusst verschieden scharf:
//
//   1. `var(--token)NN` woertlich im Quelltext — das ist bereits kaputtes CSS,
//      nicht nur ein Risiko. Harte Null, kein Spielraum.
//   2. `${...}NN` und `+ 'NN'` — das Risiko-Muster. Heute 0 Fundstellen
//      (gemessen nach Commit 2b-a), deshalb Baseline 0.
//
// **Warum Baseline 0 und nicht 70 wie bei Gate 7:** Gate 7 hat seine Baseline
// hoch, weil Waechter und Beseitigung in verschiedenen Commits liegen — ein
// `git revert` auf den Inhalts-Commit liesse den Waechter allein zurueck und
// braeche pre-push. Hier landen Waechter und Beseitigung im **selben** Commit;
// ein Revert nimmt beide gleichzeitig zurueck. Baseline 0 ist damit
// revert-sicher und sofort scharf.
//
// **Warum ein eigener Verzeichnislauf statt `git ls-files`:** getestet mit
// einer Sonde in `app/lib/` — `git ls-files` kennt nur getrackte Dateien und
// lief still durch. Ein Waechter, der eine neue Datei erst nach `git add`
// sieht, faengt genau den Fall nicht, in dem jemand das Muster frisch
// einbaut.
//
// Faellt der Check auf einer Stelle aus, die nachweislich keine Farbe ist
// (z.B. eine Zahlen-Konkatenation), gehoert sie in `ALLOW` — mit Begruendung,
// nicht die Baseline hochgesetzt.
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN = join(ROOT, 'app');

// Der Definitionsort selbst: der Kopfkommentar zitiert das verbotene Muster,
// um es zu erklaeren. Ihn mitzupruefen hiesse, die Erklaerung zu verbieten.
const ALLOW = new Set(['app/lib/color.ts']);

// Anker 1: bereits kaputtes CSS.
const BROKEN_RE = /var\(--[a-z0-9-]+\)[0-9a-fA-F]{2}(?![0-9a-zA-Z])/g;

// Anker 2: das Risiko-Muster. Nur mit Farbbezug in derselben Zeile — sonst
// faengt es Zahlen-Konkatenationen wie `${jahr}01` mit ein.
const CONCAT_RE = /\$\{[^}]+\}[0-9a-fA-F]{2}(?![0-9a-zA-Z])/g;
const PLUS_RE = /\+\s*['"][0-9a-fA-F]{2}['"]/g;
const COLOR_CTX_RE = /color|Color|border|background|fill|stroke|shadow/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SCAN);
const broken = [];
const risky = [];

for (const abs of files) {
  const file = relative(ROOT, abs).replace(/\\/g, '/');
  if (ALLOW.has(file)) continue;
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const at = `${file}:${i + 1}`;
    for (const m of line.matchAll(BROKEN_RE)) broken.push(`${at}  ${m[0]}`);
    if (!COLOR_CTX_RE.test(line)) return;
    for (const m of line.matchAll(CONCAT_RE)) risky.push(`${at}  ${m[0]}`);
    for (const m of line.matchAll(PLUS_RE)) risky.push(`${at}  ${m[0]}`);
  });
}

let failed = false;

if (broken.length > 0) {
  failed = true;
  console.error(`[color-concat] FEHLER: ${broken.length}x Alpha-Suffix an einem Token — das ist ungueltiges CSS:`);
  for (const b of broken) console.error(`  ${b}`);
  console.error('  Der Browser verwirft die Deklaration still. Ersetze durch withAlpha(farbe, 0xNN).');
}

if (risky.length > 0) {
  failed = true;
  console.error(`[color-concat] FEHLER: ${risky.length}x angeschweisstes Alpha-Suffix (Baseline 0):`);
  for (const r of risky) console.error(`  ${r}`);
  console.error('  Ersetze durch withAlpha(farbe, 0xNN) aus app/lib/color.ts.');
  console.error('  Ist die Stelle nachweislich keine Farbe, gehoert sie in ALLOW — nicht in eine hoehere Baseline.');
}

if (failed) process.exit(1);

console.log(`[color-concat] OK — 0 Fundstellen in ${files.length} Dateien`);

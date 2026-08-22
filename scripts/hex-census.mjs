#!/usr/bin/env node
// Farbwert-Zaehlung fuer die Design-Welle F2.
//
// Warum es dieses Script gibt: drei Review-Agents nannten drei verschiedene
// Zahlen fuer dieselbe Frage (242 / 749 / 1080). Keine war falsch -- sie haben
// verschiedene Mengen gezaehlt. Solange die Zaehlmenge nicht als Code
// existiert, ist jede Aufwandsschaetzung fuer den Aufraeum-Schritt geraten.
//
// Die Zaehlmenge ist ab hier diese Datei.
//
// Population: alle von git verfolgten .ts/.tsx unter app/, ohne die
// Design-Werkstatt (app/internal/design-lab) -- die haelt ihre Entwurfsfarben
// bewusst roh und ist von der Migration ausgenommen.
//
// Zwei Achsen, weil sie unterschiedliche Arbeit bedeuten:
//   KONTEXT  utility  = Tailwind-Klammerwert  -[#hex]   -> Gate 7 sieht ihn
//            string   = JS-String / style={{}} / SVG    -> Gate 7 ist blind
//   KLASSE   migrated = Farbe hat ein Token, folgt ihm aber nicht  -> Pflicht
//            alpha    = 8-stellig, traegt Deckkraft im Hex        -> Sonderfall
//            sanctioned = darf bewusst roh bleiben (Gold/Brand)   -> nicht anfassen
//            other    = kein Token; erst Entscheidung noetig      -> zu klaeren
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Die 10 Farben aus app/globals.css mit Token, identisch zu Gate 7, plus Weiss. */
const MIGRATED = new Set([
  '0a0e1a', '0e1525', '0d1526', '141c2e', '1e2a3a',
  '2a3a50', 'a0b0c5', '7a8aa0', '5a6a80', 'cdd6e0',
  'ffffff', 'fff',
]);

/** Bewusst roh: Root-Chrome-Gold, Marken-Lila, Preisgeld-Gold. Siehe globals.css. */
const SANCTIONED = new Set(['c89b3c', '7b61ff']);

const EXCLUDE = /^app\/internal\/design-lab\//;
const RE_UTILITY = /-\[#([0-9a-fA-F]{3,8})\]/g;
const RE_ANY = /#([0-9a-fA-F]{3,8})\b/g;

const files = execSync('git ls-files app', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => (f.endsWith('.tsx') || f.endsWith('.ts')) && !EXCLUDE.test(f));

const classify = (hex) => {
  const h = hex.toLowerCase();
  if (h.length === 8) return 'alpha';
  if (SANCTIONED.has(h)) return 'sanctioned';
  if (MIGRATED.has(h)) return 'migrated';
  return 'other';
};

const counts = {};          // kontext -> klasse -> n
const perFile = {};         // datei -> n (nur Pflicht-Arbeit)
const otherColors = {};     // hex -> n
const alphaHits = [];       // datei:zeile fuer den Sonderfall

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    const utilSpans = [...line.matchAll(RE_UTILITY)].map((m) => m.index);
    for (const m of line.matchAll(RE_ANY)) {
      // Ein Treffer gehoert zum Utility-Kontext, wenn er innerhalb eines
      // -[#...]-Ausdrucks beginnt (dessen '#' steht 2 Zeichen nach dessen Start).
      const isUtility = utilSpans.some((s) => m.index === s + 2);
      const kontext = isUtility ? 'utility' : 'string';
      const klasse = classify(m[1]);
      counts[kontext] ??= {};
      counts[kontext][klasse] = (counts[kontext][klasse] || 0) + 1;
      if (klasse === 'other') otherColors['#' + m[1].toLowerCase()] = (otherColors['#' + m[1].toLowerCase()] || 0) + 1;
      if (klasse === 'alpha') alphaHits.push(`${file}:${i + 1}  #${m[1]}`);
      if (klasse === 'migrated') perFile[file] = (perFile[file] || 0) + 1;
    }
  });
}

const n = (k, c) => (counts[k] && counts[k][c]) || 0;
const pflicht = n('utility', 'migrated') + n('string', 'migrated');

console.log(`Population: ${files.length} Dateien (app/**/*.{ts,tsx}, ohne design-lab)\n`);
console.log('               utility  string   gesamt');
for (const klasse of ['migrated', 'alpha', 'sanctioned', 'other']) {
  const u = n('utility', klasse), s = n('string', klasse);
  console.log(`  ${klasse.padEnd(12)} ${String(u).padStart(6)}  ${String(s).padStart(6)}  ${String(u + s).padStart(6)}`);
}
console.log(`\nPFLICHT-ARBEIT (migrated, folgt seinem Token nicht): ${pflicht}`);
console.log(`  davon fuer Gate 7 unsichtbar (string-Kontext): ${n('string', 'migrated')}`);

const top = Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (top.length) {
  console.log('\nGroesste Cluster:');
  for (const [f, c] of top) console.log(`  ${String(c).padStart(4)}  ${f}`);
}

if (alphaHits.length) {
  console.log(`\nSONDERFALL alpha (${alphaHits.length}) -- reines var() kippt hier die Deckkraft:`);
  for (const a of alphaHits) console.log('  ' + a);
}

const otherTop = Object.entries(otherColors).sort((a, b) => b[1] - a[1]).slice(0, 12);
if (otherTop.length) {
  console.log(`\nOhne Token (${n('utility', 'other') + n('string', 'other')} Treffer, ${Object.keys(otherColors).length} verschiedene Farben) -- Top 12:`);
  for (const [h, c] of otherTop) console.log(`  ${String(c).padStart(4)}  ${h}`);
}

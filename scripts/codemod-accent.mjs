#!/usr/bin/env node
// Einmal-Codemod: Roh-Hex-Utilities der Accent-Familie auf Tokens.
//
// Ohne --write nur Bericht. Nichts wird geraten: welches Token eine Fundstelle
// bekommt, haengt allein an der Klasse der Datei (scripts/lib/accent-scope.mjs).
//
//   ONLY:tft    + Lila  -> accent          (rendert immer unter [data-game=tft])
//   ONLY:lol    + Gold  -> accent          (rendert immer unter :root)
//   ROOT-CHROME + Lila  -> brand           (Marke, folgt dem Game NICHT)
//   SHARED      + Lila  -> brand           (Kontext wechselt, feste Farbe)
//   ONLY:tft    + Gold  -> gold-earnings   (Preisgeld, kein Accent)
//
// Alles andere bleibt liegen: NON-DOM (OG-Bilder ohne CSS), UNREACHABLE,
// Gold im Root-Chrome, sowie jede Alpha-Stufe ohne Token -- die wird gemeldet
// statt still gerundet.

import { readFileSync, writeFileSync } from 'node:fs';
import { buildAccentScope } from './lib/accent-scope.mjs';

const PURPLE = '7b61ff';
const GOLD = 'c89b3c';

// Stufen, fuer die es in globals.css ein Token gibt.
const ALPHA = {
  accent: [5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80],
  brand: [5, 8, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80],
  'gold-earnings': [],
};

function tokenFor(cls, hex) {
  const h = hex.toLowerCase();
  if (h === PURPLE) {
    if (cls === 'ONLY:tft') return 'accent';
    // Lila ausserhalb des TFT-Ankers ist immer die Marke: Login-Seiten,
    // Companion-Seiten, Root-Chrome. Es soll dort lila bleiben und darf
    // nicht dem Game folgen -- sonst wird es auf LoL-Seiten gold.
    if (cls === 'ROOT-CHROME' || cls === 'SHARED' || cls === 'ONLY:lol') return 'brand';
    return null;
  }
  if (h === GOLD) {
    if (cls === 'ONLY:lol') return 'accent';
    if (cls === 'ONLY:tft') return 'gold-earnings';
    return null;
  }
  return null;
}

const write = process.argv.includes('--write');
const scope = buildAccentScope();

// -[#hex] optional gefolgt von /NN. Der Hex steht im Markup mal gross
// (#7B61FF), mal klein (#c89b3c) -- case-sensitiv suchen findet nichts.
const RE = /-\[#([0-9a-fA-F]{6})\](\/(\d+))?/g;

const changed = [];
const skipped = [];
let touchedFiles = 0;

for (const [file, entry] of scope) {
  if (!file.endsWith('.tsx')) continue;
  const src = readFileSync(file, 'utf8');
  let hits = 0;

  const next = src.replace(RE, (match, hex, _slash, alpha) => {
    const token = tokenFor(entry.cls, hex);
    if (!token) {
      if ([PURPLE, GOLD].includes(hex.toLowerCase())) {
        skipped.push(`${file}  #${hex}${alpha ? '/' + alpha : ''}  [${entry.cls}]`);
      }
      return match;
    }
    if (alpha) {
      const step = Number(alpha);
      if (!ALPHA[token].includes(step)) {
        skipped.push(`${file}  #${hex}/${alpha}  [${entry.cls}] KEINE Alpha-Stufe ${token}-a${alpha}`);
        return match;
      }
      hits += 1;
      return `-${token}-a${step}`;
    }
    hits += 1;
    return `-${token}`;
  });

  if (hits > 0) {
    changed.push(`${String(hits).padStart(3)}  ${entry.cls.padEnd(12)} ${file}`);
    touchedFiles += 1;
    if (write) writeFileSync(file, next);
  }
}

console.log(changed.join('\n'));
console.log(`\n${changed.reduce((n, l) => n + Number(l.trim().split(/\s+/)[0]), 0)} Ersetzungen in ${touchedFiles} Dateien${write ? ' (geschrieben)' : ' (Probelauf)'}`);

if (skipped.length > 0) {
  console.log(`\nBewusst liegen geblieben (${skipped.length}):`);
  const grouped = {};
  for (const s of skipped) {
    const key = s.replace(/^\S+\s+/, '');
    grouped[key] = (grouped[key] ?? 0) + 1;
  }
  for (const [k, n] of Object.entries(grouped).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}x  ${k}`);
  }
}

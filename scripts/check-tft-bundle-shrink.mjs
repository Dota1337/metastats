#!/usr/bin/env node
/**
 * Riegel vor dem Commit des automatischen Daten-Laufs: ist das neue Bundle deutlich
 * kleiner als das eingecheckte? Dann hat eine Quelle Teile verloren, und die Seite
 * zeigte Luecken, ohne dass ein Fehler gefallen waere. Bei einem Set-Wechsel ist
 * kleiner normal, dort zaehlt nur, dass ueberhaupt etwas da ist.
 *
 * Exit 0 sauber · 1 geschrumpft oder unlesbar
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LANGS = ['de', 'ko', 'zh', 'es', 'fr'];
const MAX_LOSS = 0.1;

/** Was gezaehlt wird. Je Sprache eigene Zahl: faellt eine aus, faellt sie hier auf. */
export function bundleCounts(b) {
  const augments = Object.values(b?.augments ?? {});
  const traits = Object.values(b?.traits ?? {});
  const counts = {
    champions: Object.keys(b?.champions ?? {}).length,
    traits: traits.length,
    augments: augments.length,
    items: Object.keys(b?.items ?? {}).length,
    'active.items': b?.active?.items?.length ?? 0,
    'active.augments': b?.active?.augments?.length ?? 0,
    plannerCodes: Object.keys(b?.plannerCodes ?? {}).length,
  };
  for (const lang of LANGS) {
    counts[`augment-texte ${lang}`] = augments.filter(a => a?.i18n?.[lang]?.desc).length;
    counts[`synergie-namen ${lang}`] = traits.filter(t => t?.names?.[lang]).length;
  }
  return counts;
}

/** Rueckgabe: Liste der Befunde. */
export function compareBundles(prev, next, maxLoss = MAX_LOSS) {
  const before = bundleCounts(prev);
  const after = bundleCounts(next);
  const out = [];
  if (!after.champions || !after.traits || !after['active.items']) out.push('Bundle ohne Units, Synergien oder Items');
  if (prev?.set !== next?.set) return out;
  for (const [key, was] of Object.entries(before)) {
    if (after[key] < was * (1 - maxLoss)) out.push(`${key}: ${was} → ${after[key]}`);
  }
  return out;
}

function main() {
  const next = readFileSync('public/tft-assets.json', 'utf8');
  const parsed = JSON.parse(next);
  const twin = readFileSync(`public/tft-assets-${parsed.set}.json`, 'utf8');
  const findings = [];
  if (twin !== next) findings.push(`public/tft-assets.json und public/tft-assets-${parsed.set}.json unterscheiden sich`);
  const head = JSON.parse(execFileSync('git', ['show', 'HEAD:public/tft-assets.json'], { maxBuffer: 1 << 29 }).toString());
  findings.push(...compareBundles(head, parsed));
  for (const f of findings) console.error(`BEFUND ${f}`);
  console.log(`Bundle-Vergleich: ${findings.length} Befunde`);
  process.exitCode = findings.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) main();

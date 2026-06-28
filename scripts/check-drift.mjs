// Drift-Gate (Audit 2026-06-28). Asserts that the region lists which CANNOT
// share a single import (TS bundle, bash script, inline SQL) stay in sync with
// the SoT scripts/lib/active-regions.mjs. Run via `npm run check:drift` and in
// the pre-push hook. Region-list drift caused multiple silent bugs (ph2/th2,
// watchdog false-positives) — this catches it mechanically before push.

import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { readFileSync } from 'node:fs';

const norm = (arr) => [...new Set(arr)].sort().join(',');
const SOT = norm(ACTIVE_REGIONS);
let failures = 0;

function check(name, arr) {
  if (norm(arr) !== SOT) {
    console.error(`✗ DRIFT: ${name} (${arr.length}) != active-regions.mjs SoT (${ACTIVE_REGIONS.length})`);
    console.error(`    SoT: ${SOT}`);
    console.error(`    got: ${norm(arr)}`);
    failures++;
  } else {
    console.log(`✓ ${name} in sync (${arr.length})`);
  }
}

function read(path) {
  try { return readFileSync(path, 'utf8'); } catch { return ''; }
}

// 1) app/lib/active-regions.ts (TS bundle mirror — can't import the .mjs)
{
  const t = read('app/lib/active-regions.ts');
  // (?!_) excludes ACTIVE_REGIONS_WEST/_ASIA; [^=]* skips the `: readonly string[]`
  // type annotation between the name and `=`.
  const block = t.match(/ACTIVE_REGIONS(?!_)[^=]*=\s*\[([\s\S]*?)\]/);
  const arr = block ? [...block[1].matchAll(/'([a-z0-9]+)'/g)].map((m) => m[1]) : [];
  check('app/lib/active-regions.ts', arr);
}

// 2) marketvalue-watchdog.sh — bash array + inline SQL VALUES (both hardcoded)
{
  const sh = read('infra/hetzner/metastats-marketvalue-watchdog.sh');
  const bash = sh.match(/ACTIVE_REGIONS=\(([^)]*)\)/);
  check('mv-watchdog.sh bash-array', bash ? bash[1].trim().split(/\s+/).filter(Boolean) : []);
  check('mv-watchdog.sh SQL-VALUES', [...sh.matchAll(/\('([a-z0-9]+)'\)/g)].map((m) => m[1]));
}

if (failures) {
  console.error(`\n${failures} region-list drift(s) — sync them with scripts/lib/active-regions.mjs before pushing.`);
  process.exit(1);
}
console.log('\nAll out-of-band region lists in sync with the SoT.');

// Drift-Gate (Audit 2026-06-28). Asserts that the region lists which CANNOT
// share a single import (TS bundle, bash script, inline SQL) stay in sync with
// the SoT scripts/lib/active-regions.mjs. Run via `npm run check:drift` and in
// the pre-push hook. Region-list drift caused multiple silent bugs (ph2/th2,
// watchdog false-positives) — this catches it mechanically before push.

import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { readFileSync, readdirSync } from 'node:fs';

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

// 3) Riot-Limiter-Literale. `scripts/lib/riot-limits.mjs` ist die SoT; jedes
// nackte `shortWindowRequests: <zahl>` daneben ist potentielle Drift. Genau so
// ist prewarm-tft-player-cache.mjs auf 180 stehengeblieben, als die Box-Batches
// am 2026-08-02 auf 130 gesenkt wurden — off-box, von keinem Conflicts= erfasst
// und deshalb bei der Umstellung schlicht übersehen.
//
// Noch nicht auf die Lib umgestellte Scripts stehen hier mit ihrem erwarteten
// Wert. Wer den Wert ändert, muss diese Zeile anfassen — und denkt damit
// zwangsläufig über das Gesamtbudget nach, statt nur eine Zahl zu drehen.
{
  const ALLOWED = {
    'scripts/collect-tft-allranks.mjs': 130,
    'scripts/collect-tft-marketvalues.mjs': 130,
    'scripts/refresh-api-server.mjs': 18,   // 18/1,1s + 60/10,5s Langfenster
  };
  const files = readdirSync('scripts', { recursive: true })
    .map((f) => `scripts/${String(f).replace(/\\/g, '/')}`)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('lib/riot-limits.mjs'));

  let limiterDrift = 0;
  for (const f of files) {
    const m = read(f).match(/shortWindowRequests:\s*(\d+)/);
    if (!m) continue;
    const got = Number(m[1]);
    if (!(f in ALLOWED)) {
      console.error(`✗ DRIFT: ${f} setzt shortWindowRequests: ${got} als Literal`);
      console.error(`    → auf riotWindowFor() aus scripts/lib/riot-limits.mjs umstellen,`);
      console.error(`      oder bewusst in die ALLOWED-Liste in check-drift.mjs aufnehmen.`);
      limiterDrift++;
    } else if (ALLOWED[f] !== got) {
      console.error(`✗ DRIFT: ${f} hat shortWindowRequests: ${got}, erwartet ${ALLOWED[f]}`);
      console.error(`    → Budget in riot-limits.mjs gegenrechnen, dann hier nachziehen.`);
      limiterDrift++;
    }
  }
  failures += limiterDrift;
  if (!limiterDrift) {
    console.log(`✓ Riot-Limiter-Literale sauber (${Object.keys(ALLOWED).length} bewusst erlaubt)`);
  }
}

if (failures) {
  console.error(`\n${failures} Drift(s) — vor dem Push mit der jeweiligen SoT synchronisieren.`);
  process.exit(1);
}
console.log('\nAll out-of-band region lists in sync with the SoT.');

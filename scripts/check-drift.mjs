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

// 3) infra/contracts.json — jeder Abdeckungs-Vertrag mit groupColumn "region"
// führt die 15 Regionen als JSON-Literal. Kommt eine Region dazu und wird die
// Liste hier vergessen, prüft der Vertrag sie schlicht nicht — er bleibt grün
// und meldet gerade NICHT, dass die neue Region nie beliefert wird. Das ist die
// unauffälligste Art, eine Überwachung zu verlieren.
{
  let contracts = [];
  try {
    contracts = JSON.parse(read('infra/contracts.json')).contracts ?? [];
  } catch (e) {
    console.error(`✗ DRIFT: infra/contracts.json nicht lesbar (${e.message})`);
    failures++;
  }
  const regionCoverage = contracts.filter(
    (c) => c.type === 'coverage' && c.groupColumn === 'region' && Array.isArray(c.groups),
  );
  if (regionCoverage.length === 0 && contracts.length > 0) {
    console.error('✗ DRIFT: kein Abdeckungs-Vertrag mit groupColumn "region" gefunden');
    console.error('    → wurde er umbenannt oder gelöscht? Ohne ihn fällt eine einzelne');
    console.error('      eingefrorene Region wieder monatelang niemandem auf.');
    failures++;
  }
  for (const c of regionCoverage) check(`contracts.json ${c.id}`, c.groups);
}

// 4) Riot-Limiter-Literale. `scripts/lib/riot-limits.mjs` ist die SoT; jedes
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

// 5) Set-Literale. Es gibt keine CURRENT_SET-Konstante; die einzige Wahrheit ist
// public/tft-assets.json .set, und die wird zur Laufzeit geladen. Verstreut im
// Code stehen hartkodierte Fallbacks (`setNumber ?? 17`, `currentSet = 17`,
// `const GUIDE_SET = 17`), die beim Set-Wechsel einzeln nachgezogen werden
// muessen — und genau dann uebersieht man zwei davon.
//
// Bewusst KEIN Dauerverbot: die Regel schlaegt erst an, wenn ein Literal vom
// tatsaechlichen Set abweicht. Zwoelf gleichzeitige Blocker bei einem Push, der
// mit dem Set nichts zu tun hat, waeren die zuverlaessigste Art, sich
// `--no-verify` anzugewoehnen. So ist es ein Wecker beim Bump statt Dauerlaerm.
//
// Der Bundle-Commit kommt vom Daten-Workflow und sieht nie einen lokalen Hook —
// der Wecker klingelt also zuerst in der CI, beim Menschen erst nach dem Pull.
//
// PINNED haelt zusaetzlich fest, WIEVIELE Stellen pro Datei bekannt sind. Wer
// ein neues Literal einfuehrt statt das Set durchzureichen, muss diese Zahl
// anfassen — und denkt damit darueber nach, ob der Fallback ueberhaupt sein muss.
{
  const PINNED = {
    'app/api/tft/comps/variants/route.ts': 1,
    'app/api/tft/meta-pulse/route.ts': 1,
    'app/components/tft/CompCard.tsx': 1,
    'app/components/tft/CompRow.tsx': 1,
    'app/lib/tft-classify-comp.ts': 2,
    'app/lib/tft-comp-guides.ts': 1,
    'scripts/lib/metatft-cluster-family.mjs': 3,
    'scripts/lib/tft-classify-comp.mjs': 2,
    'scripts/reclassify-match-cache.mjs': 1,
    'scripts/refresh-api-server.mjs': 1,
  };

  let currentSet = null;
  try { currentSet = JSON.parse(read('public/tft-assets.json')).set; } catch { /* unten */ }

  if (typeof currentSet !== 'number') {
    console.error('✗ DRIFT: public/tft-assets.json hat kein numerisches .set');
    console.error('    → ohne diese SoT kann der Set-Literal-Check nichts pruefen.');
    failures++;
  } else {
    // Zwei Einschraenkungen, beide noetig — einzeln ist jede zu locker:
    //
    //  a) "set" als eigenes Wort in einem Bezeichner, nicht als Teilstring.
    //     Sonst meldet jedes `offset = 20` einen Fehlalarm.
    //  b) plausibler Set-Wertebereich. `set`-Token allein trifft sonst jeden
    //     React-Setter (`const [x, setX] = useState(0)` — "setX" zerfaellt zu
    //     "set"+"X") und jedes `new Set(...)`. TFT-Sets sind zweistellig; damit
    //     fallen die 0/1/5/8-Treffer weg, ohne echte Fundstellen zu verlieren.
    const SET_RANGE = [10, 30];
    const hasSetToken = (s) => {
      for (const id of s.match(/[A-Za-z_$][\w$]*/g) || []) {
        const parts = id.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[_\s]+/);
        if (parts.some((p) => p.toLowerCase() === 'set')) return true;
      }
      return /--set\b/.test(s);
    };

    const sources = (dir) => readdirSync(dir, { recursive: true })
      .map((f) => `${dir}/${String(f).replace(/\\/g, '/')}`)
      .filter((f) => /\.(ts|tsx|mjs|js)$/.test(f))
      .filter((f) => !f.includes('/node_modules/') && !f.includes('/.next/'));

    const found = {};
    for (const f of [...sources('app'), ...sources('scripts')]) {
      read(f).split(/\r?\n/).forEach((raw, i) => {
        if (/^\s*[*/]/.test(raw)) return;                 // reine Kommentarzeile
        const line = raw.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
        if (!hasSetToken(line)) return;
        // Zuweisung / Default / Coalesce — bewusst NICHT <=, >=, ==, !=.
        const m = line.match(/(?:\|\||\?\?|(?<![<>=!])=(?!=))\s*(\d{2})\b/);
        if (!m) return;
        const value = Number(m[1]);
        if (value < SET_RANGE[0] || value > SET_RANGE[1]) return;
        (found[f] ??= []).push({ line: i + 1, value });
      });
    }

    let setDrift = 0;
    for (const [f, hits] of Object.entries(found)) {
      for (const h of hits) {
        if (h.value !== currentSet) {
          console.error(`✗ DRIFT: ${f}:${h.line} kodiert Set ${h.value}, aktuell ist ${currentSet}`);
          console.error(`    → tft-assets.json ist auf Set ${currentSet} gesprungen; dieses Literal nachziehen.`);
          setDrift++;
        }
      }
      const expected = PINNED[f];
      if (expected === undefined) {
        console.error(`✗ DRIFT: ${f} fuehrt ${hits.length} neue(s) Set-Literal(e) ein`);
        console.error(`    → Set durchreichen statt hartkodieren, oder bewusst in PINNED aufnehmen.`);
        setDrift++;
      } else if (expected !== hits.length) {
        console.error(`✗ DRIFT: ${f} hat ${hits.length} Set-Literale, PINNED sagt ${expected}`);
        console.error(`    → Zahl in check-drift.mjs nachziehen, damit die Liste ehrlich bleibt.`);
        setDrift++;
      }
    }
    for (const f of Object.keys(PINNED)) {
      if (!found[f]) {
        console.error(`✗ DRIFT: ${f} hat keine Set-Literale mehr, steht aber in PINNED`);
        console.error(`    → Eintrag entfernen.`);
        setDrift++;
      }
    }

    failures += setDrift;
    if (!setDrift) {
      const total = Object.values(found).reduce((s, h) => s + h.length, 0);
      console.log(`✓ Set-Literale auf Set ${currentSet} (${total} Stellen, ${Object.keys(PINNED).length} Dateien gepinnt)`);
    }
  }
}

// 6) Test-Dateien. `node --test` exitet mit 0, wenn der Glob NICHTS findet —
// verifiziert mit Node 22.20. Das pre-push-Gate 2 waere dann still wirkungslos,
// und nichts wuerde es melden. Ein Rename auf .spec.mjs, ein Verschieben nach
// app/lib oder eine Glob-Aenderung in package.json reichen dafuer aus.
{
  const EXPECTED_TESTS = [
    'scripts/lib/pro-row-filter.test.mjs',
    'scripts/lib/tft-crawl-window.test.mjs',
    'scripts/lib/tft-classify-comp.test.mjs',
    'scripts/lib/tft-skill-score.test.mjs',
    'app/lib/tft-classify-comp.test.mjs',
    'app/lib/tft-comp-family-merge.test.mjs',
    'app/lib/tft-comp-level-outcome.test.mjs',
    'app/lib/tft-comp-guides.test.mjs',
  ];
  const missing = EXPECTED_TESTS.filter((f) => read(f) === '');
  if (missing.length) {
    for (const f of missing) {
      console.error(`✗ DRIFT: Testdatei ${f} fehlt oder ist leer`);
    }
    console.error(`    → verschoben/umbenannt? Dann den Glob in package.json UND diese Liste nachziehen.`);
    console.error(`      Bewusst geloescht? Eintrag hier entfernen — sonst faellt der stille Ausfall niemandem auf.`);
    failures += missing.length;
  } else {
    console.log(`✓ Testdateien vorhanden (${EXPECTED_TESTS.length} erwartet)`);
  }
}

if (failures) {
  console.error(`\n${failures} Drift(s) — vor dem Push mit der jeweiligen SoT synchronisieren.`);
  process.exit(1);
}
console.log('\nAll out-of-band region lists in sync with the SoT.');

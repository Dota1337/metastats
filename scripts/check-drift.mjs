// Drift-Gate (Audit 2026-06-28). Asserts that the region lists which CANNOT
// share a single import (TS bundle, bash script, inline SQL) stay in sync with
// the SoT scripts/lib/active-regions.mjs. Run via `npm run check:drift` and in
// the pre-push hook. Region-list drift caused multiple silent bugs (ph2/th2,
// watchdog false-positives) — this catches it mechanically before push.

import { ACTIVE_REGIONS } from './lib/active-regions.mjs';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

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

// 5) Set-Kopplung. Bis zum Set-18-Umbau stand hier eine Liste hartkodierter
// Set-Literale (PINNED, 14 Stellen in 10 Dateien) — der Wecker beim Bump.
// Diese Literale sind weg: CURRENT_SET aus public/tft-set.json ist die einzige
// Quelle, jede Stelle zieht automatisch mit.
//
// Damit waere dieser Block eine Attrappe, die `0 Stellen, 0 Dateien gepinnt`
// meldet und nichts mehr prueft — ein Netto-Verlust an Sicherheit, denn beim
// Bump bleibt weiterhin Handarbeit uebrig. Er wacht deshalb jetzt ueber:
//
//   a) keine NEUEN Set-Literale. Der alte Zweck, jetzt ohne Ausnahmenliste:
//      wer ein Literal einfuehrt statt CURRENT_SET zu nutzen, wird gemeldet.
//   b) tft-set.json == tft-assets.json. Die beiden Dateien sind getrennte
//      Laeufe desselben Workflows; tft-set.json ist gegated, tft-assets.json
//      folgte frueher ungegatet der CDragon-Datenlage und sprang Tage zu
//      frueh (gefixt in fetch-tft-assets.mjs:pickActiveSet). Divergieren sie
//      je wieder, ist genau dieser Fix kaputt.
//   c) die set-nummerierten Datenfiles existieren fuers aktuelle Set. Ohne
//      tft-assets-{set}.json liefert loadCostMap eine leere Cost-Map und der
//      Carry-Swap wird still zum No-Op.
//   d) SET_LAUNCH_LOL kennt das aktuelle Set. Fehlt der Anker, ist JEDES
//      Patch-Label des Sets verschoben.
//
// Der Bundle-Commit kommt vom Daten-Workflow und sieht nie einen lokalen Hook —
// der Wecker klingelt also zuerst in der CI, beim Menschen erst nach dem Pull.
{
  // Keine Ausnahmen mehr: nach dem Umbau darf keine Datei ein Set-Literal
  // tragen. Wer eines braucht, traegt es hier bewusst ein und begruendet es.
  const PINNED = {};

  // SoT ist tft-set.json, NICHT tft-assets.json — nur erstere kennt das
  // Bump-Gate aus detect-tft-set.mjs. Begruendung in scripts/lib/current-set.mjs.
  let currentSet = null;
  try { currentSet = JSON.parse(read('public/tft-set.json')).setNumber; } catch { /* unten */ }

  if (typeof currentSet !== 'number') {
    console.error('✗ DRIFT: public/tft-set.json hat kein numerisches setNumber');
    console.error('    → ohne diese SoT kann der Set-Check nichts pruefen.');
    failures++;
  } else {
    // b) Gegenprobe gegen die ungegatete Asset-Datei.
    let assetSet = null;
    try { assetSet = JSON.parse(read('public/tft-assets.json')).set; } catch { /* siehe unten */ }
    // setDrift sammelt ALLE Befunde dieses Blocks — auch b/c/d. Zaehlten die
    // auf `failures` statt hierhin, druckte der Erfolgszweig unten trotzdem
    // sein Haekchen neben die Fehler. Verifiziert: genau das passierte in der
    // Set-18-Gegenprobe.
    let setDrift = 0;

    if (typeof assetSet !== 'number') {
      console.error('✗ DRIFT: public/tft-assets.json hat kein numerisches .set');
      setDrift++;
    } else if (assetSet !== currentSet) {
      console.error(`✗ DRIFT: tft-set.json sagt Set ${currentSet}, tft-assets.json sagt ${assetSet}`);
      console.error('    → fetch-tft-assets.mjs soll dem Gate folgen (pickActiveSet).');
      console.error('    → Divergenz heisst: der Gate-Fix ist kaputt oder wurde umgangen.');
      setDrift++;
    }

    // c) Datenfiles fuers aktuelle Set.
    for (const f of [`public/tft-assets-${currentSet}.json`, `public/tft-metatft-comps-${currentSet}.json`]) {
      if (!existsSync(f)) {
        console.error(`✗ DRIFT: ${f} fehlt fuer Set ${currentSet}`);
        console.error('    → ohne diese Datei klassifiziert der Lesepfad still gegen eine leere Map.');
        setDrift++;
      }
    }

    // d) Patch-Anker.
    if (!new RegExp(`^\\s*${currentSet}:`, 'm').test(read('scripts/detect-tft-set.mjs'))) {
      console.error(`✗ DRIFT: SET_LAUNCH_LOL in detect-tft-set.mjs kennt Set ${currentSet} nicht`);
      console.error('    → ohne Anker ist jedes Patch-Label dieses Sets verschoben.');
      setDrift++;
    }

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

    // e) set-nummerierte Dateien in public/. Zwei Klassen, bewusst getrennt:
    //    eine Datei fuer ein NEUERES Set als die SoT ist ein Fehler (etwas hat
    //    am Gate vorbei gebumpt); eine Familie ohne Datei fuers laufende Set
    //    ist eine Warnung — manche Familien sind abgeloest (comp-guides) und
    //    werden bewusst nicht mehr nachgezogen.
    const setFiles = readdirSync('public')
      .map((f) => ({ f, m: String(f).match(/^(.*)-(\d{2})\.json$/) }))
      .filter((x) => x.m);
    const families = {};
    for (const { f, m } of setFiles) {
      const [, family, num] = m;
      (families[family] ??= []).push({ f, n: Number(num) });
    }
    const familiesOhneAktuelles = [];
    for (const [family, files] of Object.entries(families)) {
      for (const { f, n } of files) {
        if (n > currentSet) {
          console.error(`✗ DRIFT: public/${f} gehoert zu Set ${n}, die SoT sagt ${currentSet}`);
          console.error('    → etwas hat am Bump-Gate (detect-tft-set.mjs) vorbei geschrieben.');
          setDrift++;
        }
      }
      if (!files.some((x) => x.n === currentSet)) familiesOhneAktuelles.push(family);
    }
    if (familiesOhneAktuelles.length) {
      console.warn(`⚠ Set ${currentSet} ohne eigene Datei: ${familiesOhneAktuelles.join(', ')}`);
      console.warn('    → wenn die Familie noch gelesen wird, zeigt sie Daten des Vorsets.');
    }

    // g) hartkodierte /^TFT\d+_/-Muster. Genau daran ist Set 18 gebrochen:
    //    Riot hat die Champion-IDs auf DA_18_* umbenannt, und jede Stelle mit
    //    diesem Muster hat still ausgefiltert statt zu melden. Warnung, kein
    //    Fehler — ein Fallback fuer alte Cache-Zeilen darf das Muster tragen.
    const PREFIX_RE = new RegExp('TFT\\d{2}_|TFT\\\\d');
    // Testdateien tragen Set-IDs als Fixture — das ist ihr Zweck, kein Drift.
    // Und nur Zeilen, die mit dem Prefix FILTERN, sind gefaehrlich: eine ID in
    // einer Datenzeile ist harmlos, ein startsWith('TFT17_') wirft im Set 18
    // still alles weg.
    const FILTER_RE = /startsWith\(|\.test\(|\.match\(|new RegExp|replace\(|\/\^TFT/;
    const prefixHits = [];
    for (const f of [...sources('app'), ...sources('scripts')].filter((f) => !/\.test\.mjs$/.test(f))) {
      read(f).split(/\r?\n/).forEach((raw, i) => {
        if (/^\s*[*/]/.test(raw)) return;
        // Zwei Formen: das Literal (TFT17_) und das Muster im Quelltext
        // (TFT\\d). TFT5_Item_*Radiant ist bewusst NICHT gemeint — das ist ein
        // set-uebergreifendes Item, kein Set-Prefix des laufenden Sets.
        if (!FILTER_RE.test(raw)) return;
        // Bereits set-agnostisch gewidend (…|DA)_ — kein Treffer.
        if (/\|DA\)/.test(raw)) return;
        if (PREFIX_RE.test(raw)) prefixHits.push(`${f}:${i + 1}`);
      });
    }
    if (prefixHits.length) {
      console.warn(`⚠ ${prefixHits.length} hartkodierte TFT<Nr>_-Muster: ${prefixHits.slice(0, 5).join(', ')}`);
      console.warn('    → Set 18 heisst DA_18_*; solche Muster filtern still statt zu melden.');
    }

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

    for (const [f, hits] of Object.entries(found)) {
      for (const h of hits) {
        if (h.value !== currentSet) {
          console.error(`✗ DRIFT: ${f}:${h.line} kodiert Set ${h.value}, aktuell ist ${currentSet}`);
          console.error(`    → CURRENT_SET nutzen (app/lib/current-set.ts bzw. scripts/lib/current-set.mjs).`);
          setDrift++;
        }
      }
      const expected = PINNED[f];
      if (expected === undefined) {
        console.error(`✗ DRIFT: ${f} fuehrt ${hits.length} neue(s) Set-Literal(e) ein`);
        console.error(`    → CURRENT_SET importieren statt hartkodieren; nur mit Begruendung in PINNED aufnehmen.`);
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
      const pinned = Object.keys(PINNED).length;
      console.log(
        `✓ Set-Kopplung auf Set ${currentSet}`
        + ` (tft-set.json == tft-assets.json, Datenfiles da, Patch-Anker da,`
        + ` ${total} Set-Literale${pinned ? `, ${pinned} bewusst gepinnt` : ''})`,
      );
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

// 7) CDragon-Base des Bild-Proxys. `scripts/fetch-tft-assets.mjs` schreibt
// `iconBase` ins Bundle, `app/lib/cdragon-base.ts` prueft die Allowlist der
// Proxy-Route dagegen. Zwei Literale, die niemand zusammen anfasst — genau
// die Mirror-Pair-Klasse, die im Repo schon einmal still auseinanderlief.
//
// Driften sie, faellt NICHT der Proxy aus: `proxied()` vergleicht die Base und
// reicht bei Ungleichheit stillschweigend die direkte URL durch. Der Proxy
// waere also wirkungslos, ohne dass irgendetwas kaputt aussieht. Deshalb hier.
{
  const ts = read('app/lib/cdragon-base.ts');
  const lit = ts.match(/CDRAGON_GAME_BASE\s*=\s*'([^']+)'/)?.[1] ?? null;
  let bundleBase = null;
  try { bundleBase = JSON.parse(read('public/tft-assets.json')).iconBase; } catch { /* unten */ }

  if (!lit) {
    console.error('✗ DRIFT: CDRAGON_GAME_BASE in app/lib/cdragon-base.ts nicht gefunden');
    console.error('    → umbenannt? Dann diesen Check nachziehen, sonst prueft er nichts mehr.');
    failures++;
  } else if (typeof bundleBase !== 'string') {
    console.error('✗ DRIFT: public/tft-assets.json hat kein iconBase');
    failures++;
  } else if (lit !== bundleBase) {
    console.error(`✗ DRIFT: cdragon-base.ts sagt ${lit}, tft-assets.json sagt ${bundleBase}`);
    console.error('    → der Bild-Proxy greift dann nicht mehr und reicht still direkt durch.');
    failures++;
  } else {
    console.log(`✓ Bild-Proxy-Base in sync (${lit})`);
  }
}

// 8) Team-Planner-Codes im Asset-Bundle. Gleiche Klasse wie iconBase: faellt
// `plannerCodes` bei einem Set-Bump weg (CDragon liefert den Block erst
// verzoegert, oder der Key wird umbenannt), sieht nichts kaputt aus — der
// Plan-Ahead-Button meldet nur noch "fehlgeschlagen", und das faellt niemandem
// auf. Untergrenze bewusst niedrig: Set 18 fuehrt 74 Eintraege, ein frisches
// Set darf darunter liegen, aber nicht beliebig.
{
  const MIN_PLANNER_CODES = 40;
  let bundle = null;
  try { bundle = JSON.parse(read('public/tft-assets.json')); } catch { /* unten */ }
  const codes = bundle?.plannerCodes;
  const n = codes && typeof codes === 'object' ? Object.keys(codes).length : -1;

  if (n < 0) {
    console.error('✗ DRIFT: public/tft-assets.json hat kein plannerCodes');
    console.error('    → der in-game Team-Planner-Code laesst sich dann nicht mehr bauen (app/lib/tft-plan-ahead-code.ts).');
    failures++;
  } else if (n < MIN_PLANNER_CODES) {
    console.error(`✗ DRIFT: nur ${n} plannerCodes im Bundle (<${MIN_PLANNER_CODES})`);
    console.error('    → scripts/fetch-tft-assets.mjs gegen CDragons tftchampions-teamplanner.json pruefen.');
    failures++;
  } else {
    console.log(`✓ Team-Planner-Codes im Bundle (${n})`);
  }
}

if (failures) {
  console.error(`\n${failures} Drift(s) — vor dem Push mit der jeweiligen SoT synchronisieren.`);
  process.exit(1);
}
console.log('\nAll out-of-band region lists in sync with the SoT.');

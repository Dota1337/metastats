#!/usr/bin/env node
/**
 * Pre-push classification verifier. Catches the kind of mistakes that ate
 * three iterations on /tft/augments in 2026-06-10 — Pattern-
 * Heuristics that "look right" but disagree with ground-truth.
 *
 * Hard rules (exit 1 on any failure):
 *   • Every augment in active.augments has tier ∈ {1,2,3}
 *   • For every apiName in tft-augment-tiers-{N}.json, the bundle's tier
 *     MUST equal the override (= tactics.tools ground-truth)
 *   • Override coverage of active.augments ≥ 90 %
 *   • Tier distribution sanity: each of Silver/Gold/Prismatic > 0,
 *     no tier exceeds 70 % of the total (catches "everything fell into
 *     Silver-default" regressions)
 *
 * Run manually: `node scripts/verify-classifications.mjs`
 * Auto via hook: `infra/git-hooks/pre-push` (install via `npm run setup-hooks`)
 */
import { readFileSync, existsSync } from 'node:fs';

const ERR = [];
const WARN = [];
function fail(msg) { ERR.push(msg); }
function warn(msg) { WARN.push(msg); }

function loadJson(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (e) { fail(`Could not parse ${path}: ${e.message}`); return null; }
}

const bundle = loadJson('public/tft-assets.json');
if (!bundle) { console.error('FAIL: public/tft-assets.json missing or invalid'); process.exit(1); }
const set = bundle.set;
const overridePath = `public/tft-augment-tiers-${set}.json`;
const override = loadJson(overridePath);
const compsPath = `public/tft-metatft-comps-${set}.json`;
const metatftComps = loadJson(compsPath);

console.log(`Verifying classifications for set ${set} (${bundle.setName})`);
console.log(`  bundle augments: ${Object.keys(bundle.augments || {}).length}`);
console.log(`  active.augments: ${bundle.active?.augments?.length || 0}`);
console.log(`  tier-override:   ${override ? Object.keys(override.tiers || {}).length : 'MISSING'}`);
console.log(`  metatft-comps:   ${metatftComps ? (metatftComps.comps || []).length : 'MISSING'}`);
console.log(`  family-map:      ${metatftComps ? Object.keys(metatftComps.familyMap || {}).length : 'MISSING'}`);
console.log();

// 1. Tier values are valid
const activeList = bundle.active?.augments || [];
if (activeList.length === 0) fail('active.augments is empty — bundle wasn\'t regenerated or filter wiped everything');

for (const apiName of activeList) {
  const a = bundle.augments[apiName];
  if (!a) { fail(`active.augments lists ${apiName} but bundle.augments has no entry`); continue; }
  if (![1, 2, 3].includes(a.tier)) fail(`${apiName} has invalid tier=${a.tier}`);
}

// 2. Override-match: every pinned augment in the bundle must match the override
if (override?.tiers) {
  let mismatched = 0;
  for (const [apiName, expectTier] of Object.entries(override.tiers)) {
    const a = bundle.augments[apiName];
    if (!a) continue; // override may list augments outside this set's whitelist
    if (a.tier !== expectTier) {
      fail(`Tier-mismatch: ${apiName} (${a.name}) — bundle=${a.tier}, tactics.tools=${expectTier}`);
      mismatched++;
      if (mismatched >= 20) { fail(`… aborting tier-match report after 20 mismatches`); break; }
    }
  }
} else {
  warn(`No override file at ${overridePath} — tier-source is heuristic only. Re-run scripts/refresh-augment-tiers.mjs.`);
}

// 3. Coverage: ≥ 90 % of active.augments pinned by tactics.tools
if (override?.tiers && activeList.length > 0) {
  const pinned = activeList.filter(id => override.tiers[id] != null).length;
  const pct = pinned / activeList.length;
  console.log(`  override coverage: ${pinned}/${activeList.length} (${(pct * 100).toFixed(1)} %)`);
  if (pct < 0.9) fail(`Override coverage ${(pct * 100).toFixed(1)} % is below 90 % threshold`);
}

// 4b. Icon presence: every active augment must have a non-empty icon path.
//     Augment icons come from CDragon (Riot's artwork) — there's no public
//     source that ships truly tier-specific icons for every augment, see
//     reference_tft_augment_icon_sources.md.
let iconMissing = 0;
for (const id of activeList) {
  const a = bundle.augments[id];
  if (!a?.icon || a.icon.trim() === '') {
    if (iconMissing < 5) fail(`Icon missing: ${id} (${a?.name || ''})`);
    iconMissing++;
  }
}
if (iconMissing >= 5) fail(`… ${iconMissing - 5} additional icon-missing entries not shown`);

// 6. Tier distribution sanity
if (activeList.length > 0) {
  const dist = { 1: 0, 2: 0, 3: 0 };
  for (const id of activeList) {
    const t = bundle.augments[id]?.tier;
    if (dist[t] != null) dist[t]++;
  }
  console.log(`  tier distribution: Silver=${dist[1]} Gold=${dist[2]} Prismatic=${dist[3]}`);
  for (const t of [1, 2, 3]) {
    if (dist[t] === 0) fail(`No augments classified as tier ${t} — likely a filter/default regression`);
    if (dist[t] / activeList.length > 0.7) fail(`Tier ${t} holds ${((dist[t] / activeList.length) * 100).toFixed(0)} % of augments — likely default-fallthrough regression`);
  }
}

// 7. MetaTFT-Comps — Schema, Bundle-Linkage, Familien-Map-Integritaet.
//
// Loest die frueheren Checks 7 (tftacademy-Guides) und 8 (redaktionelle
// Slug-Map) ab. Der Unterschied: die Familien-Map wird generiert, nicht
// gepflegt — also pruefen wir nicht mehr auf Pflegefehler, sondern auf
// Verweis-Integritaet zwischen Map, Comps und Details.
if (metatftComps) {
  const comps = Array.isArray(metatftComps.comps) ? metatftComps.comps : null;
  if (!comps) {
    fail(`${compsPath}: comps is not an array`);
  } else {
    if (Number(metatftComps.set) !== Number(set)) {
      fail(`${compsPath}: set ${metatftComps.set} != bundle set ${set} — Comps waeren aus dem falschen Set`);
    }

    const VALID_AUG_GRADES = new Set(['S', 'A', 'B', 'C', 'D']);
    const compIds = new Set();
    let unknownAugs = 0;
    let unknownUnits = 0;
    let totalAugRefs = 0;
    for (const comp of comps) {
      if (!comp?.id) { fail(`${compsPath}: comp ohne id`); continue; }
      if (compIds.has(comp.id)) fail(`${compsPath}: doppelte comp id "${comp.id}"`);
      compIds.add(comp.id);

      // (a) Augments: `tier` ist MetaTFTs Performance-Grade S-D in dieser Comp,
      //     NICHT die Rarity 1-3. Die UI gruppiert danach — ein unbekannter
      //     Buchstabe wuerde die Gruppe stumm verschlucken.
      //     Nicht jedes gerankte Augment ist in unserem Set-Bundle: MetaTFT
      //     rankt ueber Sets hinweg, gemessen 1,6 % Drift. Deshalb Warnung,
      //     und erst ein Fail, wenn ein grosser Anteil fehlt.
      if (!Array.isArray(comp.augments)) {
        fail(`Comp "${comp.id}": augments ist kein Array`);
      } else {
        for (const a of comp.augments) {
          if (!bundle.augments[a?.id]) {
            if (unknownAugs < 5) warn(`Comp "${comp.id}": Augment ${a?.id} nicht in bundle.augments (wird nicht gerendert)`);
            unknownAugs++;
          }
          if (!VALID_AUG_GRADES.has(a?.tier)) {
            fail(`Comp "${comp.id}": Augment ${a?.id} hat Grade "${a?.tier}" (erwartet S/A/B/C/D)`);
          }
        }
        totalAugRefs += comp.augments.length;
      }

      // (b) Units muessen Champions des Sets sein.
      if (!Array.isArray(comp.units)) {
        fail(`Comp "${comp.id}": units ist kein Array`);
      } else {
        for (const u of comp.units) {
          if (!bundle.champions[u]) {
            if (unknownUnits < 5) warn(`Comp "${comp.id}": Unit ${u} nicht in bundle.champions`);
            unknownUnits++;
          }
        }
      }

      if (typeof comp.games !== 'number' || comp.games <= 0) {
        fail(`Comp "${comp.id}": games ist ${comp.games} (erwartet > 0)`);
      }
    }
    if (unknownAugs >= 5) warn(`… ${unknownAugs - 5} weitere unbekannte Augment-apiNames nicht gezeigt`);
    if (unknownUnits >= 5) warn(`… ${unknownUnits - 5} weitere unbekannte Units nicht gezeigt`);
    // Ueber 10 % heisst nicht Drift, sondern falsches Set oder kaputter Import.
    if (totalAugRefs > 0 && unknownAugs / totalAugRefs > 0.1) {
      fail(`${unknownAugs}/${totalAugRefs} Augment-Referenzen (${((unknownAugs / totalAugRefs) * 100).toFixed(1)} %) nicht in bundle.augments — Set-Drift oder kaputter Import`);
    }

    // (c) Familien-Map: keine Waisen. Jeder Wert muss auf eine vorhandene Comp
    //     zeigen — sonst zeigt die Comp-Seite fuer die Familie gar nichts an,
    //     obwohl die Map einen Treffer meldet.
    const familyMap = metatftComps.familyMap || {};
    const familyKeys = Object.keys(familyMap);
    if (familyKeys.length === 0) {
      fail(`${compsPath}: familyMap ist leer — keine Comp-Seite bekommt einen Guide`);
    }
    let orphans = 0;
    for (const [familyKey, clusterId] of Object.entries(familyMap)) {
      if (!compIds.has(clusterId)) {
        if (orphans < 5) fail(`familyMap["${familyKey}"] -> "${clusterId}" hat keine Comp`);
        orphans++;
      }
      // Schluesselform `<trait>__<carry>` (User-Override 2026-06-21). Ein
      // abweichendes Format trifft in findCompGuide nie.
      const m = /^(.+)__(.+)$/.exec(familyKey);
      if (!m) {
        fail(`familyMap: Schluessel "${familyKey}" nicht im Format <trait>__<carry>`);
      } else if (!bundle.champions[m[2]]) {
        fail(`familyMap["${familyKey}"]: Carry "${m[2]}" nicht in bundle.champions`);
      }
    }
    if (orphans >= 5) fail(`… ${orphans - 5} weitere Waisen in familyMap nicht gezeigt`);

    // (d) Kollisionen: ein Cluster darf mehrere Familien bedienen (Dual-Carry
    //     ist real), aber wenn einer sehr viele bedient, ist die Ableitung zu
    //     grob und die Familien bekommen einen unpassenden Guide.
    const perCluster = new Map();
    for (const clusterId of Object.values(familyMap)) {
      perCluster.set(clusterId, (perCluster.get(clusterId) || 0) + 1);
    }
    for (const [clusterId, count] of perCluster) {
      if (count > 8) warn(`Cluster "${clusterId}" bedient ${count} Familien — Ableitung moeglicherweise zu grob`);
    }

    // (e) Details muessen auf existierende Comps zeigen.
    for (const clusterId of Object.keys(metatftComps.details || {})) {
      if (!compIds.has(clusterId)) fail(`details["${clusterId}"] hat keine Comp`);
    }
    if (metatftComps.detailsCarriedForward) {
      warn(`${compsPath}: details stammen aus einem frueheren Lauf (detailsCarriedForward)`);
    }
  }
} else {
  warn(`Keine MetaTFT-Comps unter ${compsPath} — Comp-Detail-Guides rendern nicht. Neu holen: node scripts/refresh-metatft-comps.mjs`);
}

// 9. Item-Bucket-Classification — sanity check that itemBucketOf produces a
// sensible distribution across the bundle's active items. The actual classifier
// lives in app/lib/tft-item-bucket.ts; we mirror the same patterns here so a
// drift between the classifier and our expectations is caught at push time.
// Specifically: we want a reasonable count in each known bucket, and we want
// the "edge cases" from reference_tft_asset_quirks.md to land in the bucket
// they're memory-documented for.
const activeItems = bundle.active?.items || [];
if (activeItems.length > 0) {
  const bucketOf = (id) => {
    const meta = bundle.items?.[id];
    const name = meta?.name || '';
    // Mirror von app/lib/tft-item-bucket.ts — Muster dort identisch halten.
    // Kein `_Item_` im Muster: Set 18 fuehrt Artefakte als DA_Artifact_*.
    // Der schliessende Unterstrich haelt DA_Artifactinate18 (Spielmechanik)
    // draussen.
    if (/_Artifact_/i.test(id)) return 'artifact';
    const isEmblem =
      /EmblemItem$/.test(id) ||
      / Emblem$/.test(name) ||
      (Array.isArray(meta?.tags) && meta.tags.some(t => String(t).toLowerCase() === 'emblem'));
    if (isEmblem) return 'emblem';
    if (/Radiant$/.test(id) || /\bRadiant\b/.test(name)) return 'radiant';
    if (Array.isArray(meta?.composition) && meta.composition.length === 2) return 'standard';
    return 'other';
  };

  const dist = { standard: 0, artifact: 0, emblem: 0, radiant: 0, other: 0 };
  for (const id of activeItems) {
    const b = bucketOf(id);
    dist[b] = (dist[b] || 0) + 1;
  }

  // Each named bucket should have at least 5 entries in any healthy set —
  // protects against regex breaking silently and dumping everything into "other".
  for (const b of ['standard', 'artifact', 'emblem', 'radiant']) {
    if (dist[b] < 5) fail(`Item-Bucket "${b}" has only ${dist[b]} items — classifier regression likely.`);
  }

  // Known edge-case checks from reference_tft_asset_quirks.md.
  // (a) Classic Set-5 cross-set Radiants must land in 'radiant'
  const set5Sample = activeItems.find(id => /^TFT5_Item_.+Radiant$/.test(id));
  if (set5Sample && bucketOf(set5Sample) !== 'radiant') {
    fail(`Edge-case: ${set5Sample} should be 'radiant', got '${bucketOf(set5Sample)}'`);
  }
  // (b) Artifact pattern must catch universal AND set-prefixed Artifacts
  const artifactSample = activeItems.find(id => /_Item_Artifact_/i.test(id));
  if (artifactSample && bucketOf(artifactSample) !== 'artifact') {
    fail(`Edge-case: ${artifactSample} should be 'artifact', got '${bucketOf(artifactSample)}'`);
  }
  // (c) PsyOps_*_Radiant must land in 'radiant' (per memory: Riot's Trait-
  //     Radiant variants share the Radiant suffix and are correctly classified)
  const psyOpsRadiant = activeItems.find(id => /PsyOps.*_Radiant$/i.test(id));
  if (psyOpsRadiant && bucketOf(psyOpsRadiant) !== 'radiant') {
    fail(`Edge-case: ${psyOpsRadiant} should be 'radiant', got '${bucketOf(psyOpsRadiant)}'`);
  }
}

// 6. Shop-Pool: verschiedene Einheiten je Kostenstufe.
//
// Warum das hier steht: die Zahl war bis 2026-09-25 als Konstante in
// app/tft/tools/odds/page.tsx getippt und schon fuer Set 17 falsch
// (18/13/13/14/10 statt 14/13/13/14/9) — PvE-Monster, Trainingspuppe und
// Ausruestungs-Amboss zaehlten als Shop-Einheiten mit. Gemerkt hat es niemand,
// weil kein Waechter darauf schaute. Genau das ist dieser Waechter.
{
  // POOL_RULE_V1 — Zaehlregel, spiegelbildlich zu app/lib/tft-shop-pool.ts.
  // Aendert sich eine Seite, muss die andere mit. Der Marker unten prueft,
  // dass die TS-Seite noch existiert und denselben Regelstand traegt.
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const seen = new Set();
  for (const [apiName, champ] of Object.entries(bundle.champions || {})) {
    const cost = champ?.cost;
    if (typeof cost !== 'number' || cost < 1 || cost > 5) continue;
    if (!Array.isArray(champ?.traits) || champ.traits.length === 0) continue;
    const icon = typeof champ?.icon === 'string' ? champ.icon.trim().toLowerCase() : '';
    const key = icon && icon !== 'none' ? `i:${icon}` : `n:${apiName}`;
    if (seen.has(key)) continue;
    seen.add(key);
    counts[cost] += 1;
  }

  const shown = [1, 2, 3, 4, 5].map(c => counts[c]).join(' / ');
  console.log(`  shop-pool units: ${shown} (Kosten 1-5)`);

  // Plausibilitaetsband statt fester Zahlen: feste Zahlen waeren dieselbe
  // Falle nochmal. Kein Set seit Set 1 lag ausserhalb von 8-22 je Stufe.
  for (const c of [1, 2, 3, 4, 5]) {
    if (counts[c] === 0) {
      fail(`Shop-Pool: Kostenstufe ${c} hat 0 Einheiten — Bundle unvollstaendig oder Riot hat das Schema geaendert.`);
    } else if (counts[c] < 8 || counts[c] > 22) {
      fail(`Shop-Pool: Kostenstufe ${c} hat ${counts[c]} Einheiten — ausserhalb 8-22, Zaehlregel greift vermutlich daneben.`);
    }
  }

  // Die Ableitung muss die einzige Quelle bleiben. Faellt die Datei weg oder
  // taucht wieder eine getippte Tabelle auf, ist der Waechter wirkungslos.
  const poolLib = existsSync('app/lib/tft-shop-pool.ts')
    ? readFileSync('app/lib/tft-shop-pool.ts', 'utf8')
    : null;
  if (!poolLib) {
    fail('app/lib/tft-shop-pool.ts fehlt — die Einheiten-Zahl waere wieder handgetippt.');
  } else if (!poolLib.includes('POOL_RULE_V1')) {
    fail('app/lib/tft-shop-pool.ts traegt den Marker POOL_RULE_V1 nicht mehr — Zaehlregel auseinandergelaufen.');
  }

  const calcPath = 'app/tft/tools/odds/OddsCalculator.tsx';
  if (existsSync(calcPath) && /UNIQUE_CHAMPS\s*[:=]/.test(readFileSync(calcPath, 'utf8'))) {
    fail(`${calcPath} enthaelt wieder eine getippte UNIQUE_CHAMPS-Tabelle — sie gehoert abgeleitet.`);
  }
}

console.log();
if (WARN.length > 0) {
  console.log('Warnings:');
  for (const w of WARN) console.log('  ⚠  ' + w);
  console.log();
}
if (ERR.length > 0) {
  console.log('Failures:');
  for (const e of ERR) console.log('  ✖  ' + e);
  console.log();
  console.log(`verify-classifications: ${ERR.length} failure(s). Push blocked.`);
  process.exit(1);
}
console.log('verify-classifications: all checks passed.');

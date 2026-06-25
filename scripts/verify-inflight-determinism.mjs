#!/usr/bin/env node
/**
 * Pop-Determinismus-Test (architect F9, BLOCKER aus Multi-Review 2026-06-25).
 *
 * Sicherstellt dass `buildPopulation` byte-identische Ergebnisse liefert
 * unabhängig von der Input-Reihenfolge — VORAUSGESETZT die Eingangs-Liste
 * ist nach puuid sortiert. Driver-Pflicht in
 * `daily-marketvalue-snapshot.mjs` (processRegion, Pop-Build-Phase).
 *
 * Hintergrund: bei Sub-Region-Resume kann gathered in verschiedener
 * Reihenfolge entstehen — einmal Single-Run (loadIterationTargets ORDER BY
 * puuid), einmal Resume-Mix (Inflight-Map + Frisch in DB-Order). Floating-
 * Point-Aggregation in buildPopulation.expectedDmg ist reihenfolgesensitiv
 * (a+b+c != a+c+b bit-level). Ohne puuid-Sort drift'en Snapshot-Multiplier
 * subtle zwischen Resume und Single-Run.
 *
 * Test-Strategie:
 *   1. 500 synthetische rawList-Einträge mit deterministischen aber
 *      "echten" Verteilungen
 *   2. Variante A: puuid-sortiert
 *   3. Variante B: gleiche Liste shuffeled + puuid-sortiert
 *   4. buildCompMeta + applyMeta + buildPopulation für beide
 *   5. Assert: pop.medians === pop.medians byte-identisch
 *
 * Usage: node scripts/verify-inflight-determinism.mjs
 * Exit 0 = PASS, Exit 1 = FAIL.
 */

import { buildCompMeta, applyMeta, buildPopulation } from './lib/tft-skill-score.mjs';

// Deterministischer PRNG (Mulberry32) — gleicher Seed = gleiche Werte.
function mulberry32(seed) {
  return function () {
    let t = seed = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function syntheticPuuid(idx) {
  // Lexikographische sortierbare ID (für puuid-Sort-Test)
  return `puuid-${String(idx).padStart(6, '0')}-${'a'.repeat(56)}`;
}

function syntheticRaw(rng) {
  // Realistische extractRawMetrics-Werte (≈ Distribution der echten Pop):
  //   perfM:  ≈ −4.0 .. −1.5 (Top4-Blend − avgPlc)
  //   consM:  ≈ −2.5 .. −1.0 (negative Stddev)
  //   flexM:  0..5
  //   survival: 28..38
  //   eco:    −20..0
  //   dmgByPlc: per Placement Sum/Count
  //   compPlc: 3-5 Comps mit Sum/Count
  const n = 8 + Math.floor(rng() * 50);
  const perfM = -4 + rng() * 2.5;
  const consM = -2.5 + rng() * 1.5;
  const flexM = rng() * 5;
  const survival = 28 + rng() * 10;
  const eco = -20 + rng() * 20;

  const dmgByPlc = {};
  for (let plc = 1; plc <= 8; plc++) {
    const count = Math.floor(rng() * 5);
    if (count > 0) {
      const sum = (50 + rng() * 100) * count;
      dmgByPlc[String(plc)] = { sum, count };
    }
  }
  const dmgCount = Object.values(dmgByPlc).reduce((s, x) => s + x.count, 0);

  const compPlc = {};
  const ncomp = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < ncomp; i++) {
    const key = `TFT17_Trait_${i}@4_TFT17_Carry_${i}`;
    const count = 1 + Math.floor(rng() * 5);
    const sum = (1 + rng() * 7) * count;
    compPlc[key] = { sum, count };
  }

  return {
    n,
    perfM,
    metaRelM: null,    // wird in applyMeta gesetzt
    metaCount: 0,
    compPlc,
    consM,
    flexM,
    survival,
    eco,
    dmgByPlc,
    dmgCount,
  };
}

function deepEqualWithEpsilon(a, b, path = '') {
  if (a === b) return null;
  if (typeof a !== typeof b) return `type mismatch at ${path}: ${typeof a} vs ${typeof b}`;
  if (typeof a === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return null;
    // Strikt byte-identisch — ein einziger ULP-Unterschied = FAIL
    // (sonst kann sich Float-Drift kumulieren).
    if (a !== b) return `numeric drift at ${path}: ${a} vs ${b} (Δ=${Math.abs(a - b)})`;
    return null;
  }
  if (a == null || b == null) return `null mismatch at ${path}`;
  if (typeof a !== 'object') return `value mismatch at ${path}: ${a} vs ${b}`;
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (keysA.length !== keysB.length) return `key count at ${path}: ${keysA.length} vs ${keysB.length}`;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return `missing key at ${path}.${k}`;
    const sub = deepEqualWithEpsilon(a[k], b[k], `${path}.${k}`);
    if (sub) return sub;
  }
  return null;
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function runPipeline(taggedRaws) {
  // Simuliert Driver: puuid-Sort, dann buildCompMeta + applyMeta +
  // buildPopulation. taggedRaws = [{ puuid, raw }, ...]
  // Pflicht: puuid-Sort vor allen drei Schritten.
  const sorted = taggedRaws.slice().sort((a, b) => a.puuid.localeCompare(b.puuid));
  const rawList = sorted.map(t => t.raw);
  const compMeta = buildCompMeta(rawList);
  for (const r of rawList) applyMeta(r, compMeta);
  const pop = buildPopulation(rawList);
  return { pop, compMetaSize: compMeta.size };
}

function main() {
  console.log('=== Pop-Determinismus-Verify ===');
  const N = 500;
  console.log(`  N = ${N} synthetic players`);

  // Seeded RNG für reproduzierbare Raws (gleicher Seed = gleiche Werte)
  const rng = mulberry32(0xDEADBEEF);
  const baseRaws = [];
  for (let i = 0; i < N; i++) {
    // Wichtig: Raws müssen ECHTE Kopien sein, nicht shared refs. applyMeta
    // mutiert in-place — Test-Sub-Pfade brauchen unabhängige Kopien.
    baseRaws.push({ puuid: syntheticPuuid(i), raw: syntheticRaw(rng) });
  }

  // Variante A: puuid-sortiert
  const taggedA = baseRaws.map(t => ({ puuid: t.puuid, raw: structuredClone(t.raw) }));
  const resA = runPipeline(taggedA);

  // Variante B: gleiche Liste random-shuffled (gleicher Seed) → puuid-Sort
  // ergibt die gleiche Ordnung wie A. Aber Frage: kommt bit-identisches
  // Ergebnis raus? Sollte JA, weil Sort identische Reihenfolge erzeugt.
  const rngB = mulberry32(0xCAFEBABE);
  const taggedB_shuffled = shuffle(baseRaws, rngB).map(t => ({ puuid: t.puuid, raw: structuredClone(t.raw) }));
  const resB = runPipeline(taggedB_shuffled);

  // Variante C: simuliert Inflight-Resume — split rawList in zwei Hälften
  // (50% Inflight, 50% Frisch in unterschiedlicher Reihenfolge), puuid-Sort
  // muss die gleiche kanonische Ordnung erzeugen.
  const half = Math.floor(N / 2);
  const inflight = baseRaws.slice(0, half).reverse(); // simuliert DB-Order != puuid-Order
  const frisch = baseRaws.slice(half);
  const taggedC = [...inflight, ...frisch].map(t => ({ puuid: t.puuid, raw: structuredClone(t.raw) }));
  const resC = runPipeline(taggedC);

  // Vergleiche
  const diffsAB = deepEqualWithEpsilon(resA.pop, resB.pop, 'pop');
  const diffsAC = deepEqualWithEpsilon(resA.pop, resC.pop, 'pop');

  const compMetaMatch = resA.compMetaSize === resB.compMetaSize && resB.compMetaSize === resC.compMetaSize;

  console.log(`\n  A: pop.medians = ${JSON.stringify(resA.pop.medians.performance)}`);
  console.log(`  B: pop.medians = ${JSON.stringify(resB.pop.medians.performance)}`);
  console.log(`  C: pop.medians = ${JSON.stringify(resC.pop.medians.performance)}`);
  console.log(`\n  compMeta.size: A=${resA.compMetaSize}, B=${resB.compMetaSize}, C=${resC.compMetaSize}`);

  let pass = true;
  if (diffsAB) {
    console.error(`\n  ✗ A != B: ${diffsAB}`);
    pass = false;
  } else {
    console.log(`\n  ✓ A == B byte-identisch (Shuffle + puuid-Sort = reproduzierbar)`);
  }
  if (diffsAC) {
    console.error(`  ✗ A != C: ${diffsAC}`);
    pass = false;
  } else {
    console.log(`  ✓ A == C byte-identisch (Inflight-Mix + puuid-Sort = reproduzierbar)`);
  }
  if (!compMetaMatch) {
    console.error(`  ✗ compMeta.size differs`);
    pass = false;
  } else {
    console.log(`  ✓ compMeta.size identisch (${resA.compMetaSize})`);
  }

  if (pass) {
    console.log(`\n=== PASS ===`);
    process.exit(0);
  } else {
    console.error(`\n=== FAIL — Pop-Determinismus nicht garantiert ===`);
    console.error(`Driver darf NICHT mit Inflight-Resume deployt werden bis das gefixt ist.`);
    process.exit(1);
  }
}

main();

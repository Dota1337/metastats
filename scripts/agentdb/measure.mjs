#!/usr/bin/env node
// Measure-first: fastembed Cold/Warm-Latency + sqlite-vec Load + Vector-Search
// für 200 Sections × 384-dim. Entscheidet ob Daemon-Pattern Pflicht ist.
//
// perf-critic-Verdict 2026-06-20: bei fastembed Cold-Start <800ms ist CLI-Spawn
// noch tragbar, sonst Daemon Pflicht.

import { performance } from 'node:perf_hooks';

console.log('=== AgentDB Measure-First Probe ===\n');

// 1. fastembed Cold-Start (Modell-Load + erste Inference)
console.log('[1/4] fastembed Cold-Start...');
const t0 = performance.now();
const { FlagEmbedding } = await import('fastembed');
const tImported = performance.now();
console.log(`  Import: ${(tImported - t0).toFixed(0)}ms`);

const t1 = performance.now();
// BGE-M3 (multilingual, ~500MB). Fallback: BGE-small (English-only, ~30MB).
// data-skeptic 2026-06-20: BGE-M3 für DE+EN Mix nötig.
let model;
let modelName = 'bge-m3';
try {
  model = await FlagEmbedding.init({ model: 'bge-m3' });
} catch (e) {
  console.log(`  bge-m3 not available, falling back: ${e.message}`);
  modelName = 'bge-small';
  model = await FlagEmbedding.init();
}
const tInit = performance.now();
console.log(`  Model-Init (${modelName}): ${(tInit - t1).toFixed(0)}ms`);

// First Inference
const t2 = performance.now();
const firstEmbed = await model.embed(['Trait-Family Sub-Cluster-Suffix konsolidieren']);
const tFirst = performance.now();
const firstArray = await firstEmbed.next();
const tFirstResolved = performance.now();
console.log(`  First-Inference: ${(tFirstResolved - t2).toFixed(0)}ms`);
const firstVec = firstArray.value[0];
console.log(`  Vector-Dim: ${firstVec.length}`);

// Warm Inference
const t3 = performance.now();
const warmEmbed = await model.embed(['UniqueTrait ist kein Augment']);
const warmArray = await warmEmbed.next();
const tWarm = performance.now();
console.log(`  Warm-Inference: ${(tWarm - t3).toFixed(0)}ms`);

// Batch (5 queries)
const t4 = performance.now();
const batchEmbed = await model.embed([
  'Family-Aggregation Star konsolidieren',
  'Hetzner SSH Refresh-Service',
  'Skill-Score Marktwert-Modell',
  'Drop-Down Pfeil orange',
  'Carry-Detection Cost-Aware',
]);
const batchArray = await batchEmbed.next();
const tBatch = performance.now();
console.log(`  Batch-Inference (5): ${(tBatch - t4).toFixed(0)}ms = ${((tBatch - t4) / 5).toFixed(0)}ms/embed avg`);

// 2. sqlite-vec Load
console.log('\n[2/4] sqlite-vec Load...');
const t5 = performance.now();
const Database = (await import('better-sqlite3')).default;
const sqliteVec = await import('sqlite-vec');
const tLoaded = performance.now();
console.log(`  Imports: ${(tLoaded - t5).toFixed(0)}ms`);

const t6 = performance.now();
const db = new Database(':memory:');
sqliteVec.load(db);
const tDbInit = performance.now();
console.log(`  DB-Init + Extension-Load: ${(tDbInit - t6).toFixed(0)}ms`);

const { vec_version } = db.prepare('select vec_version() as vec_version').get();
console.log(`  sqlite-vec Version: ${vec_version}`);

// 3. Vector-Insert 200 + Search Probe
console.log('\n[3/4] Vector-Insert 200 + Search...');
db.exec(`
  CREATE VIRTUAL TABLE memory_vec USING vec0(
    embedding float[${firstVec.length}]
  );
`);

// Mock 200 Vektoren (random für Performance-Test — Recall-Qualität wird separat gemessen)
const t7 = performance.now();
const insert = db.prepare('INSERT INTO memory_vec(rowid, embedding) VALUES (?, ?)');
const insertMany = db.transaction(() => {
  for (let i = 1; i <= 200; i++) {
    const vec = new Array(firstVec.length);
    for (let j = 0; j < firstVec.length; j++) vec[j] = Math.random() * 2 - 1;
    insert.run(BigInt(i), JSON.stringify(vec));
  }
});
insertMany();
const tInsert = performance.now();
console.log(`  Insert 200 Vektoren: ${(tInsert - t7).toFixed(0)}ms`);

// Search Top-5
const t8 = performance.now();
const searchVec = JSON.stringify([...firstVec]);
const results = db.prepare(`
  SELECT rowid, distance
  FROM memory_vec
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 5
`).all(searchVec);
const tSearch = performance.now();
console.log(`  Search Top-5 (Brute-Force vec0): ${(tSearch - t8).toFixed(0)}ms`);
console.log(`  Top-5 Distances: ${results.map(r => r.distance.toFixed(4)).join(', ')}`);

// 4. End-to-End: Embed-then-Search (Simulation Inject-Hook)
console.log('\n[4/4] End-to-End Inject-Simulation...');
const t9 = performance.now();
const e2eEmbed = await model.embed(['Test-Query']);
const e2eArray = await e2eEmbed.next();
const e2eVec = e2eArray.value[0];
const e2eSearchVec = JSON.stringify([...e2eVec]);
db.prepare(`
  SELECT rowid, distance
  FROM memory_vec
  WHERE embedding MATCH ?
  ORDER BY distance
  LIMIT 5
`).all(e2eSearchVec);
const tE2E = performance.now();
console.log(`  Embed + Search (warm): ${(tE2E - t9).toFixed(0)}ms`);

console.log('\n=== Verdict ===');
const totalCold = tFirstResolved - t0;
const totalWarm = tE2E - t9;
console.log(`Cold-Start (Import + Model-Load + First-Embed): ${totalCold.toFixed(0)}ms`);
console.log(`Warm-Path (Embed + Search): ${totalWarm.toFixed(0)}ms`);
console.log(`Daemon-Pflicht: ${totalCold > 800 ? 'JA (Cold > 800ms)' : 'NEIN (Cold akzeptabel)'}`);
console.log(`Spec-Inject <500ms-Budget: ${totalWarm < 500 ? 'ERFÜLLT (warm)' : 'VERFEHLT'}`);

db.close();

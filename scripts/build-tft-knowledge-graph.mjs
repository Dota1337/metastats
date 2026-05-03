#!/usr/bin/env node
/**
 * Builds the TFT Knowledge Graph from one (or more) tft-stats-{region}.json
 * files produced by collect-tft-allranks.mjs.
 *
 * Output: public/tft-graph-{region}.json
 *   {
 *     set, patch, region, builtAt,
 *     nodes: { units[], items[], augments[], comps[], traits[] },
 *     edges: {
 *       unitToItem    : [{ unit, item, games, top4, sumPlacement }, ...],
 *       itemToUnit    : [{ item, unit, games, sumPlacement }, ...],
 *       compToUnit    : [{ comp, unit, count }, ...],
 *       compToAugment : [{ comp, augment, count, sumPlacement }, ...],
 *       compCounter   : [{ a, b, games, aWinRate }, ...]   // a likely beats b
 *       traitToComp   : [{ trait, level, comp }, ...]     // deterministic from cluster key
 *     }
 *   }
 *
 * The KG is the data source for:
 *   - "Top items for unit X" sections on /tft/units/[id]
 *   - "Counters" sections on /tft/comps/[slug]
 *   - MetaAdaptation + HighRoll agents in the marketvalue pipeline
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const STATS_PATH = `public/tft-stats-${REGION}.json`;
const OUT = `public/tft-graph-${REGION}.json`;

const TIER_BUCKET = arg('--bucket', 'master_plus'); // bucket from which we draw signal

if (!existsSync(STATS_PATH)) {
  console.error(`stats file not found: ${STATS_PATH} — run collect-tft-allranks first`);
  process.exit(1);
}
const stats = JSON.parse(readFileSync(STATS_PATH, 'utf8'));

console.log(`[KG] building from ${STATS_PATH}, bucket=${TIER_BUCKET}`);
console.log(`     set=${stats.set} patch=${stats.patch} matches=${stats.matchesAnalyzed}`);

// ---- Edges: unit ↔ item ----
const unitToItem = [];
for (const [unit, buckets] of Object.entries(stats.byUnit || {})) {
  const b = buckets[TIER_BUCKET] || buckets.all;
  if (!b) continue;
  for (const it of b.topItems || []) {
    unitToItem.push({ unit, item: it.item, games: it.games, top4: it.top4, sumPlacement: it.sumPlacement });
  }
}

const itemToUnit = [];
for (const [item, buckets] of Object.entries(stats.byItem || {})) {
  const b = buckets[TIER_BUCKET] || buckets.all;
  if (!b) continue;
  for (const u of b.topUsers || []) {
    itemToUnit.push({ item, unit: u.characterId, games: u.games, sumPlacement: u.sumPlacement });
  }
}

// ---- Edges: comp ↔ unit, comp ↔ augment ----
const compToUnit = [];
const compToAugment = [];
const traitToComp = [];
for (const [compKey, buckets] of Object.entries(stats.byComp || {})) {
  const b = buckets[TIER_BUCKET] || buckets.all;
  if (!b) continue;
  for (const tu of b.typicalUnits || []) {
    compToUnit.push({ comp: compKey, unit: tu.characterId, count: tu.count });
  }
  for (const ta of b.typicalAugments || []) {
    compToAugment.push({ comp: compKey, augment: ta.apiName, count: ta.count, sumPlacement: ta.sumPlacement });
  }
  // Cluster key encodes the primary trait — reverse it to a trait→comp edge
  const m = /^(.+)@(\d+)_(.+)$/.exec(compKey);
  if (m) traitToComp.push({ trait: m[1], level: Number(m[2]), comp: compKey });
}

// ---- Counter edges ----
// stats.compPairs holds A,B pairs where one side wins ≥55% across ≥10 head-to-heads.
// Emit a directional edge a→b meaning "a tends to beat b".
const compCounter = [];
for (const p of stats.compPairs || []) {
  const aWinRate = p.aBetter / p.games;
  if (aWinRate >= 0.55) {
    compCounter.push({ a: p.a, b: p.b, games: p.games, aWinRate: Number(aWinRate.toFixed(3)) });
  } else if (aWinRate <= 0.45) {
    compCounter.push({ a: p.b, b: p.a, games: p.games, aWinRate: Number((1 - aWinRate).toFixed(3)) });
  }
}

// ---- Node lists for quick lookups ----
const nodes = {
  units:    [...new Set(unitToItem.map(e => e.unit).concat(compToUnit.map(e => e.unit)))],
  items:    [...new Set(unitToItem.map(e => e.item).concat(itemToUnit.map(e => e.item)))],
  augments: [...new Set(compToAugment.map(e => e.augment))],
  comps:    [...new Set(compToUnit.map(e => e.comp).concat(compCounter.flatMap(e => [e.a, e.b])))],
  traits:   [...new Set(traitToComp.map(e => e.trait))],
};

const payload = {
  set: stats.set,
  setName: stats.setName,
  patch: stats.patch,
  region: stats.region,
  bucket: TIER_BUCKET,
  builtAt: new Date().toISOString(),
  matchesUsed: stats.matchesAnalyzed,
  nodes: {
    units:    nodes.units.length,
    items:    nodes.items.length,
    augments: nodes.augments.length,
    comps:    nodes.comps.length,
    traits:   nodes.traits.length,
  },
  edges: {
    unitToItem,
    itemToUnit,
    compToUnit,
    compToAugment,
    compCounter,
    traitToComp,
  },
};

writeFileSync(OUT, JSON.stringify(payload));
console.log(`[KG] wrote ${OUT}`);
console.log(`     edges: u→i ${unitToItem.length}, i→u ${itemToUnit.length}, c→u ${compToUnit.length}, c→a ${compToAugment.length}, counters ${compCounter.length}, t→c ${traitToComp.length}`);

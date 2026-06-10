#!/usr/bin/env node
/**
 * Pre-push classification verifier. Catches the kind of mistakes that ate
 * three iterations on /tft/augments + /tft/gods in 2026-06-10 — Pattern-
 * Heuristics that "look right" but disagree with ground-truth.
 *
 * Hard rules (exit 1 on any failure):
 *   • Every augment in active.augments has tier ∈ {1,2,3}
 *   • For every apiName in tft-augment-tiers-{N}.json, the bundle's tier
 *     MUST equal the override (= tactics.tools ground-truth)
 *   • Override coverage of active.augments ≥ 90 %
 *   • No GodAugment leaks into active.augments
 *   • Each god in tft-gods-{N}.json has a baseApiName that exists in
 *     bundle.augments and uses the TFT{N}_Augment_<id>GodAugment pattern
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
const godsPath = `public/tft-gods-${set}.json`;
const gods = loadJson(godsPath);

console.log(`Verifying classifications for set ${set} (${bundle.setName})`);
console.log(`  bundle augments: ${Object.keys(bundle.augments || {}).length}`);
console.log(`  active.augments: ${bundle.active?.augments?.length || 0}`);
console.log(`  tier-override:   ${override ? Object.keys(override.tiers || {}).length : 'MISSING'}`);
console.log(`  gods doc:        ${gods ? gods.gods?.length : 'MISSING'}`);
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

// 4. No GodAugment leak
const godLeaks = activeList.filter(id => /GodAugment/i.test(id));
if (godLeaks.length > 0) fail(`active.augments contains ${godLeaks.length} GodAugment(s): ${godLeaks.slice(0, 3).join(', ')}…`);

// 5. God doc → bundle linkage
if (gods?.gods) {
  for (const g of gods.gods) {
    if (!g.id || !g.baseApiName) { fail(`Gods doc entry missing id/baseApiName: ${JSON.stringify(g)}`); continue; }
    if (!bundle.augments[g.baseApiName]) {
      fail(`God "${g.id}": baseApiName "${g.baseApiName}" not in bundle.augments`);
    }
    const expectedPrefix = `TFT${set}_Augment_${g.id}GodAugment`;
    if (!g.baseApiName.startsWith(expectedPrefix)) {
      fail(`God "${g.id}": baseApiName "${g.baseApiName}" doesn't match expected prefix "${expectedPrefix}…"`);
    }
  }
} else {
  warn(`No gods doc at ${godsPath} — /tft/gods won't render. Add the file if Set ${set} has gods.`);
}

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

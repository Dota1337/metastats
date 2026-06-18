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
const compAugPath = `public/tft-comp-augments-${set}.json`;
const compAug = loadJson(compAugPath);
const compSlugMapPath = `public/tft-comp-slug-map-${set}.json`;
const compSlugMap = loadJson(compSlugMapPath);

console.log(`Verifying classifications for set ${set} (${bundle.setName})`);
console.log(`  bundle augments: ${Object.keys(bundle.augments || {}).length}`);
console.log(`  active.augments: ${bundle.active?.augments?.length || 0}`);
console.log(`  tier-override:   ${override ? Object.keys(override.tiers || {}).length : 'MISSING'}`);
console.log(`  gods doc:        ${gods ? gods.gods?.length : 'MISSING'}`);
console.log(`  comp-augments:   ${compAug ? Object.keys(compAug.comps || {}).length : 'MISSING'}`);
console.log(`  comp-slug-map:   ${compSlugMap ? Object.keys(compSlugMap.slugs || {}).length : 'MISSING'}`);
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

// 7. Comp-Augments (tftacademy.com) — apiName-Existenz + Tier-Distribution-Sanity
if (compAug?.comps) {
  let unknownAugs = 0;
  let tierSkewed = 0;
  for (const [slug, augList] of Object.entries(compAug.comps)) {
    if (!Array.isArray(augList) || augList.length === 0) {
      warn(`Comp slug "${slug}" has empty augment-list — scraper may have lost it`);
      continue;
    }
    // (a) Every apiName must exist in bundle.augments
    for (const apiName of augList) {
      if (!bundle.augments[apiName]) {
        if (unknownAugs < 5) fail(`comp-augments slug "${slug}": ${apiName} not in bundle.augments`);
        unknownAugs++;
      }
    }
    // (b) Distribution-Sanity per slug: ≥85% in one tier → scraper drift
    const tierDist = { 1: 0, 2: 0, 3: 0, 0: 0 };
    for (const apiName of augList) {
      const t = bundle.augments[apiName]?.tier ?? 0;
      tierDist[t] = (tierDist[t] || 0) + 1;
    }
    const total = augList.length;
    for (const t of [1, 2, 3]) {
      if (tierDist[t] / total > 0.85) {
        warn(`Comp slug "${slug}": ${tierDist[t]}/${total} augments in tier ${t} (>85 %) — possible scraper drift`);
        tierSkewed++;
        break;
      }
    }
  }
  if (unknownAugs >= 5) fail(`… ${unknownAugs - 5} additional unknown apiNames not shown`);
} else {
  warn(`No comp-augments file at ${compAugPath} — Comp-Detail augment-section won't render. Re-run scripts/refresh-comp-augments.mjs.`);
}

// 8. Comp-Slug-Map — Schema, Bundle-Linkage, Augments-Reference
if (compSlugMap?.slugs) {
  const augSlugs = new Set(Object.keys(compAug?.comps || {}));
  for (const [slug, entry] of Object.entries(compSlugMap.slugs)) {
    if (!entry || typeof entry !== 'object') {
      fail(`Slug-map "${slug}": entry is not an object`);
      continue;
    }
    // (a) primaryCarry must exist in bundle.champions (set-bound)
    if (!entry.primaryCarry || typeof entry.primaryCarry !== 'string') {
      fail(`Slug-map "${slug}": missing or invalid primaryCarry`);
    } else if (!bundle.champions[entry.primaryCarry]) {
      fail(`Slug-map "${slug}": primaryCarry "${entry.primaryCarry}" not in bundle.champions`);
    }
    // (b) primaryTrait may be empty string (= match-by-carry-only). When set,
    //     it must exist in bundle.traits OR be a prefix that matches at least
    //     one trait (e.g. "TFT17_Stargazer" matches Mountain/Serpent variants).
    if (entry.primaryTrait !== undefined && entry.primaryTrait !== '') {
      const traitMatch = bundle.traits[entry.primaryTrait]
        || Object.keys(bundle.traits || {}).some(k => k.startsWith(entry.primaryTrait + '_'));
      if (!traitMatch) {
        fail(`Slug-map "${slug}": primaryTrait "${entry.primaryTrait}" not in bundle.traits (no exact or prefix match)`);
      }
    }
    // (c) augmentsRef (or slug itself) must point at a compAug.comps entry
    const ref = entry.augmentsRef || slug;
    if (augSlugs.size > 0 && !augSlugs.has(ref)) {
      fail(`Slug-map "${slug}": augmentsRef "${ref}" has no entry in tft-comp-augments-${set}.json`);
    }
  }
} else {
  warn(`No comp-slug-map at ${compSlugMapPath} — Comp-Detail augment-section won't surface for any cluster.`);
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

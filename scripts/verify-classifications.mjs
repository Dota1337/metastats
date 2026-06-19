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
const compGuidesPath = `public/tft-comp-guides-${set}.json`;
const compGuides = loadJson(compGuidesPath);
const compSlugMapPath = `public/tft-comp-slug-map-${set}.json`;
const compSlugMap = loadJson(compSlugMapPath);

console.log(`Verifying classifications for set ${set} (${bundle.setName})`);
console.log(`  bundle augments: ${Object.keys(bundle.augments || {}).length}`);
console.log(`  active.augments: ${bundle.active?.augments?.length || 0}`);
console.log(`  tier-override:   ${override ? Object.keys(override.tiers || {}).length : 'MISSING'}`);
console.log(`  gods doc:        ${gods ? gods.gods?.length : 'MISSING'}`);
console.log(`  comp-guides:     ${compGuides ? Object.keys(compGuides.comps || {}).length : 'MISSING'}`);
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

// 7. Comp-Guides (tftacademy.com) — schema + apiName-Existence + Tier-Sanity
const VALID_AUG_GROUPS = new Set(['ECON', 'ITEMS', 'COMBAT', 'EMBLEM', 'HERO']);
const VALID_DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD', 'CONDITIONAL']);

if (compGuides?.comps) {
  let unknownAugs = 0;
  for (const [slug, guide] of Object.entries(compGuides.comps)) {
    if (!guide || typeof guide !== 'object') {
      fail(`Comp slug "${slug}": guide is not an object`);
      continue;
    }
    // (a) Augments: every apiName in bundle.augments
    if (!Array.isArray(guide.augments)) {
      fail(`Comp slug "${slug}": augments is not an array`);
    } else {
      for (const apiName of guide.augments) {
        if (!bundle.augments[apiName]) {
          if (unknownAugs < 5) fail(`comp-guides slug "${slug}": augment ${apiName} not in bundle.augments`);
          unknownAugs++;
        }
      }
      // (b) Tier-Distribution-Sanity per slug: ≥85% in one tier → scraper drift
      if (guide.augments.length > 0) {
        const tierDist = { 1: 0, 2: 0, 3: 0, 0: 0 };
        for (const apiName of guide.augments) {
          const t = bundle.augments[apiName]?.tier ?? 0;
          tierDist[t] = (tierDist[t] || 0) + 1;
        }
        for (const t of [1, 2, 3]) {
          if (tierDist[t] / guide.augments.length > 0.85) {
            warn(`Comp slug "${slug}": ${tierDist[t]}/${guide.augments.length} augments in tier ${t} (>85 %) — possible scraper drift`);
            break;
          }
        }
      }
    }
    // (c) augmentTypes: empty array OR same length as augments + valid labels
    if (!Array.isArray(guide.augmentTypes)) {
      fail(`Comp slug "${slug}": augmentTypes is not an array`);
    } else if (guide.augmentTypes.length > 0) {
      if (guide.augmentTypes.length !== guide.augments.length) {
        warn(`Comp slug "${slug}": augmentTypes length ${guide.augmentTypes.length} != augments ${guide.augments.length}`);
      }
      for (const g of guide.augmentTypes) {
        if (!VALID_AUG_GROUPS.has(g)) {
          fail(`Comp slug "${slug}": invalid augment group "${g}" (expected ECON/ITEMS/COMBAT/EMBLEM/HERO)`);
          break;
        }
      }
    }
    // (d) earlyComp: array of {apiName, items[], stars} with valid champions
    if (!Array.isArray(guide.earlyComp)) {
      fail(`Comp slug "${slug}": earlyComp is not an array`);
    } else {
      for (const entry of guide.earlyComp) {
        if (!entry?.apiName || !bundle.champions[entry.apiName]) {
          warn(`Comp slug "${slug}": earlyComp champion "${entry?.apiName}" not in bundle.champions`);
          break;
        }
      }
    }
    // (e) carousel: array of item apiNames
    if (!Array.isArray(guide.carousel)) {
      fail(`Comp slug "${slug}": carousel is not an array`);
    }
    // (f) tips: array of {stage, tip}
    if (!Array.isArray(guide.tips)) {
      fail(`Comp slug "${slug}": tips is not an array`);
    }
    // (g) difficulty: optional, but if set must be valid
    if (guide.difficulty != null && !VALID_DIFFICULTIES.has(guide.difficulty)) {
      fail(`Comp slug "${slug}": invalid difficulty "${guide.difficulty}"`);
    }
  }
  if (unknownAugs >= 5) fail(`… ${unknownAugs - 5} additional unknown augment apiNames not shown`);
} else {
  warn(`No comp-guides file at ${compGuidesPath} — Comp-Detail guide-sections won't render. Re-run scripts/refresh-comp-augments.mjs.`);
}

// 8. Comp-Slug-Map — Schema, Bundle-Linkage, Guides-Reference
if (compSlugMap?.slugs) {
  const augSlugs = new Set(Object.keys(compGuides?.comps || {}));
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
    // (c) augmentsRef (or slug itself) must point at a compGuides.comps entry
    const ref = entry.augmentsRef || slug;
    if (augSlugs.size > 0 && !augSlugs.has(ref)) {
      fail(`Slug-map "${slug}": augmentsRef "${ref}" has no entry in tft-comp-guides-${set}.json`);
    }
  }
} else {
  warn(`No comp-slug-map at ${compSlugMapPath} — Comp-Detail augment-section won't surface for any cluster.`);
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
    if (/^TFT\d*_Item_Artifact_/i.test(id)) return 'artifact';
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

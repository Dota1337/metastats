// Single-Source-Klassifikator fuer Comp-Cluster-Keys.
//
// Bridge fuer den Klassifikations-Drift, der zwischen 3 Pfaden bestand:
//   - tft-marketvalue.mjs (Cache-Writer fuer tft_player_match_cache)
//   - tft-build-aggregator.mjs (Daily-Aggregator fuer tft_daily_comp_stats)
//   - app/api/tft/pros/specialty/route.ts (Vercel-Live-Reclassify)
//
// Vorher: Cache hatte KEINEN UniqueTrait-Filter und einfache most-items-Carry-
// Detection. Aggregator hatte UniqueTrait-Filter + Hero-Augment + Cost-Aware-
// Swap. Folge: Pro-Cache-Top war `BlitzcrankUniqueTrait@1_...` (Single-Unit-
// Fragment), Aggregator-Listing-Top war `TFT17_GravesTrait@1_TFT17_Vex` (echte
// Comp) — Cross-Join via cluster_key = 0 Matches.
//
// Diese Lib ist die einzige Quelle fuer die Klassifikation. Beide Schreibpfade
// (Cache + Aggregator) und der Vercel-Read-Pfad ziehen daraus. Migration siehe
// reference_tft_classification_bridge.md.
//
// **Wichtig**: WhatchOut-Felder ueber alle 3 Pfade:
//   - Cache hat units im Hetzner-Shape ({character_id, tier, itemNames})
//   - Cache hat traits ohne num_units bei aelteren Rows → UniqueTrait-Filter
//     ueber Regex `/UniqueTrait$/.test(name)` ist robuster als num_units>=2
//   - Aggregator nutzt Hero-Augment-Detection — Match-V1 augments-Feld ist
//     seit 2026-06-15 leer, aber Match-Cache persistiert vergangene augments-
//     Arrays in der `augments` JSONB-Spalte → Re-Classify funktioniert auch
//     fuer alte Matches.
//
// Output-Format-Modes:
//   withAugmentSuffix=false (Cache, Vercel-Read) → `<trait>@<level>_<carry>`
//   withAugmentSuffix=true  (Aggregator)         → `<trait>@<level>_<carry>~<aug>`

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DAMAGE_CARRY_ITEMS } from './tft-item-classes.mjs';
import { compDefiningAugmentSlug } from './tft-comp-defining-augments.mjs';

const _costMapCache = new Map();
function loadCostMap(setNumber) {
  const set = setNumber || 17;
  if (_costMapCache.has(set)) return _costMapCache.get(set);
  try {
    const bundle = JSON.parse(readFileSync(resolve(process.cwd(), `public/tft-assets-${set}.json`), 'utf8'));
    const map = new Map();
    for (const [cid, ch] of Object.entries(bundle.champions || {})) {
      if (typeof ch?.cost === 'number') map.set(cid, ch.cost);
    }
    _costMapCache.set(set, map);
    return map;
  } catch {
    _costMapCache.set(set, new Map());
    return _costMapCache.get(set);
  }
}

// Hero-Augment-Pattern: `TFT<N>_Augment_<UnitName>Carry` oder `<UnitName>GodAugment`.
// Ein Participant der ein Hero-Augment haelt intendiert die Unit als Carry,
// unabhaengig von Item-Count.
function carryFromAugments(participant, units) {
  const augs = participant.augments || [];
  if (augs.length === 0) return null;
  for (const a of augs) {
    if (!a) continue;
    const m = /^TFT\d+_Augment_(.+?)(?:Carry|GodAugment|HeroAugment)$/i.exec(a);
    if (!m) continue;
    const unitNameLower = m[1].toLowerCase();
    const hit = units.find(u => {
      const cid = u.character_id || u.characterId || '';
      return cid.toLowerCase().endsWith('_' + unitNameLower) || cid.toLowerCase().endsWith(unitNameLower);
    });
    if (hit) return hit.character_id || hit.characterId;
  }
  return null;
}

// Akzeptiert beide Unit-Shapes:
//   - Riot Match-V1 raw: { character_id, tier, itemNames }
//   - Hetzner-Cache:     { characterId, tier, items }
function unitItems(u) {
  return u.itemNames || u.items || [];
}
function unitCid(u) {
  return u.character_id || u.characterId || '';
}

/**
 * Klassifiziert ein Participant-Board in einen deterministischen Cluster-Key.
 *
 * @param {Object} participant - Match-V1-Participant-Shape (mit traits, units, augments, level)
 * @param {Object} [opts]
 * @param {number} [opts.currentSet=17] - Set fuer cost-map
 * @param {boolean} [opts.withAugmentSuffix=false] - Suffix `~<augSlug>` anhaengen (Aggregator-Mode)
 * @returns {{ clusterKey, primaryTrait, primaryTraitLevel, carryUnit, carryStar, compDefiningAugment, secondaryCarry, carryItems } | null}
 */
export function classifyComp(participant, opts = {}) {
  const { currentSet = 17, withAugmentSuffix = false } = opts;
  const costMap = loadCostMap(currentSet);

  // UniqueTrait-Filter via Regex (robust gegen fehlende num_units in
  // Bestands-Cache-Rows). UniqueTraits sind immer Tier 1 und enden auf
  // `UniqueTrait` (Set 17: Blitzcrank/Fiora/MissFortune/Graves/etc.).
  const traits = (participant.traits || []).filter(
    t => (t.style ?? 0) > 0 && !/UniqueTrait$/.test(t.name || ''),
  );
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primaryTrait = traits[0];

  const units = participant.units || [];
  if (units.length === 0) return null;

  // 1) Hero-Augment override
  const heroCarryId = carryFromAugments(participant, units);
  let carry = heroCarryId ? units.find(u => unitCid(u) === heroCarryId) : null;

  // 2) Most damage-carry items
  if (!carry) {
    const byOffensiveItems = [...units]
      .map(u => {
        const items = unitItems(u);
        const offensive = items.filter(i => DAMAGE_CARRY_ITEMS.has(i)).length;
        return { u, offensive, total: items.length };
      })
      .filter(x => x.offensive > 0)
      .sort((a, b) => {
        if (b.offensive !== a.offensive) return b.offensive - a.offensive;
        if (b.total !== a.total) return b.total - a.total;
        if ((b.u.tier ?? 1) !== (a.u.tier ?? 1)) return (b.u.tier ?? 1) - (a.u.tier ?? 1);
        return (b.u.rarity ?? 0) - (a.u.rarity ?? 0);
      });
    if (byOffensiveItems.length > 0) carry = byOffensiveItems[0].u;

    // 2b) Cost-Aware-Swap (Fast-8 4-Cost-Bevorzugung)
    if (carry && byOffensiveItems.length >= 2 && !heroCarryId) {
      const top1 = byOffensiveItems[0];
      const top2 = byOffensiveItems[1];
      const top1Cid = unitCid(top1.u);
      const top2Cid = unitCid(top2.u);
      const top1Cost = costMap.get(top1Cid) ?? 0;
      const top2Cost = costMap.get(top2Cid) ?? 0;
      const level = Number(participant.level || 0);
      const fastEight = level === 8;
      const lvlNineFillerCase = level === 9 && top1.offensive <= top2.offensive;
      const hasActiveUniqueTrait = (participant.traits || []).some(
        t => (t.style ?? 0) > 0 && /UniqueTrait$/.test(t.name || ''),
      );
      const dualCarry = top1.offensive >= 3 && top2.offensive >= 3;
      if ((fastEight || lvlNineFillerCase)
          && top1Cost === 5 && top2Cost === 4
          && top2.offensive >= top1.offensive
          && !hasActiveUniqueTrait
          && !dualCarry) {
        carry = top2.u;
      }
    }
  }

  // 3) Legacy fallback — most items total
  if (!carry) {
    const ranked = [...units].sort((a, b) => {
      const aItems = unitItems(a).length;
      const bItems = unitItems(b).length;
      if (bItems !== aItems) return bItems - aItems;
      if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
      return (b.rarity ?? 0) - (a.rarity ?? 0);
    });
    carry = ranked[0];
  }
  const carryId = unitCid(carry);
  if (!carryId) return null;

  // Secondary-Carry-Detection (Threshold 3 damage items)
  const SECONDARY_MIN_DMG_ITEMS = 3;
  const secondaryCarry = units
    .map(u => {
      const cid = unitCid(u);
      if (!cid || cid === carryId) return null;
      const items = unitItems(u);
      const dmgItems = items.filter(i => DAMAGE_CARRY_ITEMS.has(i)).length;
      return dmgItems >= SECONDARY_MIN_DMG_ITEMS ? { cid, dmgItems, tier: u.tier ?? 1 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.dmgItems !== a.dmgItems) return b.dmgItems - a.dmgItems;
      return (b.tier ?? 1) - (a.tier ?? 1);
    })[0];

  const carryStar = carry.tier ?? 2;
  const augSlug = compDefiningAugmentSlug(participant.augments);

  // Two-Tanky-Augment-Detection ueber Unit-Duplicate (Match-V1 augments-Feld
  // ist seit 2026-06-15 leer; alte Cache-Rows haben augments aber persistiert).
  const hasUnitDuplicate = (() => {
    const counts = new Map();
    for (const u of units) {
      const cid = unitCid(u);
      if (!cid) continue;
      if (!/^TFT\d+_[A-Z]/.test(cid)) continue;
      counts.set(cid, (counts.get(cid) || 0) + 1);
    }
    for (const n of counts.values()) if (n >= 2) return true;
    return false;
  })();
  const effectiveAug = augSlug || (hasUnitDuplicate ? 'TwoTanky' : null);
  const augSuffix = withAugmentSuffix && effectiveAug ? `~${effectiveAug}` : '';

  const clusterKey = `${primaryTrait.name}@${primaryTrait.tier_current ?? 0}_${carryId}${augSuffix}`;

  return {
    clusterKey,
    primaryTrait: primaryTrait.name,
    primaryTraitLevel: primaryTrait.tier_current ?? 0,
    carryUnit: carryId,
    carryStar,
    compDefiningAugment: augSlug,
    secondaryCarry: secondaryCarry?.cid || null,
    carryItems: unitItems(carry).filter(Boolean).sort(),
  };
}

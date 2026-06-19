// Aggregates per-unit / per-item / per-augment / per-trait stats from
// TFT Match-V1 DTOs. Used by collect-tft-allranks.mjs.
//
// Output shape (per tier-bucket):
//   byUnit[characterId][bucket] = {
//     games, sumPlacement, top4, top1,
//     topItems    : [{ item, games, top4, sumPlacement }, ... 10],
//     topItemSets : [{ items: [a,b,c sorted], games, top4, sumPlacement }, ... 5],
//   }
//   byItem[apiName][bucket]     = { games, sumPlacement, top4,
//                                    topUsers: [{ characterId, games, sumPlacement }, ... 5] }
//   byAugment[apiName][slot][bucket] = { games, sumPlacement, top4 }
//   byTrait[name][activation][bucket] = { games, sumPlacement, top4 }
//
// `bucket` is the lowercase tier name ("iron","bronze",…,"challenger") or
// "master_plus" or "all" — finalize fills these by replaying the per-bucket
// aggregations into broader pools.

const TIER_BUCKETS = ['iron','bronze','silver','gold','platinum','emerald','diamond','master','grandmaster','challenger'];
const APEX_BUCKETS = ['master','grandmaster','challenger'];

// Items that are unambiguous damage-carry items. We tag a unit in a comp as
// the DMG-carry if it disproportionately holds these — independent of the
// cluster_key carry (which is just the unit with the most total items, often
// a tank with 3 defensive items). Match-V1 doesn't expose per-unit damage,
// so item composition is the next-best proxy.
//
// Hybrid items (Guinsoo's, Hextech Gunblade) and AS items (Red Buff = RFC,
// Kraken's Fury = Runaan's) count because they only go on damage carries.
// DAMAGE_CARRY_ITEMS lebt in scripts/lib/tft-item-classes.mjs (Single-Source-
// of-Truth, parallel zu app/lib/tft-item-classes.ts).
import { DAMAGE_CARRY_ITEMS } from './tft-item-classes.mjs';
import { compDefiningAugmentSlug } from './tft-comp-defining-augments.mjs';

export function emptyAggregate() {
  return {
    byUnit: new Map(),     // characterId -> Map<bucket, UnitBucket>
    byItem: new Map(),     // apiName -> Map<bucket, ItemBucket>
    byAugment: new Map(),  // apiName -> Map<slotKey, Map<bucket, AugmentBucket>>
    byTrait: new Map(),    // traitName -> Map<activation, Map<bucket, TraitBucket>>
    byTraitUnitCount: new Map(), // traitName -> Map<num_units, Map<bucket, TraitBucket>> — overcapping signal
    byComp: new Map(),     // clusterKey -> Map<bucket, CompBucket>
    byCompPair: new Map(), // "a||b" sorted -> { games, aBetter } — for counter edges
    participantsByBucket: new Map(), // bucket -> count (matches × 8). Exact denominator
                                     //   for pickRate; bypasses minCompGames filter
                                     //   that byComp roll-ups would impose.
    matchesAnalyzed: 0,
    matchesSkipped: 0,
  };
}

function getOrCreate(map, key, factory) {
  let v = map.get(key);
  if (!v) { v = factory(); map.set(key, v); }
  return v;
}

function newUnitBucket() {
  return {
    games: 0, sumPlacement: 0, top4: 0, top1: 0,
    items: new Map(),         // apiName -> { games, top4, sumPlacement }
    itemSets: new Map(),      // sortedKey -> { items[], games, top4, sumPlacement }
    // Star-level-aware mirrors. tier (1/2/3) -> per-item / per-set sub-Map.
    // Used for BiS-by-star-level on the unit-detail UI (1★ Caitlyn builds
    // differently than 2★ — CC items first vs DMG items).
    itemsByTier: new Map(),    // tier -> Map<apiName, {games, top4, sumPlacement}>
    itemSetsByTier: new Map(), // tier -> Map<sortedKey, {items[], games, top4, sumPlacement}>
    // Damage-Atlas: when THIS unit is the inferred carry of a participant,
    // push the participant's total_damage_to_players into this bin. Match-V1
    // has no per-unit damage, so we attribute the total to the carry (unit
    // with the most items; ties: higher star then higher cost).
    // tier (1/2/3) -> itemCount ('0'..'3') -> number[] (damage values).
    // Finalized into P50/P75/P95/P99 + games per (tier, itemCount).
    carryDamage: new Map(),
    // Carry-Performance: when THIS unit is the inferred carry, accumulate
    // placement + top4/top1 per (tier, itemCount). A real carry-strength signal
    // to replace the player-HP "damage atlas" (Match-V1 has no per-unit/in-combat
    // damage). tier -> itemCount ('0'..'3') -> { games, sumPlacement, top4, top1 }.
    carryPerf: new Map(),
    // Item-Slot-Build-Order: tier -> slotIdx ('0'/'1'/'2') -> Map<item, count>.
    // Match-V1 itemNames preserves build order — index 0 = first slot built.
    itemSlotOrderByTier: new Map(),
  };
}
function newItemBucket() {
  return {
    games: 0, sumPlacement: 0, top4: 0,
    users: new Map(),       // characterId -> { games, sumPlacement }
  };
}
function newAugmentBucket() {
  return { games: 0, sumPlacement: 0, top4: 0 };
}
function newTraitBucket() {
  return { games: 0, sumPlacement: 0, top4: 0 };
}

function newCompBucket() {
  return {
    games: 0, sumPlacement: 0, top4: 0, top1: 0,
    sumLevel: 0,                  // Σ final level — divided by games for avgLevel
    sumLastRound: 0,              // Σ last_round — divided by games for avgLastRound
    sumPlayersEliminated: 0,      // Σ players_eliminated — aggroIndex = sum/games
    sumGoldLeft: 0,               // Σ gold_left — divided by games for avgGoldLeft (comp eco)
    // Per-final-level: Map<level (string), { games, sumLastRound }>. Lets
    // the UI compute "if you finalize at lvl 8 with this comp, your avg
    // death-round is X" — proxies the leveling-tempo curve.
    levelDist: new Map(),
    // characterId -> { count, carryItemGames }. carryItemGames is the number
    // of times this unit was seen holding ≥1 DAMAGE_CARRY_ITEMS — the
    // frontend uses count/carryItemGames ratio to pick the actual DMG carry
    // (independent of the cluster_key carry which is just the unit with
    // most items, often a tank).
    typicalUnits: new Map(),
    typicalAugments: new Map(),  // apiName -> { count, sumPlacement }
    carryItems: new Map(),       // sortedItemTriple -> count (carry's full build)
    // Death-round histogram. round (int as Map-key) -> { games, top4 }.
    // Used to render the "survival → top4" probability curve on the comp
    // detail page.
    lastRoundDist: new Map(),
    // W3-A: Carry-Star-Outcome — per star level of the inferred carry, the
    // bucket {games, sumPlacement, top4, top1}. Lets the UI show "if Aphelios
    // hits 3★ → Avg 2.8 (12% of games), vs 2★ → Avg 4.9". Reroll comps
    // collapse at 2★; fast-8 comps rarely reach 3★ but win when they do.
    carryStarOutcome: new Map(),
    // W4-B: Contested-Distribution — bucketed by how many lobby players forced
    // the same cluster_key (1 = solo, 2 = one rival, 3 = three-or-more). Each
    // bucket carries {games, sumPlacement, top4, top1}; the UI shows the
    // penalty when too many people force the same comp.
    contestedDist: new Map(),
  };
}

// Hero-Augment-Pattern: `TFT<N>_Augment_<UnitName>Carry` or `<UnitName>GodAugment`.
// A participant holding one of these AUGMENTS clearly intends that unit as carry,
// regardless of item count — overrides the item heuristic, which mis-picks tanks
// who routinely hold 3 defensive items (Maokai/Cho'Gath/TahmKench).
//
// Returns the inferred carry character_id from a participant's augments, or null.
function carryFromAugments(participant, units) {
  const augs = participant.augments || [];
  if (augs.length === 0) return null;
  for (const a of augs) {
    if (!a) continue;
    // Extract the unit-name segment from the augment id.
    const m = /^TFT\d+_Augment_(.+?)(?:Carry|GodAugment|HeroAugment)$/i.exec(a);
    if (!m) continue;
    const unitNameLower = m[1].toLowerCase();
    // Match against the units actually on this board so we don't pin onto a
    // unit the player never bought.
    const hit = units.find(u => {
      const cid = u.character_id || u.characterId || '';
      return cid.toLowerCase().endsWith('_' + unitNameLower) || cid.toLowerCase().endsWith(unitNameLower);
    });
    if (hit) return hit.character_id || hit.characterId;
  }
  return null;
}

// Cluster a participant's board into a deterministic key:
//   `${primaryActivatedTrait}@${level}_${carryUnit}`
// Carry-detection priority:
//   1. Hero-Augment (deterministic — if a player has a `XYZCarry` augment,
//      XYZ is the carry, even when XYZ holds fewer items than a tank).
//   2. Unit holding the most DAMAGE-carry items (offensive: AD, AP, hybrid,
//      AS). Tanks holding 3 defensive items don't bubble up here.
//   3. Fallback: unit with the most items (legacy heuristic), then highest
//      tier then highest cost — for early-game boards where no real
//      offensive items have been built yet.
// Returns null if the board is too sparse to classify.
function classifyComp(participant) {
  // *UniqueTrait* sind Unit-Innate-Traits (Shen/Sona/Zed/...), die nur der
  // jeweilige Champion aktiviert und immer Tier 1 sind. Bei Level-9 Filler-
  // Boards mit z.B. Shen drin haben sie den höchsten style-Wert und würden
  // sonst den primaryTrait stellen → "Bulwark Bard"-Cluster statt der echten
  // themed comp. Filter raus.
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

  // 1) Hero-Augment override.
  const heroCarryId = carryFromAugments(participant, units);
  let carry = heroCarryId ? units.find(u => (u.character_id || u.characterId) === heroCarryId) : null;

  // 2) Most damage-carry items.
  if (!carry) {
    const byOffensiveItems = [...units]
      .map(u => {
        const items = u.itemNames || [];
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
  }

  // 3) Legacy fallback — most items total, then star, then cost.
  if (!carry) {
    const ranked = [...units].sort((a, b) => {
      const aItems = (a.itemNames || []).length;
      const bItems = (b.itemNames || []).length;
      if (bItems !== aItems) return bItems - aItems;
      if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
      return (b.rarity ?? 0) - (a.rarity ?? 0);
    });
    carry = ranked[0];
  }
  if (!carry?.character_id && !carry?.characterId) return null;
  const carryId = carry.character_id || carry.characterId;

  // Sub-Cluster via Secondary-Damage-Carry — splittet z.B. "Meeple Corki" auf
  // in den Standard (kein zweiter damage-carrier, Riven/Bard/etc. tragen
  // primär Tank/Support-Items) und die Dual-Carry-Variante (Gnar/zweite Unit
  // hält ≥3 damage-carry-Items als parallel carry).
  //   clusterKey ohne #suffix  → keine zweite Carry-Unit
  //   clusterKey#<characterId> → diese Unit hält die zweitmeisten damage-items
  //
  // Threshold von 2 auf 3 erhöht (2026-06-15): Caster-Supports wie Nami mit
  // 2 Caster-Items (Shojin + Morello als Mana-Engine) wurden fälschlich als
  // Secondary-Carry markiert, obwohl sie effektiv Support-Rolle haben — das
  // führte zu Pseudo-Sub-Clustern wie "Samira*3#Nami" neben "Samira*3" mit
  // identischem Board. Echte Dual-Carry-Builds haben fast immer 3 volle
  // Damage-Items auf der zweiten Unit (z.B. Lulu+Milio in Stargazer).
  const SECONDARY_MIN_DMG_ITEMS = 3;
  const secondaryCarry = units
    .map(u => {
      const cid = u.character_id || u.characterId;
      if (!cid || cid === carryId) return null;
      const items = u.itemNames || [];
      const dmgItems = items.filter(i => DAMAGE_CARRY_ITEMS.has(i)).length;
      return dmgItems >= SECONDARY_MIN_DMG_ITEMS ? { cid, dmgItems, tier: u.tier ?? 1 } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (b.dmgItems !== a.dmgItems) return b.dmgItems - a.dmgItems;
      return (b.tier ?? 1) - (a.tier ?? 1);
    })[0];

  // Sub-Cluster via Carry-Star — eine 3-Star-Reroll-Variante ist mechanisch
  // eine ganz andere Comp als die 2-Star-Push-Variante desselben Carry
  // (typisch Lvl 6/7 Reroll vs Lvl 8/9 Push).
  const carryStar = carry.tier ?? 2;
  const starSuffix = carryStar === 3 ? '*3' : '';
  // Sub-Cluster via comp-definierendes Augment — die Spielweise (Reroll-
  // Incentive, 2-Cost-Stacking etc.) ändert sich substantiell und macht
  // einen eigenen Sub-Cluster gerechtfertigt. Hero-Augments sind hier
  // explizit NICHT enthalten (die wirken via carryFromAugments oben).
  const augSlug = compDefiningAugmentSlug(participant.augments);
  const augSuffix = augSlug ? `~${augSlug}` : '';
  const baseKey = `${primaryTrait.name}@${primaryTrait.tier_current ?? 0}_${carryId}${starSuffix}${augSuffix}`;
  const clusterKey = secondaryCarry ? `${baseKey}#${secondaryCarry.cid}` : baseKey;

  return {
    clusterKey,
    primaryTrait: primaryTrait.name,
    primaryTraitLevel: primaryTrait.tier_current ?? 0,
    carryUnit: carryId,
    carryStar,
    compDefiningAugment: augSlug,
    secondaryCarry: secondaryCarry?.cid || null,
    carryItems: (carry.itemNames || []).filter(Boolean).sort(),
  };
}

/**
 * Update `agg` in-place with one match. The match is expected to be the raw
 * Match-V1 DTO from Riot; we re-extract here (instead of using the frontend
 * processor) so the script stays decoupled.
 *
 * @param tierBucket lowercase tier name; the discovery layer tags every puuid
 *        with its source tier, then the crawler passes the tier of the puuid
 *        whose match this is. We only count once per match per tier.
 */
export function aggregateMatch(rawMatch, agg, opts) {
  const { tierBucket, currentSet, focusPuuid, proPuuids } = opts;
  if (!rawMatch?.info?.participants) { agg.matchesSkipped++; return false; }
  const info = rawMatch.info;
  // Filter out non-ranked queues just in case the crawler missed it.
  if ((info.queue_id ?? info.queueId) !== 1100) { agg.matchesSkipped++; return false; }
  const participants = info.participants;
  // Set filter: every unit on this match should belong to the current set
  // (any participant with a non-current TFT prefix means a stale match).
  if (currentSet != null) {
    const sample = participants?.[0]?.units?.[0]?.character_id || '';
    const m = /^TFT(\d+)_/.exec(sample);
    if (m && Number(m[1]) !== currentSet) { agg.matchesSkipped++; return false; }
  }

  agg.matchesAnalyzed++;
  agg.participantsByBucket.set(
    tierBucket,
    (agg.participantsByBucket.get(tierBucket) || 0) + participants.length,
  );

  // Detect whether this match has at least one pro participant. If yes,
  // we'll write every per-participant aggregation TWICE — once into the
  // normal tierBucket and once into the synthetic 'pro_pool' bucket. This
  // gives us pro-only Avg/Top4/Pick rates without a parallel schema —
  // tft-supabase-reader just treats pro_pool as another bucket name.
  const hasPro = proPuuids && proPuuids.size > 0 && participants.some(p => p.puuid && proPuuids.has(p.puuid));
  if (hasPro) {
    agg.participantsByBucket.set(
      'pro_pool',
      (agg.participantsByBucket.get('pro_pool') || 0) + participants.length,
    );
  }
  // Bucket-list each aggregation writes to. We loop over this instead of
  // duplicating the inner aggregation code.
  const buckets = hasPro ? [tierBucket, 'pro_pool'] : [tierBucket];

  // We aggregate every participant of the match (not just focusPuuid). The
  // tier-bucket attribution uses the focus player's tier — that's how
  // metatft / tactics.tools attribute games too: a match shows up under the
  // bucket of the player whose lobby it represents.

  // Pre-classify each participant's comp for the comp + pair aggregations.
  const compClass = participants.map(p => classifyComp(p));

  // W4-B: count cluster_key occurrences in this lobby so we can attribute a
  // contested-level (1 / 2 / 3+) to every participant when we hit the comp
  // bucket below. Done once per match, lookups are O(1) inside the loop.
  const clusterCounts = new Map();
  for (const c of compClass) {
    if (!c?.clusterKey) continue;
    clusterCounts.set(c.clusterKey, (clusterCounts.get(c.clusterKey) || 0) + 1);
  }

  for (let pIdx = 0; pIdx < participants.length; pIdx++) {
    const p = participants[pIdx];
    const compInfo = compClass[pIdx];
    const placement = p.placement ?? 9;
    const top4 = placement <= 4;
    const top1 = placement === 1;

    // Damage-Atlas: attribute participant.total_damage_to_players to the
    // inferred carry (unit with most items; ties: higher star then higher
    // cost). compInfo.carryUnit already encodes this exact rule from
    // classifyComp; fall back to a fresh ranking when classifyComp returned
    // null (e.g. early surrender with no activated trait).
    const totalDmg = Number(p.total_damage_to_players ?? 0);
    let carryUnit = null;
    if (totalDmg > 0) {
      if (compInfo) {
        carryUnit = (p.units || []).find(u => u.character_id === compInfo.carryUnit) || null;
      } else if ((p.units || []).length > 0) {
        const ranked = [...p.units].sort((a, b) => {
          const ai = (a.itemNames || []).length;
          const bi = (b.itemNames || []).length;
          if (bi !== ai) return bi - ai;
          if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
          return (b.rarity ?? 0) - (a.rarity ?? 0);
        });
        carryUnit = ranked[0] || null;
      }
    }

    // Per unit — writes to every bucket in `buckets` (tierBucket + optionally
    // 'pro_pool'). The inner loop is identical; we just reach into the
    // bucket-level map per iteration.
    for (const u of p.units || []) {
      const cid = u.character_id;
      if (!cid) continue;
      const unitBuckets = getOrCreate(agg.byUnit, cid, () => new Map());
      for (const bucket of buckets) {
        const ub = getOrCreate(unitBuckets, bucket, newUnitBucket);
        ub.games++;
        ub.sumPlacement += placement;
        if (top4) ub.top4++;
        if (top1) ub.top1++;

        const items = Array.isArray(u.itemNames) ? u.itemNames : [];
        const starTier = String(u.tier ?? 1);
        let starItems = null;
        const seenItem = new Set();
        for (const it of items) {
          if (!it || seenItem.has(it)) continue;
          seenItem.add(it);
          // Global (all stars)
          const ie = getOrCreate(ub.items, it, () => ({ games: 0, top4: 0, sumPlacement: 0 }));
          ie.games++;
          ie.sumPlacement += placement;
          if (top4) ie.top4++;
          // Per star-tier
          if (!starItems) {
            starItems = ub.itemsByTier.get(starTier);
            if (!starItems) { starItems = new Map(); ub.itemsByTier.set(starTier, starItems); }
          }
          const ie2 = getOrCreate(starItems, it, () => ({ games: 0, top4: 0, sumPlacement: 0 }));
          ie2.games++;
          ie2.sumPlacement += placement;
          if (top4) ie2.top4++;
        }
        if (items.length >= 3) {
          const sorted = [...items].sort();
          const key = sorted.join('|');
          // Global
          const se = getOrCreate(ub.itemSets, key, () => ({ items: sorted, games: 0, top4: 0, sumPlacement: 0 }));
          se.games++;
          se.sumPlacement += placement;
          if (top4) se.top4++;
          // Per star-tier
          let starSets = ub.itemSetsByTier.get(starTier);
          if (!starSets) { starSets = new Map(); ub.itemSetsByTier.set(starTier, starSets); }
          const se2 = getOrCreate(starSets, key, () => ({ items: sorted, games: 0, top4: 0, sumPlacement: 0 }));
          se2.games++;
          se2.sumPlacement += placement;
          if (top4) se2.top4++;
        }

        // Damage-Atlas: only attribute when THIS unit IS the participant's
        // carry. itemCount caps at 3 (Match-V1 allows ≤3 items per unit).
        if (carryUnit && carryUnit.character_id === cid && totalDmg > 0) {
          const carryItemCount = String(Math.min(3, (carryUnit.itemNames || []).length));
          let tierMap = ub.carryDamage.get(starTier);
          if (!tierMap) { tierMap = new Map(); ub.carryDamage.set(starTier, tierMap); }
          let arr = tierMap.get(carryItemCount);
          if (!arr) { arr = []; tierMap.set(carryItemCount, arr); }
          arr.push(totalDmg);
          // Parallel carry-performance bin (placement/top4/top1) for the same carry.
          let perfTier = ub.carryPerf.get(starTier);
          if (!perfTier) { perfTier = new Map(); ub.carryPerf.set(starTier, perfTier); }
          let pe = perfTier.get(carryItemCount);
          if (!pe) { pe = { games: 0, sumPlacement: 0, top4: 0, top1: 0 }; perfTier.set(carryItemCount, pe); }
          pe.games++; pe.sumPlacement += placement; if (top4) pe.top4++; if (top1) pe.top1++;
        }
        // Item-Slot-Build-Order (Sprint 2.4): build slot index in itemNames
        // is the order Riot reports them — slot 0 was built first.
        if (items.length > 0) {
          let slotMap = ub.itemSlotOrderByTier.get(starTier);
          if (!slotMap) { slotMap = new Map(); ub.itemSlotOrderByTier.set(starTier, slotMap); }
          for (let si = 0; si < Math.min(3, items.length); si++) {
            const it = items[si];
            if (!it) continue;
            const slotKey = String(si);
            let slotEntry = slotMap.get(slotKey);
            if (!slotEntry) { slotEntry = new Map(); slotMap.set(slotKey, slotEntry); }
            slotEntry.set(it, (slotEntry.get(it) || 0) + 1);
          }
        }
      }

      // byItem reverse index — same dual-bucket pattern
      const items2 = Array.isArray(u.itemNames) ? u.itemNames : [];
      const seenItem2 = new Set();
      for (const it of items2) {
        if (!it || seenItem2.has(it)) continue;
        seenItem2.add(it);
        const itemBuckets = getOrCreate(agg.byItem, it, () => new Map());
        for (const bucket of buckets) {
          const ib = getOrCreate(itemBuckets, bucket, newItemBucket);
          ib.games++;
          ib.sumPlacement += placement;
          if (top4) ib.top4++;
          // Per-carrier outcomes — we already had games + sumPlacement, top4/
          // top1 now too so the item-detail page can show "Avg-Place + T4% +
          // T1% per Top-Carrier" instead of just games-count. Pre-existing
          // snapshots stay valid (writers/readers default-zero when absent).
          const userEntry = getOrCreate(ib.users, cid, () => ({ games: 0, sumPlacement: 0, top4: 0, top1: 0 }));
          userEntry.games++;
          userEntry.sumPlacement += placement;
          if (top4) userEntry.top4++;
          if (placement === 1) userEntry.top1++;
        }
      }
    }

    // Per augment — slot index = position in the augments array
    const augments = Array.isArray(p.augments) ? p.augments : [];
    for (let i = 0; i < augments.length; i++) {
      const apiName = augments[i];
      if (!apiName) continue;
      const slotKey = String(i);
      const slotBuckets = getOrCreate(
        getOrCreate(agg.byAugment, apiName, () => new Map()),
        slotKey,
        () => new Map(),
      );
      for (const bucket of buckets) {
        const ab = getOrCreate(slotBuckets, bucket, newAugmentBucket);
        ab.games++;
        ab.sumPlacement += placement;
        if (top4) ab.top4++;
      }
    }

    // Per trait — only when activated (style > 0)
    for (const t of p.traits || []) {
      if (!t.name || (t.style ?? 0) === 0) continue;
      const activation = String(t.tier_current ?? 0);
      const actBuckets = getOrCreate(
        getOrCreate(agg.byTrait, t.name, () => new Map()),
        activation,
        () => new Map(),
      );
      for (const bucket of buckets) {
        const tb = getOrCreate(actBuckets, bucket, newTraitBucket);
        tb.games++;
        tb.sumPlacement += placement;
        if (top4) tb.top4++;
      }
      // Per ACTUAL unit count (num_units) — "does overcapping help?". Same
      // dual-bucket pattern, keyed by the real unit count rather than the
      // activated breakpoint (tier_current). num_units lives on the raw trait
      // object and was previously unused by any aggregation.
      const numUnits = Number(t.num_units ?? 0);
      if (numUnits > 0) {
        const ucBuckets = getOrCreate(
          getOrCreate(agg.byTraitUnitCount, t.name, () => new Map()),
          String(numUnits),
          () => new Map(),
        );
        for (const bucket of buckets) {
          const tb = getOrCreate(ucBuckets, bucket, newTraitBucket);
          tb.games++;
          tb.sumPlacement += placement;
          if (top4) tb.top4++;
        }
      }
    }

    // Per comp cluster — same dual-bucket pattern. typicalUnits / augments /
    // carryItems Maps live on each bucket entry; they accumulate independently.
    if (compInfo) {
      const compBuckets = getOrCreate(agg.byComp, compInfo.clusterKey, () => new Map());
      for (const bucket of buckets) {
        const cb = getOrCreate(compBuckets, bucket, newCompBucket);
        cb.games++;
        cb.sumPlacement += placement;
        cb.sumLevel += Number(p.level ?? 0);
        cb.sumLastRound += Number(p.last_round ?? 0);
        if (top4) cb.top4++;
        if (top1) cb.top1++;
        for (const u of p.units || []) {
          if (!u.character_id) continue;
          const ue = getOrCreate(cb.typicalUnits, u.character_id, () => ({
            count: 0,
            carryItemGames: 0,
            items: new Map(),     // apiName -> games-on-this-unit-in-this-comp
          }));
          ue.count++;
          const items = Array.isArray(u.itemNames) ? u.itemNames : [];
          if (items.some(it => DAMAGE_CARRY_ITEMS.has(it))) ue.carryItemGames++;
          const seen = new Set();
          for (const it of items) {
            if (!it || seen.has(it)) continue;
            seen.add(it);
            ue.items.set(it, (ue.items.get(it) || 0) + 1);
          }
        }
        const augs = Array.isArray(p.augments) ? p.augments : [];
        for (const a of augs) {
          if (!a) continue;
          const ae = getOrCreate(cb.typicalAugments, a, () => ({ count: 0, sumPlacement: 0 }));
          ae.count++;
          ae.sumPlacement += placement;
        }
        if (compInfo.carryItems.length === 3) {
          const ckey = compInfo.carryItems.join('|');
          cb.carryItems.set(ckey, (cb.carryItems.get(ckey) || 0) + 1);
        }
        // Death-round histogram. Skip round 0 (sentinel for no-data).
        const lr = Number(p.last_round ?? 0);
        if (lr > 0) {
          const key = String(lr);
          const re = getOrCreate(cb.lastRoundDist, key, () => ({ games: 0, top4: 0 }));
          re.games++;
          if (top4) re.top4++;
        }
        // Aggro-Index input
        cb.sumPlayersEliminated += Number(p.players_eliminated ?? 0);
        // Comp-Eco input: Σ gold_left → avgGoldLeft = sum/games (economy profile)
        cb.sumGoldLeft += Number(p.gold_left ?? 0);
        // W3-A: Carry-Star outcome — find the unit instance matching compInfo's
        // carry (deterministic by classifyComp's item-count/tier ranking) and
        // record its star with the placement. Falls through to '0' when the
        // carry can't be located (defensive — shouldn't happen since classifyComp
        // returned compInfo from the same units list).
        {
          const cu = (p.units || []).find(u => u.character_id === compInfo.carryUnit);
          const carryStar = cu?.tier ?? 0;
          if (carryStar > 0) {
            const csKey = String(carryStar);
            const cse = getOrCreate(cb.carryStarOutcome, csKey, () => ({
              games: 0, sumPlacement: 0, top4: 0, top1: 0,
            }));
            cse.games++;
            cse.sumPlacement += placement;
            if (top4) cse.top4++;
            if (top1) cse.top1++;
          }
        }
        // W4-B: Contested-level bucket. clusterCounts was filled before this
        // loop, so reading it here is O(1). Cap at 3 so the UI never has to
        // deal with a long tail of "5-contested" outliers.
        {
          const contested = Math.min(3, clusterCounts.get(compInfo.clusterKey) || 1);
          const ckey = String(contested);
          const ce = getOrCreate(cb.contestedDist, ckey, () => ({
            games: 0, sumPlacement: 0, top4: 0, top1: 0,
          }));
          ce.games++;
          ce.sumPlacement += placement;
          if (top4) ce.top4++;
          if (top1) ce.top1++;
        }
        // Leveling-tempo input: per-final-level histogram + parallel last_round
        // accumulator. Skip if level is missing/0 (early surrender row).
        const finalLevel = Number(p.level ?? 0);
        if (finalLevel > 0) {
          const lkey = String(finalLevel);
          const le = getOrCreate(cb.levelDist, lkey, () => ({ games: 0, sumLastRound: 0 }));
          le.games++;
          le.sumLastRound += lr;
        }
      }
    }
  }

  // Per-match pair tracking — head-to-head between every pair of comps in
  // the lobby (8 players → up to 28 pairs). Used downstream for counter
  // edges. Sorted-key ensures (A,B) and (B,A) collapse.
  for (let i = 0; i < participants.length; i++) {
    const a = compClass[i];
    if (!a) continue;
    const aPlace = participants[i].placement ?? 9;
    for (let j = i + 1; j < participants.length; j++) {
      const b = compClass[j];
      if (!b || a.clusterKey === b.clusterKey) continue;
      const sorted = [a.clusterKey, b.clusterKey].sort();
      const key = sorted.join('||');
      const bPlace = participants[j].placement ?? 9;
      const entry = getOrCreate(agg.byCompPair, key, () => ({ a: sorted[0], b: sorted[1], games: 0, aBetter: 0 }));
      entry.games++;
      const aIsFirst = sorted[0] === a.clusterKey;
      const aWon = aPlace < bPlace;
      if (aIsFirst ? aWon : !aWon) entry.aBetter++;
    }
  }

  return true;
}

// Roll up per-tier buckets into "all" and "master_plus" so the frontend can
// pick a slice without re-aggregating. Pure summation — averages computed at
// emit-time from the rolled sums.
function rollUp(perBucket) {
  // 'all' aggregates only the base tier buckets — pro_pool is a parallel
  // dimension (it's already a duplicate of tier-bucket games for matches
  // with pro participants), so summing it into 'all' would double-count.
  const baseEntries = TIER_BUCKETS.map(b => perBucket.get(b)).filter(Boolean);
  const all = mergeBuckets(baseEntries);
  const masterPlus = mergeBuckets(APEX_BUCKETS.map(b => perBucket.get(b)).filter(Boolean));
  if (all) perBucket.set('all', all);
  if (masterPlus) perBucket.set('master_plus', masterPlus);
}

// Recursively merge a list of Maps. Numeric values are summed, nested Maps
// recursed into, arrays concatenated (carryDamage leaves), plain objects
// deep-merged via mergeBuckets. Used for the Map<tier, Map<...>> shapes
// introduced by itemsByTier / itemSetsByTier / carryDamage.
function mergeMaps(list) {
  const out = new Map();
  for (const m of list) {
    if (!(m instanceof Map)) continue;
    for (const [k, v] of m) {
      const existing = out.get(k);
      if (typeof v === 'number') {
        out.set(k, (existing || 0) + v);
      } else if (Array.isArray(v)) {
        out.set(k, existing ? existing.concat(v) : v.slice());
      } else if (v instanceof Map) {
        out.set(k, mergeMaps(existing ? [existing, v] : [v]));
      } else {
        out.set(k, mergeBuckets(existing ? [existing, v] : [v]));
      }
    }
  }
  return out;
}

function mergeBuckets(list) {
  if (list.length === 0) return null;
  // Generic merge: numeric fields summed, Maps merged element-wise.
  const out = {};
  for (const src of list) {
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      else if (v instanceof Map) {
        if (!out[k]) out[k] = new Map();
        for (const [kk, vv] of v) {
          // Map values can be primitives (typicalUnits stores number counts),
          // nested Maps (itemsByTier[tier] -> Map<item, obj>), or plain
          // sub-objects (item entries store {games, sumPlacement, …}).
          if (typeof vv === 'number') {
            out[k].set(kk, ((out[k].get(kk) || 0)) + vv);
          } else if (vv instanceof Map) {
            const existing = out[k].get(kk);
            out[k].set(kk, mergeMaps(existing ? [existing, vv] : [vv]));
          } else {
            const existing = out[k].get(kk);
            if (!existing) out[k].set(kk, mergeBuckets([vv]));
            else out[k].set(kk, mergeBuckets([existing, vv]));
          }
        }
      } else if (Array.isArray(v)) {
        out[k] = v;  // e.g. items: [a,b,c]
      }
    }
  }
  return out;
}

// Pick the value at percentile `p` (0..1) from a pre-sorted ascending array.
// Returns null for an empty array. Uses the nearest-rank method which is
// stable for small samples and doesn't interpolate (rounded damage values
// read cleaner in the UI).
function percentile(sortedAsc, p) {
  if (!sortedAsc || sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p));
  return sortedAsc[idx];
}

export function finalize(agg, opts = {}) {
  const minUnitGames = opts.minUnitGames ?? 5;
  const minItemGames = opts.minItemGames ?? 5;
  const minAugmentGames = opts.minAugmentGames ?? 5;
  const minCompGames = opts.minCompGames ?? 8;
  const minPairGames = opts.minPairGames ?? 10;

  // 1) Roll up tier buckets to derive "all" and "master_plus".
  for (const buckets of agg.byUnit.values())     rollUp(buckets);
  for (const buckets of agg.byItem.values())     rollUp(buckets);
  for (const slotMap of agg.byAugment.values())  for (const buckets of slotMap.values()) rollUp(buckets);
  for (const actMap  of agg.byTrait.values())    for (const buckets of actMap.values())  rollUp(buckets);
  for (const ucMap   of agg.byTraitUnitCount.values()) for (const buckets of ucMap.values()) rollUp(buckets);
  for (const buckets of agg.byComp.values())     rollUp(buckets);

  // Roll up participants per bucket into 'all' and 'master_plus' so the
  // pickRate denominator works for the rolled-up roll-ups too. pro_pool
  // is excluded from 'all' for the same reason rollUp() above excludes it —
  // it duplicates already-counted participants.
  const participantsByBucket = {};
  let allP = 0;
  let mpP = 0;
  for (const [b, count] of agg.participantsByBucket) {
    participantsByBucket[b] = count;
    if (TIER_BUCKETS.includes(b)) allP += count;
    if (APEX_BUCKETS.includes(b)) mpP += count;
  }
  participantsByBucket.all = allP;
  participantsByBucket.master_plus = mpP;

  // 2) Convert Maps to plain objects + Top-N per section.
  const out = {
    matchesAnalyzed: agg.matchesAnalyzed,
    matchesSkipped: agg.matchesSkipped,
    participantsByBucket,
    byUnit: {},
    byItem: {},
    byAugment: {},
    byTrait: {},
    byTraitUnitCount: {},
    byComp: {},
    compPairs: [],
  };

  for (const [cid, buckets] of agg.byUnit) {
    out.byUnit[cid] = {};
    for (const [bucket, b] of buckets) {
      if (b.games < minUnitGames) continue;
      const topItems = [...b.items.entries()]
        .map(([item, e]) => ({ item, games: e.games, top4: e.top4, sumPlacement: e.sumPlacement }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 10);
      const topItemSets = [...b.itemSets.values()]
        .sort((a, b) => b.games - a.games)
        .slice(0, 5)
        .map(s => ({ items: s.items, games: s.games, top4: s.top4, sumPlacement: s.sumPlacement }));
      // Per-star-tier top-N (BiS by star level). Same min-games threshold per
      // tier so we don't surface 2-game samples for 3-star carries.
      const topItemsByTier = {};
      const topItemSetsByTier = {};
      const itemsByTier = b.itemsByTier instanceof Map ? b.itemsByTier : new Map();
      const itemSetsByTier = b.itemSetsByTier instanceof Map ? b.itemSetsByTier : new Map();
      for (const [tier, itemMap] of itemsByTier) {
        if (!(itemMap instanceof Map)) continue;
        const arr = [...itemMap.entries()]
          .map(([item, e]) => ({ item, games: e.games, top4: e.top4, sumPlacement: e.sumPlacement }))
          .sort((a, b) => b.games - a.games)
          .slice(0, 10);
        if (arr.length > 0) topItemsByTier[tier] = arr;
      }
      for (const [tier, setMap] of itemSetsByTier) {
        if (!(setMap instanceof Map)) continue;
        const arr = [...setMap.values()]
          .sort((a, b) => b.games - a.games)
          .slice(0, 5)
          .map(s => ({ items: s.items, games: s.games, top4: s.top4, sumPlacement: s.sumPlacement }));
        if (arr.length > 0) topItemSetsByTier[tier] = arr;
      }
      // Damage-Atlas: percentiles per (tier, itemCount). Only emit bins with
      // ≥10 samples — anything sparser is too noisy to be useful.
      const damageByTier = {};
      const carryDamage = b.carryDamage instanceof Map ? b.carryDamage : new Map();
      const MIN_DAMAGE_SAMPLES = 10;
      for (const [tier, itemCountMap] of carryDamage) {
        if (!(itemCountMap instanceof Map)) continue;
        const perItemCount = {};
        for (const [itemCount, arr] of itemCountMap) {
          if (!Array.isArray(arr) || arr.length < MIN_DAMAGE_SAMPLES) continue;
          const sorted = [...arr].sort((a, b) => a - b);
          perItemCount[itemCount] = {
            games: sorted.length,
            p50: percentile(sorted, 0.50),
            p75: percentile(sorted, 0.75),
            p95: percentile(sorted, 0.95),
            p99: percentile(sorted, 0.99),
            max: sorted[sorted.length - 1],
          };
        }
        if (Object.keys(perItemCount).length > 0) damageByTier[tier] = perItemCount;
      }
      // Carry-Performance: avg placement + top4/top1 per (tier, itemCount) when
      // THIS unit was the carry. Emit raw sums (API computes the rates), only
      // bins with ≥20 samples — sparser is too noisy for a per-(tier,item) cell.
      const carryPlacementByTier = {};
      const carryPerf = b.carryPerf instanceof Map ? b.carryPerf : new Map();
      const MIN_CARRY_PERF_SAMPLES = 20;
      for (const [tier, itemCountMap] of carryPerf) {
        if (!(itemCountMap instanceof Map)) continue;
        const perItemCount = {};
        for (const [itemCount, e] of itemCountMap) {
          if (!e || e.games < MIN_CARRY_PERF_SAMPLES) continue;
          perItemCount[itemCount] = { games: e.games, sumPlacement: e.sumPlacement, top4: e.top4, top1: e.top1 };
        }
        if (Object.keys(perItemCount).length > 0) carryPlacementByTier[tier] = perItemCount;
      }
      // Item-Slot-Build-Order: per (tier, slotIdx), top-3 items by frequency.
      const itemSlotOrderByTier = {};
      const slotMaster = b.itemSlotOrderByTier instanceof Map ? b.itemSlotOrderByTier : new Map();
      for (const [tier, slotMap] of slotMaster) {
        if (!(slotMap instanceof Map)) continue;
        const perSlot = {};
        for (const [slotIdx, itemMap] of slotMap) {
          if (!(itemMap instanceof Map)) continue;
          perSlot[slotIdx] = [...itemMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([item, count]) => ({ item, count }));
        }
        if (Object.keys(perSlot).length > 0) itemSlotOrderByTier[tier] = perSlot;
      }
      out.byUnit[cid][bucket] = {
        games: b.games, sumPlacement: b.sumPlacement, top4: b.top4, top1: b.top1,
        topItems, topItemSets,
        topItemsByTier, topItemSetsByTier,
        damageByTier,
        carryPlacementByTier,
        itemSlotOrderByTier,
      };
    }
  }
  for (const [item, buckets] of agg.byItem) {
    out.byItem[item] = {};
    for (const [bucket, b] of buckets) {
      if (b.games < minItemGames) continue;
      // Store top 10 in the daily snapshot so the API has headroom to show
      // 8 after applying the exclusion list — the items-list column has
      // space for 8 cost-bordered tiles.
      const topUsers = [...b.users.entries()]
        .map(([cid, e]) => ({
          characterId: cid,
          games: e.games,
          sumPlacement: e.sumPlacement,
          top4: e.top4 || 0,
          top1: e.top1 || 0,
        }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 10);
      out.byItem[item][bucket] = {
        games: b.games, sumPlacement: b.sumPlacement, top4: b.top4, topUsers,
      };
    }
  }
  for (const [aug, slotMap] of agg.byAugment) {
    out.byAugment[aug] = {};
    for (const [slot, buckets] of slotMap) {
      out.byAugment[aug][slot] = {};
      for (const [bucket, b] of buckets) {
        if (b.games < minAugmentGames) continue;
        out.byAugment[aug][slot][bucket] = { games: b.games, sumPlacement: b.sumPlacement, top4: b.top4 };
      }
    }
  }
  for (const [trait, actMap] of agg.byTrait) {
    out.byTrait[trait] = {};
    for (const [act, buckets] of actMap) {
      out.byTrait[trait][act] = {};
      for (const [bucket, b] of buckets) {
        if (b.games < minAugmentGames) continue;
        out.byTrait[trait][act][bucket] = { games: b.games, sumPlacement: b.sumPlacement, top4: b.top4 };
      }
    }
  }
  for (const [trait, ucMap] of agg.byTraitUnitCount) {
    out.byTraitUnitCount[trait] = {};
    for (const [nu, buckets] of ucMap) {
      out.byTraitUnitCount[trait][nu] = {};
      for (const [bucket, b] of buckets) {
        if (b.games < minAugmentGames) continue;
        out.byTraitUnitCount[trait][nu][bucket] = { games: b.games, sumPlacement: b.sumPlacement, top4: b.top4 };
      }
    }
  }

  // Comp clusters
  for (const [key, buckets] of agg.byComp) {
    const slim = {};
    // Carry-Unit aus dem clusterKey extrahieren — sie bleibt IMMER in
    // typicalUnits, auch wenn ihr Cooccurrence-Wert unter dem Threshold liegt
    // (defensiv: ein Cluster kennt seinen Carry per Definition). Suffixe:
    //   *N      → N-Star-Carry-Variante
    //   ~<slug> → comp-definierendes Augment (Two Tanky etc.)
    //   #ID     → Secondary-Damage-Carry-Variante
    // Alle werden hier abgeknippt — wir wollen die nackte PRIMARY-Carry-ID.
    const carryFromKey = (() => {
      const m = /^.+@\d+_([^#*~]+)(?:\*\d)?(?:~[A-Za-z]+)?(?:#.+)?$/.exec(key);
      return m ? m[1] : null;
    })();
    // Sekundäre Carry-Unit (aus #-Suffix) — ebenfalls immer in typicalUnits.
    const secondaryFromKey = (() => {
      const m = /#(.+)$/.exec(key);
      return m ? m[1] : null;
    })();
    for (const [bucket, b] of buckets) {
      if (b.games < minCompGames) continue;
      // Cooccurrence-Threshold (15 % ODER ≥3 Games, je nachdem was höher
      // ist): bei hohem Sample setzt die Prozent-Schranke, bei niedrigem
      // Sample die 3-Game-Untergrenze. Gesenkt von 40% (2026-06-18) damit
      // flexible Reroll-Comps (Samira *3, MF) konsistent 9 Units zeigen
      // statt nur die rigide Core (5-7). 15 % schneidet Low-Sample-Noise
      // (Position 9 mit 1-2 Games) weiterhin ab. Primary + Secondary aus
      // dem cluster_key bleiben unabhängig vom Threshold immer drin.
      const minCo = Math.max(3, Math.floor(b.games * 0.15));
      const typicalUnits = [...b.typicalUnits.entries()]
        .filter(([cid, e]) => (e.count || 0) >= minCo || cid === carryFromKey || cid === secondaryFromKey)
        .sort((a, b) => (b[1].count || 0) - (a[1].count || 0))
        .slice(0, 9)
        .map(([cid, e]) => {
          const topItems = e.items
            ? [...e.items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
                .map(([apiName, count]) => ({ apiName, count }))
            : [];
          return {
            characterId: cid,
            count: e.count,
            carryItemGames: e.carryItemGames || 0,
            topItems,
          };
        });
      const typicalAugments = [...b.typicalAugments.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 6)
        .map(([apiName, e]) => ({ apiName, count: e.count, sumPlacement: e.sumPlacement }));
      const carryItems = [...b.carryItems.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, count]) => ({ items: k.split('|'), count }));
      // Death-round histogram split into two parallel jsonb dicts (one with
      // games-per-round, one with top4-per-round). Two dicts so the
      // jsonb_agg roll-up in get_tft_comp_stats can sum each independently
      // without parsing nested objects in SQL.
      const lastRoundDist = {};
      const top4ByRound = {};
      const lrMap = b.lastRoundDist instanceof Map ? b.lastRoundDist : new Map();
      for (const [round, e] of lrMap) {
        lastRoundDist[round] = (lastRoundDist[round] || 0) + e.games;
        if (e.top4) top4ByRound[round] = (top4ByRound[round] || 0) + e.top4;
      }
      // Per-final-level histograms (Sprint 2.2 — Leveling-Tempo-Curves).
      const levelDist = {};
      const levelSumLastRound = {};
      const lvlMap = b.levelDist instanceof Map ? b.levelDist : new Map();
      for (const [lvl, e] of lvlMap) {
        levelDist[lvl] = (levelDist[lvl] || 0) + e.games;
        levelSumLastRound[lvl] = (levelSumLastRound[lvl] || 0) + e.sumLastRound;
      }
      // W3-A: Carry-Star outcome serialized as { "<star>": { games, sumPlacement, top4, top1 } }
      const carryStarDist = {};
      const csMap = b.carryStarOutcome instanceof Map ? b.carryStarOutcome : new Map();
      for (const [star, e] of csMap) {
        carryStarDist[star] = {
          games: (carryStarDist[star]?.games || 0) + e.games,
          sumPlacement: (carryStarDist[star]?.sumPlacement || 0) + e.sumPlacement,
          top4: (carryStarDist[star]?.top4 || 0) + e.top4,
          top1: (carryStarDist[star]?.top1 || 0) + e.top1,
        };
      }
      // W4-B: Contested-Distribution serialized as { "1": {games, sumPlacement, top4, top1}, ... }
      const contestedDist = {};
      const cnMap = b.contestedDist instanceof Map ? b.contestedDist : new Map();
      for (const [level, e] of cnMap) {
        contestedDist[level] = {
          games: (contestedDist[level]?.games || 0) + e.games,
          sumPlacement: (contestedDist[level]?.sumPlacement || 0) + e.sumPlacement,
          top4: (contestedDist[level]?.top4 || 0) + e.top4,
          top1: (contestedDist[level]?.top1 || 0) + e.top1,
        };
      }
      slim[bucket] = {
        games: b.games, sumPlacement: b.sumPlacement, top4: b.top4, top1: b.top1,
        sumLevel: b.sumLevel ?? 0,
        sumLastRound: b.sumLastRound ?? 0,
        sumPlayersEliminated: b.sumPlayersEliminated ?? 0,
        sumGoldLeft: b.sumGoldLeft ?? 0,
        typicalUnits, typicalAugments, carryItems,
        lastRoundDist, top4ByRound,
        levelDist, levelSumLastRound,
        carryStarDist,
        contestedDist,
      };
    }
    if (Object.keys(slim).length > 0) out.byComp[key] = slim;
  }

  // Comp pairs (counter signals) — keep only meaningful matchups
  for (const [, e] of agg.byCompPair) {
    if (e.games < minPairGames) continue;
    const aWinRate = e.aBetter / e.games;
    if (aWinRate >= 0.55 || aWinRate <= 0.45) {
      out.compPairs.push({ a: e.a, b: e.b, games: e.games, aBetter: e.aBetter });
    }
  }

  return out;
}

export const TIER_LIST = TIER_BUCKETS;

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

export function emptyAggregate() {
  return {
    byUnit: new Map(),     // characterId -> Map<bucket, UnitBucket>
    byItem: new Map(),     // apiName -> Map<bucket, ItemBucket>
    byAugment: new Map(),  // apiName -> Map<slotKey, Map<bucket, AugmentBucket>>
    byTrait: new Map(),    // traitName -> Map<activation, Map<bucket, TraitBucket>>
    byComp: new Map(),     // clusterKey -> Map<bucket, CompBucket>
    byCompPair: new Map(), // "a||b" sorted -> { games, aBetter } — for counter edges
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
    items: new Map(),       // apiName -> { games, top4, sumPlacement }
    itemSets: new Map(),    // sortedKey -> { items[], games, top4, sumPlacement }
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
    typicalUnits: new Map(),     // characterId -> count
    typicalAugments: new Map(),  // apiName -> { count, sumPlacement }
    carryItems: new Map(),       // sortedItemTriple -> count (carry's full build)
  };
}

// Cluster a participant's board into a deterministic key:
//   `${primaryActivatedTrait}@${level}_${carryUnit}`
// primaryActivatedTrait = highest-style activated trait, ties broken by
//   tier_current then alphabetical. carryUnit = unit holding the most items
//   (ties broken by highest tier (star level), then highest cost rarity).
// Falls all units have zero items, the highest-cost unit wins. Returns null
// if the board is so sparse that we can't classify (e.g. early surrender).
function classifyComp(participant) {
  const traits = (participant.traits || []).filter(t => (t.style ?? 0) > 0);
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primaryTrait = traits[0];

  const units = participant.units || [];
  if (units.length === 0) return null;
  const ranked = [...units].sort((a, b) => {
    const aItems = (a.itemNames || []).length;
    const bItems = (b.itemNames || []).length;
    if (bItems !== aItems) return bItems - aItems;
    if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
    return (b.rarity ?? 0) - (a.rarity ?? 0);
  });
  const carry = ranked[0];
  if (!carry?.character_id) return null;

  return {
    clusterKey: `${primaryTrait.name}@${primaryTrait.tier_current ?? 0}_${carry.character_id}`,
    primaryTrait: primaryTrait.name,
    primaryTraitLevel: primaryTrait.tier_current ?? 0,
    carryUnit: carry.character_id,
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
  const { tierBucket, currentSet, focusPuuid } = opts;
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

  // We aggregate every participant of the match (not just focusPuuid). The
  // tier-bucket attribution uses the focus player's tier — that's how
  // metatft / tactics.tools attribute games too: a match shows up under the
  // bucket of the player whose lobby it represents.

  // Pre-classify each participant's comp for the comp + pair aggregations.
  const compClass = participants.map(p => classifyComp(p));

  for (let pIdx = 0; pIdx < participants.length; pIdx++) {
    const p = participants[pIdx];
    const compInfo = compClass[pIdx];
    const placement = p.placement ?? 9;
    const top4 = placement <= 4;
    const top1 = placement === 1;

    // Per unit
    for (const u of p.units || []) {
      const cid = u.character_id;
      if (!cid) continue;
      const unitBuckets = getOrCreate(agg.byUnit, cid, () => new Map());
      const ub = getOrCreate(unitBuckets, tierBucket, newUnitBucket);
      ub.games++;
      ub.sumPlacement += placement;
      if (top4) ub.top4++;
      if (top1) ub.top1++;

      const items = Array.isArray(u.itemNames) ? u.itemNames : [];
      // Items: count each occurrence (3 items = 3 increments).
      // top4/sumPlacement are tied to the unit's match, not item slot, so they
      // stay accurate even with the per-occurrence model.
      const seenItem = new Set();
      for (const it of items) {
        if (!it || seenItem.has(it)) continue;   // dedup within one unit slot triple
        seenItem.add(it);
        const ie = getOrCreate(ub.items, it, () => ({ games: 0, top4: 0, sumPlacement: 0 }));
        ie.games++;
        ie.sumPlacement += placement;
        if (top4) ie.top4++;

        // Reverse index: byItem
        const itemBuckets = getOrCreate(agg.byItem, it, () => new Map());
        const ib = getOrCreate(itemBuckets, tierBucket, newItemBucket);
        ib.games++;
        ib.sumPlacement += placement;
        if (top4) ib.top4++;
        const userEntry = getOrCreate(ib.users, cid, () => ({ games: 0, sumPlacement: 0 }));
        userEntry.games++;
        userEntry.sumPlacement += placement;
      }

      // Item set: only count when the unit has 3 finished items
      if (items.length >= 3) {
        const sorted = [...items].sort();
        const key = sorted.join('|');
        const se = getOrCreate(ub.itemSets, key, () => ({ items: sorted, games: 0, top4: 0, sumPlacement: 0 }));
        se.games++;
        se.sumPlacement += placement;
        if (top4) se.top4++;
      }
    }

    // Per augment — slot index = position in the augments array (0,1,2 maps
    // to 2-1, 3-2, 4-2 in standard).
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
      const ab = getOrCreate(slotBuckets, tierBucket, newAugmentBucket);
      ab.games++;
      ab.sumPlacement += placement;
      if (top4) ab.top4++;
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
      const tb = getOrCreate(actBuckets, tierBucket, newTraitBucket);
      tb.games++;
      tb.sumPlacement += placement;
      if (top4) tb.top4++;
    }

    // Per comp cluster
    if (compInfo) {
      const compBuckets = getOrCreate(agg.byComp, compInfo.clusterKey, () => new Map());
      const cb = getOrCreate(compBuckets, tierBucket, newCompBucket);
      cb.games++;
      cb.sumPlacement += placement;
      if (top4) cb.top4++;
      if (top1) cb.top1++;
      // Tag every unit on the board so the frontend can show "typical roster"
      for (const u of p.units || []) {
        if (!u.character_id) continue;
        cb.typicalUnits.set(u.character_id, (cb.typicalUnits.get(u.character_id) || 0) + 1);
      }
      // Augments paired with this comp
      const augs = Array.isArray(p.augments) ? p.augments : [];
      for (const a of augs) {
        if (!a) continue;
        const ae = getOrCreate(cb.typicalAugments, a, () => ({ count: 0, sumPlacement: 0 }));
        ae.count++;
        ae.sumPlacement += placement;
      }
      // Carry's full 3-item build, if any
      if (compInfo.carryItems.length === 3) {
        const ckey = compInfo.carryItems.join('|');
        cb.carryItems.set(ckey, (cb.carryItems.get(ckey) || 0) + 1);
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
  const all = mergeBuckets([...perBucket.values()]);
  const masterPlus = mergeBuckets(APEX_BUCKETS.map(b => perBucket.get(b)).filter(Boolean));
  if (all) perBucket.set('all', all);
  if (masterPlus) perBucket.set('master_plus', masterPlus);
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
          // Map values can be primitives (typicalUnits stores number counts)
          // or sub-objects (item entries store {games, sumPlacement, …}).
          // The number case has to short-circuit — passing a number through
          // mergeBuckets returns {} because Object.entries(<number>) is empty.
          if (typeof vv === 'number') {
            out[k].set(kk, ((out[k].get(kk) || 0)) + vv);
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
  for (const buckets of agg.byComp.values())     rollUp(buckets);

  // 2) Convert Maps to plain objects + Top-N per section.
  const out = {
    matchesAnalyzed: agg.matchesAnalyzed,
    matchesSkipped: agg.matchesSkipped,
    byUnit: {},
    byItem: {},
    byAugment: {},
    byTrait: {},
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
      out.byUnit[cid][bucket] = {
        games: b.games, sumPlacement: b.sumPlacement, top4: b.top4, top1: b.top1,
        topItems, topItemSets,
      };
    }
  }
  for (const [item, buckets] of agg.byItem) {
    out.byItem[item] = {};
    for (const [bucket, b] of buckets) {
      if (b.games < minItemGames) continue;
      const topUsers = [...b.users.entries()]
        .map(([cid, e]) => ({ characterId: cid, games: e.games, sumPlacement: e.sumPlacement }))
        .sort((a, b) => b.games - a.games)
        .slice(0, 5);
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

  // Comp clusters
  for (const [key, buckets] of agg.byComp) {
    const slim = {};
    for (const [bucket, b] of buckets) {
      if (b.games < minCompGames) continue;
      const typicalUnits = [...b.typicalUnits.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 9)
        .map(([cid, count]) => ({ characterId: cid, count }));
      const typicalAugments = [...b.typicalAugments.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 6)
        .map(([apiName, e]) => ({ apiName, count: e.count, sumPlacement: e.sumPlacement }));
      const carryItems = [...b.carryItems.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([k, count]) => ({ items: k.split('|'), count }));
      slim[bucket] = {
        games: b.games, sumPlacement: b.sumPlacement, top4: b.top4, top1: b.top1,
        typicalUnits, typicalAugments, carryItems,
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

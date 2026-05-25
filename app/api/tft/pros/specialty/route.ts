import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabase';

// /api/tft/pros/specialty?puuid=...
//
// Reads this pro's cached matches from tft_player_match_cache, classifies
// every board into the same cluster_key the aggregator uses, then ships:
//   - Pro-Specialty (Sprint 3.2): top comps this pro plays + share/avg place
//   - Pro-Build-Drift (Sprint 3.3): per-carry-unit item-build distribution
// Pure read-side aggregation — no new write path needed.

interface CachedMatch {
  match_id: string;
  set_number: number;
  queue_id: number;
  placement: number;
  level: number;
  last_round: number;
  // Unit shape differs by writer (Hetzner crawler: {characterId, tier, items};
  // legacy Vercel: {character_id, tier, rarity, items}). Neither writes
  // `itemNames`. Accept every key so Hetzner-sourced rows classify too.
  units: { character_id?: string; characterId?: string; tier?: number; rarity?: number; items?: string[]; itemNames?: string[] }[];
  traits: { name?: string; tier_current?: number; style?: number; num_units?: number }[];
}

interface ClassifiedComp {
  clusterKey: string;
  carryUnit: string;
}

// Tank/defensive items (+ trait emblems) don't make a unit a carry. The carry
// is whoever holds the most genuinely offensive items — tanks routinely hold 3
// defensive items (Warmog's/Gargoyle/Bramble…), so plain item-count mis-picks
// them (Illaoi was wrongly flagged carry in every comp; rarity tiebreak is dead
// because the Hetzner cache shape stores no rarity).
const DEFENSIVE_ITEMS = new Set([
  'TFT_Item_WarmogsArmor', 'TFT_Item_DragonsClaw', 'TFT_Item_GargoyleStoneplate',
  'TFT_Item_BrambleVest', 'TFT_Item_SunfireCape', 'TFT_Item_Redemption',
  'TFT_Item_FrozenHeart', 'TFT_Item_IonicSpark', 'TFT_Item_AdaptiveHelm',
  'TFT_Item_ProtectorsVow', 'TFT_Item_SteadfastHeart', 'TFT_Item_Evenshroud',
  'TFT_Item_SpectralGauntlet',
]);
function carryItemCount(u: { items?: string[]; itemNames?: string[] }): number {
  return (u.items ?? u.itemNames ?? []).filter(it => !DEFENSIVE_ITEMS.has(it) && !/Emblem/.test(it)).length;
}

function classifyComp(m: CachedMatch): ClassifiedComp | null {
  const active = (m.traits || []).filter(t => (t.style ?? 0) > 0);
  if (active.length === 0) return null;
  // Prefer real comp traits (≥2 units) as the primary — single-unit personal
  // "UniqueTrait"s (num_units=1, e.g. BlitzcrankUniqueTrait/GravesTrait) otherwise
  // win the style-sort and fragment the same comp into many cluster keys. Fall
  // back to all active traits if none qualify (legacy rows lack num_units).
  const pool = active.filter(t => (t.num_units ?? 0) >= 2);
  const traits = pool.length ? pool : active;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primary = traits[0];
  const units = m.units || [];
  if (units.length === 0) return null;
  // Rank by offensive-item count first (not raw item count) so a 3-tank-item
  // bruiser never outranks the real damage carry; then total items, then star.
  const ranked = [...units].sort((a, b) => {
    const ca = carryItemCount(a), cb = carryItemCount(b);
    if (cb !== ca) return cb - ca;
    const ai = (a.items ?? a.itemNames ?? []).length, bi = (b.items ?? b.itemNames ?? []).length;
    if (bi !== ai) return bi - ai;
    return (b.tier ?? 1) - (a.tier ?? 1);
  });
  const carry = ranked[0];
  const carryId = carry?.characterId ?? carry?.character_id;
  if (!carryId) return null;
  return {
    clusterKey: `${primary.name}@${primary.tier_current ?? 0}_${carryId}`,
    carryUnit: carryId,
  };
}

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  const setParam = searchParams.get('set');
  const setNumber = setParam && Number.isFinite(Number(setParam)) ? Number(setParam) : null;

  let q = supabase
    .from('tft_player_match_cache')
    .select('match_id, set_number, queue_id, placement, level, last_round, units, traits')
    .eq('puuid', puuid)
    .eq('queue_id', STANDARD_RANKED_QUEUE)
    .order('game_datetime', { ascending: false })
    .limit(500);
  if (setNumber != null) q = q.eq('set_number', setNumber);
  const { data: matches, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (matches || []) as CachedMatch[];
  if (rows.length === 0) {
    return NextResponse.json({ puuid, totalGames: 0, classifiedGames: 0, comps: [], unitBuilds: [] });
  }

  const carries = new Map<string, { games: number; sumPlacement: number; top4: number; top1: number; byCluster: Map<string, number> }>();
  const unitBuilds = new Map<string, Map<string, Map<string, { count: number; sumPlacement: number; items: string[] }>>>();

  let totalClassified = 0;
  for (const m of rows) {
    const cls = classifyComp(m);
    if (!cls) continue;
    totalClassified++;
    const place = m.placement || 9;
    const top4 = place <= 4;
    const top1 = place === 1;
    // Group by carry unit, not the full cluster key: the primary trait + tier
    // vary game to game and split the same carry's games into many tiny buckets.
    // Track per-cluster counts to pick a representative comp for the label/link.
    const ce = carries.get(cls.carryUnit) || { games: 0, sumPlacement: 0, top4: 0, top1: 0, byCluster: new Map<string, number>() };
    ce.games++;
    ce.sumPlacement += place;
    if (top4) ce.top4++;
    if (top1) ce.top1++;
    ce.byCluster.set(cls.clusterKey, (ce.byCluster.get(cls.clusterKey) ?? 0) + 1);
    carries.set(cls.carryUnit, ce);

    const carryUnit = (m.units || []).find(u => (u.characterId ?? u.character_id) === cls.carryUnit);
    const carryItems = carryUnit ? (carryUnit.items ?? carryUnit.itemNames) : undefined;
    if (carryUnit && Array.isArray(carryItems) && carryItems.length === 3) {
      const tier = String(carryUnit.tier ?? 1);
      const sorted = [...carryItems].sort();
      const key = sorted.join('|');
      let perUnit = unitBuilds.get(cls.carryUnit);
      if (!perUnit) { perUnit = new Map(); unitBuilds.set(cls.carryUnit, perUnit); }
      let perTier = perUnit.get(tier);
      if (!perTier) { perTier = new Map(); perUnit.set(tier, perTier); }
      const be = perTier.get(key) || { count: 0, sumPlacement: 0, items: sorted };
      be.count++;
      be.sumPlacement += place;
      perTier.set(key, be);
    }
  }

  const totalForShare = totalClassified || 1;
  const compsArr = [...carries.entries()]
    .map(([carryUnit, e]) => {
      // Representative comp = the carry's most-played cluster (drives the
      // trait label + the /tft/comps link on the player page).
      const dominant = [...e.byCluster.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `@0_${carryUnit}`;
      return {
        clusterKey: dominant,
        carryUnit,
        games: e.games,
        share: e.games / totalForShare,
        avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
        top4Rate: e.games > 0 ? e.top4 / e.games : null,
        top1Rate: e.games > 0 ? e.top1 / e.games : null,
      };
    })
    .filter(c => c.games >= 2)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const unitBuildsArr = [...unitBuilds.entries()]
    .map(([unitId, perTier]) => {
      const tiers: Record<string, { items: string[]; count: number; avgPlacement: number | null }[]> = {};
      for (const [tier, builds] of perTier) {
        const arr = [...builds.values()]
          .filter(b => b.count >= 2)   // only recurring builds — a 1-game item set isn't a "signature" build
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map(b => ({ items: b.items, count: b.count, avgPlacement: b.count > 0 ? b.sumPlacement / b.count : null }));
        if (arr.length) tiers[tier] = arr;
      }
      // Header = total games this unit was the carry (matches the comps section),
      // not a build-count sum.
      return { unitId, games: carries.get(unitId)?.games ?? 0, tiers };
    })
    .filter(u => u.games >= 3 && Object.keys(u.tiers).length > 0)
    .sort((a, b) => b.games - a.games)
    .slice(0, 5);

  return NextResponse.json({
    puuid,
    totalGames: rows.length,
    classifiedGames: totalClassified,
    comps: compsArr,
    unitBuilds: unitBuildsArr,
  });
}

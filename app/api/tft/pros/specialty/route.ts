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
  units: { character_id?: string; tier?: number; rarity?: number; itemNames?: string[] }[];
  traits: { name?: string; tier_current?: number; style?: number }[];
}

interface ClassifiedComp {
  clusterKey: string;
  carryUnit: string;
}

function classifyComp(m: CachedMatch): ClassifiedComp | null {
  const traits = (m.traits || []).filter(t => (t.style ?? 0) > 0);
  if (traits.length === 0) return null;
  traits.sort((a, b) => {
    if ((b.style ?? 0) !== (a.style ?? 0)) return (b.style ?? 0) - (a.style ?? 0);
    if ((b.tier_current ?? 0) !== (a.tier_current ?? 0)) return (b.tier_current ?? 0) - (a.tier_current ?? 0);
    return (a.name || '').localeCompare(b.name || '');
  });
  const primary = traits[0];
  const units = m.units || [];
  if (units.length === 0) return null;
  const ranked = [...units].sort((a, b) => {
    const ai = (a.itemNames || []).length;
    const bi = (b.itemNames || []).length;
    if (bi !== ai) return bi - ai;
    if ((b.tier ?? 1) !== (a.tier ?? 1)) return (b.tier ?? 1) - (a.tier ?? 1);
    return (b.rarity ?? 0) - (a.rarity ?? 0);
  });
  const carry = ranked[0];
  if (!carry?.character_id) return null;
  return {
    clusterKey: `${primary.name}@${primary.tier_current ?? 0}_${carry.character_id}`,
    carryUnit: carry.character_id,
  };
}

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  const setParam = searchParams.get('set');
  const setNumber = setParam ? Number(setParam) : null;

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

  const comps = new Map<string, { games: number; sumPlacement: number; top4: number; top1: number; carryUnit: string }>();
  const unitBuilds = new Map<string, Map<string, Map<string, { count: number; sumPlacement: number; items: string[] }>>>();

  let totalClassified = 0;
  for (const m of rows) {
    const cls = classifyComp(m);
    if (!cls) continue;
    totalClassified++;
    const place = m.placement || 9;
    const top4 = place <= 4;
    const top1 = place === 1;
    const ce = comps.get(cls.clusterKey) || { games: 0, sumPlacement: 0, top4: 0, top1: 0, carryUnit: cls.carryUnit };
    ce.games++;
    ce.sumPlacement += place;
    if (top4) ce.top4++;
    if (top1) ce.top1++;
    comps.set(cls.clusterKey, ce);

    const carryUnit = (m.units || []).find(u => u.character_id === cls.carryUnit);
    if (carryUnit && Array.isArray(carryUnit.itemNames) && carryUnit.itemNames.length === 3) {
      const tier = String(carryUnit.tier ?? 1);
      const sorted = [...carryUnit.itemNames].sort();
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
  const compsArr = [...comps.entries()]
    .map(([clusterKey, e]) => ({
      clusterKey,
      carryUnit: e.carryUnit,
      games: e.games,
      share: e.games / totalForShare,
      avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
      top4Rate: e.games > 0 ? e.top4 / e.games : null,
      top1Rate: e.games > 0 ? e.top1 / e.games : null,
    }))
    .filter(c => c.games >= 2)
    .sort((a, b) => b.games - a.games)
    .slice(0, 8);

  const unitBuildsArr = [...unitBuilds.entries()]
    .map(([unitId, perTier]) => {
      const tiers: Record<string, { items: string[]; count: number; avgPlacement: number | null }[]> = {};
      let unitTotal = 0;
      for (const [tier, builds] of perTier) {
        const arr = [...builds.values()]
          .sort((a, b) => b.count - a.count)
          .slice(0, 3)
          .map(b => ({ items: b.items, count: b.count, avgPlacement: b.count > 0 ? b.sumPlacement / b.count : null }));
        tiers[tier] = arr;
        for (const a of arr) unitTotal += a.count;
      }
      return { unitId, total: unitTotal, tiers };
    })
    .filter(u => u.total >= 3)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return NextResponse.json({
    puuid,
    totalGames: rows.length,
    classifiedGames: totalClassified,
    comps: compsArr,
    unitBuilds: unitBuildsArr,
  });
}

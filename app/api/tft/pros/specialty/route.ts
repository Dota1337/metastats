import { NextRequest, NextResponse } from 'next/server';
import { fetchHetznerPlayerMatches } from '../../../../lib/tft-hetzner-matches';
import { classifyComp } from '../../../../lib/tft-classify-comp';

// /api/tft/pros/specialty?puuid=...
//
// Reads this pro's cached matches from tft_player_match_cache, klassifiziert
// jedes Board ueber die unifizierte Klassifikations-Library
// (app/lib/tft-classify-comp.ts == scripts/lib/tft-classify-comp.mjs), dann:
//   - Pro-Specialty: top comps this pro plays + share/avg place
//   - Pro-Build-Drift: per-carry-unit item-build distribution
//
// Vor 2026-06-21: route hatte eigene classifyComp die anders war als die
// Aggregator-Klassifikation → Top-Cluster `BlitzcrankUniqueTrait@1_...`
// (Single-Unit-Fragment) statt echter Comps. Reference:
// reference_tft_classification_bridge.md.

interface CachedMatch {
  matchId: string;
  setNumber: number;
  queueId: number;
  placement: number;
  level: number;
  lastRound: number;
  augments?: string[];
  units: { character_id?: string; characterId?: string; tier?: number; rarity?: number; items?: string[]; itemNames?: string[] }[];
  traits: { name?: string; tier_current?: number; style?: number; num_units?: number }[];
}

const STANDARD_RANKED_QUEUE = 1100;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });
  const setParam = searchParams.get('set');
  const setNumber = setParam && Number.isFinite(Number(setParam)) ? Number(setParam) : null;

  // Match cache lives on Hetzner — route through refresh-api.
  let rows: CachedMatch[] = [];
  try {
    const matches = await fetchHetznerPlayerMatches({
      puuids: [puuid],
      setNumber: setNumber ?? undefined,
      queueId: STANDARD_RANKED_QUEUE,
      limitPerPuuid: 500,
    });
    // HetznerMatchRow is a structural superset of CachedMatch — both are
    // camelCase, so the rows just flow through. The cast is intentional and
    // type-safe (we only read fields declared on CachedMatch).
    rows = matches as CachedMatch[];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'hetzner_unreachable';
    return NextResponse.json({ error: message }, { status: 502 });
  }
  if (rows.length === 0) {
    return NextResponse.json({ puuid, totalGames: 0, classifiedGames: 0, comps: [], unitBuilds: [] });
  }

  const carries = new Map<string, { games: number; sumPlacement: number; top4: number; top1: number; byCluster: Map<string, number> }>();
  const unitBuilds = new Map<string, Map<string, Map<string, { count: number; sumPlacement: number; items: string[] }>>>();

  let totalClassified = 0;
  for (const m of rows) {
    const cls = classifyComp({
      traits: m.traits,
      units: m.units,
      augments: m.augments,
      level: m.level,
    }, { withAugmentSuffix: false, currentSet: setNumber ?? undefined });
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

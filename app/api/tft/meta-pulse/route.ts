import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
} from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';

// W5: Meta-Pulse — die „ich öffne metastats vor jeder Ranked-Session"-Page.
// Aggregiert die wichtigsten Pro-Signale in einer Server-Action:
//   • Velocity-Trending — was bewegt sich am stärksten in den letzten 3 Tagen
//   • Region-Divergenz  — was spielt KR vor EU
//   • Patch-Movers      — was hat der aktuelle Patch bewegt
// Eine Roundtrip statt 4 — die UI rendert alles ohne weitere Cascade.
//
// 1h-TTL (statt 6h wie sonst), damit die Page tatsächlich „aktuell" wirkt.

interface VelocityRow {
  cluster_key: string;
  games_now: number;
  games_prev: number;
  sum_placement_now: number;
  sum_placement_prev: number;
}

interface RegionRow {
  cluster_key: string;
  games_kr: number;
  games_eu: number;
  avg_place_kr: number | null;
  avg_place_eu: number | null;
  pickrate_kr: number | null;
  pickrate_eu: number | null;
}

interface CompStatsRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

interface PatchDiffRow {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters = await resolveFilters(searchParams);
  const buckets = filters.buckets;

  try {
    const patches = await getAvailablePatches();
    const currentPatch = patches[0]?.patch ?? null;
    const previousPatch = patches[1]?.patch ?? null;
    const setNumber = patches[0]?.set_number ?? 17;

    // Fan out: all four queries in parallel. Velocity + region-divergence
    // are single-scan FILTER aggregates (cheap on Nano). Patch-diff is two
    // sequential RPCs but kicked off in parallel with the rest.
    const [velocityRows, regionRows, currentTopComps, prevTopComps] = await Promise.all([
      callRpc<VelocityRow[]>('get_tft_comp_velocity', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_set: setNumber,
        p_patch: currentPatch,
        p_days: 3,
        p_shift_days: 3,
        p_min_games: 100,
      }).catch(() => [] as VelocityRow[]),
      callRpc<RegionRow[]>('get_tft_region_divergence', {
        p_buckets: buckets,
        p_set: setNumber,
        p_patch: currentPatch,
        p_days: 7,
        p_min_games: 80,
      }).catch(() => [] as RegionRow[]),
      previousPatch ? callRpc<CompStatsRow[]>('get_tft_comp_stats_list', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_days: 30,
        p_patch: currentPatch,
        p_set: setNumber,
        p_min_games: 80,
      }).catch(() => [] as CompStatsRow[]) : Promise.resolve([] as CompStatsRow[]),
      previousPatch ? callRpc<CompStatsRow[]>('get_tft_comp_stats_list', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_days: 30,
        p_patch: previousPatch,
        p_set: setNumber,
        p_min_games: 80,
      }).catch(() => [] as CompStatsRow[]) : Promise.resolve([] as CompStatsRow[]),
    ]);

    // Velocity → Top Rising (most-improved avg-place over the comparison
    // window, with both windows above sample-size threshold).
    const rising = velocityRows
      .filter(v => v.games_now >= 30 && v.games_prev >= 30)
      .map(v => ({
        clusterKey: v.cluster_key,
        deltaAvgPlace: v.sum_placement_now / v.games_now - v.sum_placement_prev / v.games_prev,
        avgPlaceNow: v.sum_placement_now / v.games_now,
        gamesNow: v.games_now,
      }))
      .sort((a, b) => a.deltaAvgPlace - b.deltaAvgPlace)
      .slice(0, 5);

    // Region divergence → KR-ahead (KR plays more AND better than EU).
    const krAhead = regionRows
      .filter(r => r.games_kr >= 30 && r.games_eu >= 30
        && r.pickrate_kr != null && r.pickrate_eu != null
        && r.avg_place_kr != null && r.avg_place_eu != null)
      .map(r => ({
        clusterKey: r.cluster_key,
        avgPlaceKr: r.avg_place_kr,
        avgPlaceEu: r.avg_place_eu,
        pickrateKr: r.pickrate_kr,
        pickrateEu: r.pickrate_eu,
        krAheadScore: (r.pickrate_kr! - r.pickrate_eu!) * 1000 + (r.avg_place_eu! - r.avg_place_kr!),
      }))
      .filter(r => r.krAheadScore > 0)
      .sort((a, b) => b.krAheadScore - a.krAheadScore)
      .slice(0, 5);

    // Patch movers — compute simple comp diff inline from the two RPC outputs.
    const prevMap = new Map(prevTopComps.map(r => [r.cluster_key, r]));
    const patchDiffs: PatchDiffRow[] = [];
    for (const c of currentTopComps) {
      const p = prevMap.get(c.cluster_key);
      if (!p || c.games < 80 || p.games < 80) continue;
      const cParts = Number(c.participants) || 1;
      const pParts = Number(p.participants) || 1;
      patchDiffs.push({
        key: c.cluster_key,
        currentGames: Number(c.games),
        previousGames: Number(p.games),
        currentAvgPlacement: Number(c.sum_placement) / Number(c.games),
        previousAvgPlacement: Number(p.sum_placement) / Number(p.games),
        deltaAvgPlacement: Number(c.sum_placement) / Number(c.games) - Number(p.sum_placement) / Number(p.games),
        currentPickRate: Number(c.games) / cParts,
        previousPickRate: Number(p.games) / pParts,
        deltaPickRate: Number(c.games) / cParts - Number(p.games) / pParts,
        currentTop4Rate: Number(c.top4) / Number(c.games),
        previousTop4Rate: Number(p.top4) / Number(p.games),
        deltaTop4Rate: Number(c.top4) / Number(c.games) - Number(p.top4) / Number(p.games),
      });
    }
    const patchWinners = [...patchDiffs].sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, 5);
    const patchLosers = [...patchDiffs].sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, 5);

    return cachedJson({
      hasData: true,
      currentPatch,
      previousPatch,
      bucket: filters.bucketLabel,
      rising,
      krAhead,
      patchWinners,
      patchLosers,
      counts: {
        rising: rising.length,
        krAhead: krAhead.length,
        patchSampled: patchDiffs.length,
      },
    }, {
      // Shorter TTL than the rest of the stats APIs because Meta-Pulse is the
      // "what's hot right now" page — 6h staleness would defeat the purpose.
      cache: 'public, s-maxage=3600, stale-while-revalidate=21600',
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, error: e.message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
} from '../../../lib/tft-supabase-reader';
import { cachedJson, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { CURRENT_SET } from '../../../lib/current-set';

// Fuenf Datenbank-Abfragen parallel (seit dem Vorpatch-Rueckfall fuer KR voraus).
export const maxDuration = 60;

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

// Allowed velocity shifts mirror StatsFilterBar; anything else collapses to
// the default so a stale URL can't produce a shape the SQL never tested.
const VELOCITY_SHIFTS = new Set([1, 2, 3, 7, 14]);
const DEFAULT_VELOCITY_SHIFT = 3;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filters = await resolveFilters(searchParams);
  const buckets = filters.buckets;

  // Δ-window: how far back the comparison reaches. User-controlled via the
  // same `velocity` param the Comps page uses, so a deep-link from one to
  // the other carries the selection over. 0 (=off) still produces the
  // "rising" list using the default shift, since the page IS the velocity
  // view — there's no "off" state here.
  const velocityRaw = parseInt(searchParams.get('velocity') || '0', 10);
  const velocityShift = VELOCITY_SHIFTS.has(velocityRaw) ? velocityRaw : DEFAULT_VELOCITY_SHIFT;

  try {
    const patches = await getAvailablePatches();
    // Plan E: redirect ?patch=current|previous auf konkreten Patch.
    // Bei meta-pulse ignoriert der Backend-Code den patch-Param eh (rendert
    // immer latestPatch), aber HTTP-Cache-Key wird patch-spezifisch — bei
    // Patch-Wechsel kein stale Cache mehr. Kein Plan-B-Boost, weil die Route
    // schon explizit 1h-TTL gewählt hat (kürzer als alle anderen Stats-APIs).
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    // Gewaehlter Patch (2026-09-13): ?patch=current → neuester, ein konkreter
    // Patch aus der Liste → dieser (?patch=previous kommt oben schon als
    // Redirect auf den konkreten Patch an). Unbekannte Werte → neuester.
    // Verglichen wird immer mit dem Patch direkt davor in der Liste;
    // currentPatch/previousPatch in der Antwort meinen genau dieses Paar.
    const patchParam = searchParams.get('patch') || 'current';
    const selIdx = Math.max(0, patchParam === 'current' || patchParam === 'any'
      ? 0 : patches.findIndex(p => p.patch === patchParam));
    const sel = patches[selIdx];
    const cmp = patches[selIdx + 1];
    const currentPatch = sel?.patch ?? null;
    const setNumber = sel?.set_number ?? CURRENT_SET;
    // Vorpatch aus einem anderen Set: kein sinnvoller Vergleich → Patch-Kaesten leer.
    const previousPatch = cmp && cmp.set_number === setNumber ? cmp.patch : null;

    // Rising-Vergleichsfenster an das Patch-Alter anpassen. Die Velocity-RPC
    // filtert beide Fenster auf denselben Patch — bei einem 1-Tage-Patch waere
    // das Vergleichsfenster leer und die Liste immer leer.
    //   • Patch ≥2 Tage: im Patch bleiben, Fenster schrumpfen, ohne Ueberlappung.
    //   • Patch 1 Tag: letzter Patch-Tag gegen letzten Tag des Vorpatches.
    const DAY_MS = 86_400_000;
    const dayNum = (d?: string | null) => (d ? Math.floor(Date.parse(d) / DAY_MS) : NaN);
    const todayNum = Math.floor(Date.now() / DAY_MS);
    const curFirst = dayNum(sel?.first_day);
    const curLast = dayNum(sel?.last_day);
    const prevLast = dayNum(cmp?.last_day);
    // Die Velocity-RPC ankert an current_date - offset: fuer einen aelteren
    // Patch an dessen letztem Tag.
    const anchorOffsetDays = selIdx === 0 || !Number.isFinite(curLast)
      ? filters.anchorOffsetDays
      : Math.max(0, todayNum - curLast);
    // Diff-Fenster (RPC zaehlt ab current_date) muss bis zum ersten Tag des
    // Vergleichspatches reichen; der Patch-Filter schneidet den Rest ab.
    const cmpFirst = dayNum(cmp?.first_day);
    const diffDays = Number.isFinite(cmpFirst) ? Math.min(90, Math.max(1, todayNum - cmpFirst + 1)) : 30;
    const patchDays = Number.isFinite(curFirst) && Number.isFinite(curLast) ? curLast - curFirst + 1 : 0;
    let velocityMode: 'patch' | 'crossPatch' = 'patch';
    let effShift = velocityShift;
    let effDays = filters.requestedDays;
    let velocityPatch: string | null = currentPatch;
    if (patchDays >= 2) {
      effShift = Math.min(velocityShift, patchDays - 1);
      effDays = Math.max(1, Math.min(filters.requestedDays, effShift, patchDays - effShift));
    } else if (previousPatch
      && Number.isFinite(curLast) && Number.isFinite(prevLast) && curLast > prevLast) {
      velocityMode = 'crossPatch';
      effShift = curLast - prevLast;
      effDays = 1;
      velocityPatch = null;
    }

    // Fan out: all four queries in parallel. Velocity + region-divergence
    // are single-scan FILTER aggregates (cheap on Nano). Patch-diff is two
    // sequential RPCs but kicked off in parallel with the rest.
    // KR voraus: Am ersten Patch-Tag hat der neue Patch oft zu wenig KR-Spiele.
    // Deshalb den Vorpatch gleich mit abfragen (parallel, nur im selben Set)
    // und unten entscheiden, welcher genutzt wird.
    const divergenceArgs = {
      p_buckets: buckets,
      p_set: setNumber,
      // Follows the user-selected window. For very small windows (<3d) we bump
      // to 3 to keep the per-region sample meaningful since each region needs
      // ≥80 games per cluster. Das Fenster zaehlt seit 0070 ab dem juengsten
      // Datentag, nicht ab heute.
      p_days: Math.max(3, filters.requestedDays),
      p_min_games: 80,
    };
    const prevSameSet = !!previousPatch;
    const [velocityRows, regionRows, currentTopComps, prevTopComps, prevRegionRows] = await Promise.all([
      callRpc<VelocityRow[]>('get_tft_comp_velocity', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_set: setNumber,
        // null nur im crossPatch-Modus: dann liegen die beiden Tage in
        // verschiedenen Patches (gemessen: Tage sind je Patch sauber getrennt).
        p_patch: velocityPatch,
        p_days: effDays,
        p_shift_days: effShift,
        p_anchor_offset_days: anchorOffsetDays,
        p_min_games: 100,
      }, 20000).catch(() => [] as VelocityRow[]),
      callRpc<RegionRow[]>('get_tft_region_divergence', {
        ...divergenceArgs,
        p_patch: currentPatch,
      }, 20000).catch(() => [] as RegionRow[]),
      // Super-lean diff RPC (migration 0035) — scalar-only, drops the 10 MB
      // jsonb_agg payload the previous list-RPC carried for nothing here.
      previousPatch ? callRpc<CompStatsRow[]>('get_tft_comp_stats_for_diff', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_days: diffDays,
        p_patch: currentPatch,
        p_set: setNumber,
        p_min_games: 80,
      }, 20000).catch(() => [] as CompStatsRow[]) : Promise.resolve([] as CompStatsRow[]),
      previousPatch ? callRpc<CompStatsRow[]>('get_tft_comp_stats_for_diff', {
        p_regions: filters.regions,
        p_buckets: buckets,
        p_days: diffDays,
        p_patch: previousPatch,
        p_set: setNumber,
        p_min_games: 80,
      }, 20000).catch(() => [] as CompStatsRow[]) : Promise.resolve([] as CompStatsRow[]),
      prevSameSet ? callRpc<RegionRow[]>('get_tft_region_divergence', {
        ...divergenceArgs,
        p_patch: previousPatch,
      }, 20000).catch(() => [] as RegionRow[]) : Promise.resolve([] as RegionRow[]),
    ]);

    // Aktueller Patch, sobald er mindestens 10 Comps mit je >=80 KR-Spielen
    // hat; sonst der Vorpatch (User-Entscheid C2, 2026-09-13).
    const useCurrent = regionRows.filter(r => r.games_kr >= 80).length >= 10 || prevRegionRows.length === 0;
    const krRows = useCurrent ? regionRows : prevRegionRows;
    const krAheadPatch = useCurrent ? currentPatch : previousPatch;

    // Velocity → Top Rising (most-improved avg-place over the comparison
    // window, with both windows above sample-size threshold).
    const rising = velocityRows
      // 100 pro Fenster: bei 30 lag der Zufallsfehler eines Δ bei ~0,6 Plaetzen.
      .filter(v => v.games_now >= 100 && v.games_prev >= 100)
      .map(v => ({
        clusterKey: v.cluster_key,
        deltaAvgPlace: v.sum_placement_now / v.games_now - v.sum_placement_prev / v.games_prev,
        avgPlaceNow: v.sum_placement_now / v.games_now,
        gamesNow: v.games_now,
      }))
      .filter(v => v.deltaAvgPlace < 0)
      .sort((a, b) => a.deltaAvgPlace - b.deltaAvgPlace)
      .slice(0, 5);

    // Region divergence → KR-ahead (KR plays more AND better than EU).
    const krAhead = krRows
      .filter(r => r.games_kr >= 30 && r.games_eu >= 30
        && r.pickrate_kr != null && r.pickrate_eu != null
        && r.avg_place_kr != null && r.avg_place_eu != null
        // KR muss spuerbar besser platzieren, nicht nur oefter spielen.
        && r.avg_place_eu - r.avg_place_kr >= 0.1)
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
    const patchWinners = patchDiffs.filter(d => d.deltaAvgPlacement < 0)
      .sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, 5);
    const patchLosers = patchDiffs.filter(d => d.deltaAvgPlacement > 0)
      .sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, 5);

    return cachedJson({
      hasData: true,
      currentPatch,
      previousPatch,
      // Gewaehlter Patch und sein Vergleichspatch (gleich currentPatch/previousPatch).
      selectedPatch: currentPatch,
      comparePatch: previousPatch,
      bucket: filters.bucketLabel,
      region: filters.regionLabel,
      requestedDays: filters.requestedDays,
      // Tatsaechlich genutzter Abstand (kann kleiner sein als gewaehlt).
      velocityShift: effShift,
      velocityDays: effDays,
      velocityMode,
      patches,
      rising,
      krAhead,
      // Patch, aus dem die KR-voraus-Liste stammt (aktueller oder Vorpatch).
      krAheadPatch,
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

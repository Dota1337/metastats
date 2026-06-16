import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket, bucketParticipants } from '../../../lib/tft-stats-loader';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { isExcludedUnit, isExcludedItem, setContainsExcludedItem } from '../../../lib/tft-excluded';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { lookupSnapshot } from '../../../lib/snapshot-lookup';

// /api/tft/units
//   Filter params (Supabase-backed):
//     region  = all | west | asia | <single, e.g. 'euw1'>
//     bucket  = all | master_plus | <single, e.g. 'diamond'>
//     days    = 1..7   (default 3)
//     patch   = current | previous | <literal>
//     set     = <int>  (optional)
//
//   id=… still routes through the legacy JSON loader for the unit-detail
//   view, which depends on byUnit[*].topItems/topItemSets — fields the
//   per-day Supabase rows don't carry. Once we add a tft_daily_unit_items
//   reverse-index this will move over too; for now the detail page still
//   shows the most-recent crawl.

interface UnitListRow {
  character_id: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

interface UnitVelocityRow {
  character_id: string;
  games_now: number;
  games_prev: number;
  sum_placement_now: number;
  sum_placement_prev: number;
  top4_now: number;
  top4_prev: number;
  top1_now: number;
  top1_prev: number;
  participants_now: number;
  participants_prev: number;
}

// Same Δ-threshold used across comp/item velocity — below ~30 games per
// window the Δs are too noisy to render with intent; the UI shows "—" instead.
const VELOCITY_MIN_GAMES = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Detail view stays on the legacy JSON loader — see top of file.
  if (id) {
    if (isExcludedUnit(id)) {
      return NextResponse.json({ region: 'euw1', bucket: 'all', hasData: true, unit: null });
    }
    const region = (searchParams.get('region') || 'euw1').toLowerCase();
    const bucket = normalizeBucket(searchParams.get('bucket'));
    const stats = loadTftStats(region);
    if (!stats) return NextResponse.json({ region, bucket, hasData: false, unit: null });
    const buckets = stats.byUnit?.[id];
    if (!buckets) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const data = buckets[bucket] || buckets.all || null;
    if (!data) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const avgPlacement = data.games > 0 ? data.sumPlacement / data.games : null;
    return cachedJson({
      region, bucket,
      set: stats.set, patch: stats.patch,
      hasData: true,
      unit: {
        characterId: id,
        games: data.games,
        avgPlacement,
        top4Rate: data.games > 0 ? data.top4 / data.games : null,
        top1Rate: data.games > 0 ? data.top1 / data.games : null,
        // Thief's Gloves & Co. raus — singulär aus den Item-Listen, als
        // ganzes Set aus den Item-Set-Listen. "Top Item-Builds" sollen die
        // bewussten Carry-Builds zeigen, nicht Random-Pulls.
        topItems: (data.topItems || [])
          .filter((it: any) => !isExcludedItem(it.item))
          .map((it: any) => ({
            item: it.item,
            games: it.games,
            avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
            top4Rate: it.games > 0 ? it.top4 / it.games : null,
          })),
        topItemSets: (data.topItemSets || [])
          .filter((s: any) => !setContainsExcludedItem(s.items))
          .map((s: any) => ({
            items: s.items,
            games: s.games,
            avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
            top4Rate: s.games > 0 ? s.top4 / s.games : null,
          })),
        topItemsByTier: data.topItemsByTier
          ? Object.fromEntries(
              Object.entries(data.topItemsByTier).map(([tier, arr]: [string, any]) => [
                tier,
                (arr || [])
                  .filter((it: any) => !isExcludedItem(it.item))
                  .map((it: any) => ({
                    item: it.item,
                    games: it.games,
                    avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
                    top4Rate: it.games > 0 ? it.top4 / it.games : null,
                  })),
              ])
            )
          : null,
        topItemSetsByTier: data.topItemSetsByTier
          ? Object.fromEntries(
              Object.entries(data.topItemSetsByTier).map(([tier, arr]: [string, any]) => [
                tier,
                (arr || [])
                  .filter((s: any) => !setContainsExcludedItem(s.items))
                  .map((s: any) => ({
                    items: s.items,
                    games: s.games,
                    avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
                    top4Rate: s.games > 0 ? s.top4 / s.games : null,
                  })),
              ])
            )
          : null,
        // Damage-Atlas: { tier: { itemCount: { games, p50, p75, p95, p99, max } } }
        damageByTier: data.damageByTier || null,
        // Carry-Performance: { tier: { itemCount: { games, avgPlacement, top4Rate, top1Rate } } }
        // — avg placement + top4 when THIS unit was the carry (replaces the
        // player-HP damage atlas with a real carry-strength signal).
        carryPlacementByTier: data.carryPlacementByTier
          ? Object.fromEntries(
              Object.entries(data.carryPlacementByTier).map(([tier, m]: [string, any]) => [
                tier,
                Object.fromEntries(
                  Object.entries(m || {}).map(([ic, e]: [string, any]) => [
                    ic,
                    {
                      games: e.games,
                      avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
                      top4Rate: e.games > 0 ? e.top4 / e.games : null,
                      top1Rate: e.games > 0 ? e.top1 / e.games : null,
                    },
                  ])
                ),
              ])
            )
          : null,
        // Item-Slot-Build-Order: { tier: { slotIdx: [{item, count}, ...] } }
        // Auch hier ThG raus — wenn ein Slot häufig Thief's Gloves zeigt, ist
        // das eine Augment-Wahl, kein Build-Pfad.
        itemSlotOrderByTier: data.itemSlotOrderByTier
          ? Object.fromEntries(
              Object.entries(data.itemSlotOrderByTier).map(([tier, slots]: [string, any]) => [
                tier,
                Object.fromEntries(
                  Object.entries(slots || {}).map(([slotIdx, entries]: [string, any]) => [
                    slotIdx,
                    (entries || []).filter((e: any) => !isExcludedItem(e.item)),
                  ])
                ),
              ])
            )
          : null,
      },
    });
  }

  // Stats list — Supabase RPC with filter expansion.
  try {
    // Plan E + B (siehe comps/route.ts für Begründung): patches vorne, Alias
    // redirecten, Cache-Control patch-frische-abhängig wählen.
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);

    // Optional Δ-velocity layer (parallel to comps/items): when ?velocity=N is
    // present the route fires a second RPC and merges per-character Δs into
    // each row. Uses the raw user-requested window + anchor-offset, same
    // semantics as get_tft_comp_velocity (see 0038/0039).
    const velocityShift = Math.max(0, parseInt(searchParams.get('velocity') || '0', 10));
    const wantVelocity = velocityShift > 0;

    // Snapshot-Pfad: gleiches Pattern wie /api/tft/comps. Wenn die Permutation
    // im Bundle steckt, sparen wir den RPC-Roundtrip. Velocity-Overlays werden
    // nicht vorgerendert → live RPC.
    if (!wantVelocity) {
      const hit = await lookupSnapshot('units', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
      });
      if (hit) {
        const resp = cachedJson(hit.payload, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    const [rows, velocityRows] = await Promise.all([
      callRpc<UnitListRow[]>('get_tft_unit_stats', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patchFilter,
        p_set: filters.setNumber,
      }),
      wantVelocity
        ? callRpc<UnitVelocityRow[]>('get_tft_unit_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patchFilter,
            p_days: filters.requestedDays,
            p_shift_days: velocityShift,
            p_anchor_offset_days: filters.anchorOffsetDays,
            p_min_games: 30,
          }).catch(() => [] as UnitVelocityRow[])
        : Promise.resolve([] as UnitVelocityRow[]),
    ]);

    const participants = rows[0]?.participants || 0;
    const velocityByCid = new Map<string, UnitVelocityRow>();
    for (const v of velocityRows) velocityByCid.set(v.character_id, v);

    const units = rows
      .filter(r => !isExcludedUnit(r.character_id))
      .map(r => {
        const base = {
          characterId: r.character_id,
          games: Number(r.games),
          avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
          top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
          top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
          pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
        };
        if (!wantVelocity) return base;
        const v = velocityByCid.get(r.character_id);
        if (!v) return base;
        const gNow = Number(v.games_now);
        const gPrev = Number(v.games_prev);
        const pNow = Number(v.participants_now);
        const pPrev = Number(v.participants_prev);
        const avgNow = gNow > 0 ? Number(v.sum_placement_now) / gNow : null;
        const avgPrev = gPrev > 0 ? Number(v.sum_placement_prev) / gPrev : null;
        const top4Now = gNow > 0 ? Number(v.top4_now) / gNow : null;
        const top4Prev = gPrev > 0 ? Number(v.top4_prev) / gPrev : null;
        const pickNow = pNow > 0 ? gNow / pNow : null;
        const pickPrev = pPrev > 0 ? gPrev / pPrev : null;
        const canDelta = gPrev >= VELOCITY_MIN_GAMES && gNow >= VELOCITY_MIN_GAMES;
        return {
          ...base,
          velocity: {
            gamesNow: gNow,
            gamesPrev: gPrev,
            avgPlaceNow: avgNow,
            avgPlacePrev: avgPrev,
            deltaAvgPlace: canDelta && avgNow != null && avgPrev != null ? avgNow - avgPrev : null,
            top4RateNow: top4Now,
            top4RatePrev: top4Prev,
            deltaTop4Rate: canDelta && top4Now != null && top4Prev != null ? top4Now - top4Prev : null,
            pickRateNow: pickNow,
            pickRatePrev: pickPrev,
            deltaPickRate: canDelta && pickNow != null && pickPrev != null ? pickNow - pickPrev : null,
            isNew: gPrev < 5 && gNow >= VELOCITY_MIN_GAMES,
          },
        };
      });
    units.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    return cachedJson({
      hasData: units.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        requestedDays: filters.requestedDays,
        patch: filters.patch,
        patchFilter: filters.patchFilter,
        patchStartDay: filters.patchStartDay,
        set: filters.setNumber,
        velocityShift: wantVelocity ? velocityShift : null,
        anchorOffsetDays: filters.anchorOffsetDays,
      },
      patches,
      units,
    }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, units: [], error: e.message }, { status: 502 });
  }
}

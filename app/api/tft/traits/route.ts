import { NextRequest, NextResponse } from 'next/server';
import { parseVelocity } from '../../../lib/query-params';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { lookupSnapshot, isSnapshotPublisher } from '../../../lib/snapshot-lookup';

// C3 (2026-07-04): raised so the snapshot publisher's per-permutation fetch of a
// heavy detoast perm doesn't 504 on the Vercel default (~15s) and leave a gap.
export const maxDuration = 60;

interface TraitRow {
  name: string;
  activation: number;
  games: number;
  sum_placement: number;
  top4: number;
  participants: number;
}

interface TraitVelocityRow {
  name: string;
  games_now: number;
  games_prev: number;
  sum_placement_now: number;
  sum_placement_prev: number;
  top4_now: number;
  top4_prev: number;
  participants_now: number;
  participants_prev: number;
}

const VELOCITY_MIN_GAMES = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    // Plan E + B (siehe comps/route.ts).
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);

    // Δ-velocity (W1-A pattern, anchor-aware via 0039). Trait velocity is rolled
    // up across activation levels — the UI also groups per display name, so
    // per-activation Δs would only confuse the comparison.
    const velocityShift = parseVelocity(searchParams.get('velocity'));
    const wantVelocity = velocityShift > 0;

    // Snapshot-Pfad — siehe /api/tft/comps.
    if (!wantVelocity) {
      const hit = await lookupSnapshot('traits', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
        setNumber: filters.setNumber,
        skip: isSnapshotPublisher(request),
      });
      // Guard 2026-06-21: kein leeres Snapshot-Bundle ausliefern.
      const payload = hit?.payload as { hasData?: boolean; traits?: unknown[] } | undefined;
      if (hit && payload?.hasData && Array.isArray(payload.traits) && payload.traits.length > 0) {
        const resp = cachedJson(hit.payload, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    const [rows, velocityRows] = await Promise.all([
      callRpc<TraitRow[]>('get_tft_trait_stats', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patchFilter,
        p_set: filters.setNumber,
      }),
      wantVelocity
        ? callRpc<TraitVelocityRow[]>('get_tft_trait_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patchFilter,
            p_days: filters.requestedDays,
            p_shift_days: velocityShift,
            p_anchor_offset_days: filters.anchorOffsetDays,
            p_min_games: 30,
          }).catch(() => [] as TraitVelocityRow[])
        : Promise.resolve([] as TraitVelocityRow[]),
    ]);

    const denom = rows[0]?.participants || 0;
    const velocityByName = new Map<string, TraitVelocityRow>();
    for (const v of velocityRows) velocityByName.set(v.name, v);

    const traits = rows.map(r => {
      const base = {
        name: r.name,
        activation: Number(r.activation),
        games: Number(r.games),
        avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
        top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
        pickRate: denom > 0 ? Number(r.games) / Number(denom) : null,
      };
      if (!wantVelocity) return base;
      const v = velocityByName.get(r.name);
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
    traits.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    return cachedJson({
      hasData: traits.length > 0,
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
      traits,
    }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, traits: [], error: e.message }, { status: 502 });
  }
}

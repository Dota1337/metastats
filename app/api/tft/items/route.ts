import { NextRequest, NextResponse } from 'next/server';
import { parseVelocity } from '../../../lib/query-params';
import { loadTftStats, normalizeBucket } from '../../../lib/tft-stats-loader';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
} from '../../../lib/tft-supabase-reader';
import { isExcludedItem, isExcludedUnit } from '../../../lib/tft-excluded';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../lib/api-cache';
import { lookupSnapshot } from '../../../lib/snapshot-lookup';

// C3 (2026-07-04): raised so the snapshot publisher's per-permutation fetch of a
// heavy detoast perm doesn't 504 on the Vercel default (~15s) and leave a gap.
export const maxDuration = 60;

interface ItemListRow {
  api_name: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  total_item_slots: number;
  top_users_merged: any[][];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Detail view → legacy JSON loader (per-bucket users only available there).
  if (id) {
    if (isExcludedItem(id)) {
      return NextResponse.json({ region: 'euw1', bucket: 'all', hasData: true, item: null });
    }
    const region = (searchParams.get('region') || 'euw1').toLowerCase();
    const bucket = normalizeBucket(searchParams.get('bucket'));
    const stats = loadTftStats(region);
    if (!stats) return NextResponse.json({ region, bucket, hasData: false, item: null });
    const buckets = stats.byItem?.[id];
    if (!buckets) return NextResponse.json({ region, bucket, hasData: true, item: null });
    const data = buckets[bucket] || buckets.all || null;
    if (!data) return NextResponse.json({ region, bucket, hasData: true, item: null });
    return cachedJson({
      region, bucket,
      set: stats.set, patch: stats.patch,
      hasData: true,
      item: {
        apiName: id,
        games: data.games,
        avgPlacement: data.games > 0 ? data.sumPlacement / data.games : null,
        top4Rate: data.games > 0 ? data.top4 / data.games : null,
        // Per-carrier top4Rate + top1Rate land in the snapshot from the
        // aggregator-patch (2026-06-19). Older JSON snapshots without
        // u.top4 / u.top1 surface as null so the UI shows "—" instead of
        // a fake zero — gets filled in on the next daily-crawl cycle.
        topUsers: (data.topUsers || []).map((u: any) => ({
          characterId: u.characterId,
          games: u.games,
          avgPlacement: u.games > 0 ? u.sumPlacement / u.games : null,
          top4Rate: u.games > 0 && u.top4 != null ? u.top4 / u.games : null,
          top1Rate: u.games > 0 && u.top1 != null ? u.top1 / u.games : null,
        })),
      },
    });
  }

  try {
    // Plan E + B (siehe comps/route.ts).
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);
    // Velocity-Layer (W1-A): ?velocity=N → dedizierte RPC mit FILTER-
    // Aggregation für now/prev in EINEM Scan (Migration 0036). p_days bleibt
    // das User-gewählte Tagesfenster; p_shift_days = velocity-Wert vom
    // StatsFilterBar (3 = "48h", 7 = "7d"). prev-Fenster ist immer von
    // current_date-(days+shift) bis current_date-shift — kein Overlap mit dem
    // now-Fenster, exakt wie bei der Comp-Velocity.
    const velocityShift = parseVelocity(searchParams.get('velocity'));
    const wantVelocity = velocityShift > 0;

    // Snapshot-Pfad: gleiches Pattern wie /api/tft/comps. Velocity-Overlays
    // werden nicht vorgerendert → fall through to live RPC bei wantVelocity.
    if (!wantVelocity) {
      const hit = await lookupSnapshot('items', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
      });
      // Guard 2026-06-21: kein leeres Snapshot-Bundle ausliefern.
      const payload = hit?.payload as { hasData?: boolean; items?: unknown[] } | undefined;
      if (hit && payload?.hasData && Array.isArray(payload.items) && payload.items.length > 0) {
        const resp = cachedJson(hit.payload, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    // Lean RPC (migration 0028): merges top_users to the top-8 carriers in SQL
    // instead of jsonb_agg-ing every per-day array. ~14x faster on the heavy
    // all-bucket/7d slice (76s→5.5s, no more 502) and ~126x on the diamond/3d
    // default (9s→72ms). Returns the same shape; the merged list is wrapped so
    // the mergeJsonbCountArrays call below still works unchanged.
    const [rows, velocityRows] = await Promise.all([
      callRpc<ItemListRow[]>('get_tft_item_stats_list', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patchFilter,
        p_set: filters.setNumber,
      }),
      wantVelocity
        ? callRpc<{
            api_name: string;
            games_now: number; games_prev: number;
            sum_placement_now: number; sum_placement_prev: number;
            top4_now: number; top4_prev: number;
            total_slots_now: number; total_slots_prev: number;
          }[]>('get_tft_item_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patchFilter,
            // User-requested window (pre-stale-bump) — see comps/route.ts for
            // the same rationale: bumped days would silently turn "1d vs 3d"
            // into "5d vs 5d" during erstfill staleness.
            p_days: filters.requestedDays,
            p_shift_days: velocityShift,
            p_anchor_offset_days: filters.anchorOffsetDays,
            p_min_games: 30,
          }).catch(() => [])
        : Promise.resolve([] as any[]),
    ]);
    const totalSlots = rows[0]?.total_item_slots || 0;
    const velocityByName = new Map<string, typeof velocityRows[number]>();
    for (const v of velocityRows) velocityByName.set(v.api_name, v);

    const items = rows
      .filter(r => !isExcludedItem(r.api_name))
      .map(r => {
        // top_users_merged is jsonb[] (an outer array of per-row arrays). Flatten
        // and re-group so the most-common carrier wins across the merged window.
        // Cap at 8 — the items-list column has room for that many cost-bordered
        // tiles without overflowing on desktop.
        const topUsers = mergeJsonbCountArrays(r.top_users_merged || [], 'characterId', 8)
          .map(u => u.characterId)
          .filter(cid => !isExcludedUnit(cid));
        const games = Number(r.games);
        const avgPlacement = games > 0 ? Number(r.sum_placement) / games : null;
        const top4Rate = games > 0 ? Number(r.top4) / games : null;
        // Top1 forward-fills only — historical rows have top1=NULL aggregated
        // as 0 in the RPC. data-skeptic: keep `top1Rate = null` when the
        // aggregated top1 is 0, so the UI shows "—" instead of 0% while the
        // first 7-10 daily-crawls bootstrap (feedback_no_fake_values).
        const top1Raw = Number(r.top1);
        const top1Rate = games > 0 && top1Raw > 0 ? top1Raw / games : null;
        const pickRate = totalSlots > 0 ? games / totalSlots : null;

        // Velocity Δ (W1-A) — aus der dedizierten RPC-Aggregation. Die RPC
        // liefert NUR Items, deren now+prev kombiniert ≥ 30 Games haben;
        // jenseits davon prüfen wir hier nochmal individuelle Mindestschwellen
        // damit das UI nicht "+99.00"-Ausreißer anzeigt.
        let velocity: any = null;
        if (wantVelocity) {
          const v = velocityByName.get(r.api_name);
          if (v) {
            const gNow = Number(v.games_now);
            const gPrev = Number(v.games_prev);
            const slotsNow = Number(v.total_slots_now);
            const slotsPrev = Number(v.total_slots_prev);
            if (gNow >= 30 && gPrev >= 30) {
              const avgNow = Number(v.sum_placement_now) / gNow;
              const avgPrev = Number(v.sum_placement_prev) / gPrev;
              const top4Now = Number(v.top4_now) / gNow;
              const top4Prev = Number(v.top4_prev) / gPrev;
              const pickNow = slotsNow > 0 ? gNow / slotsNow : null;
              const pickPrev = slotsPrev > 0 ? gPrev / slotsPrev : null;
              velocity = {
                deltaAvgPlacement: avgNow - avgPrev,
                deltaTop4Rate: top4Now - top4Prev,
                deltaPickRate: pickNow != null && pickPrev != null ? pickNow - pickPrev : null,
                prevGames: gPrev,
                prevAvgPlacement: avgPrev,
                prevTop4Rate: top4Prev,
              };
            } else if (gNow >= 30 && gPrev < 10) {
              velocity = { isNew: true };
            }
          }
        }

        return {
          apiName: r.api_name,
          games,
          avgPlacement,
          top4Rate,
          top1Rate,
          pickRate,
          topUsers,
          ...(velocity ? { velocity } : {}),
        };
      });
    items.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    return cachedJson({
      hasData: items.length > 0,
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
      items,
    }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, items: [], error: e.message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket } from '../../../lib/tft-stats-loader';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
} from '../../../lib/tft-supabase-reader';
import { isExcludedItem, isExcludedUnit } from '../../../lib/tft-excluded';
import { cachedJson } from '../../../lib/api-cache';

interface ItemListRow {
  api_name: string;
  games: number;
  sum_placement: number;
  top4: number;
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
        topUsers: (data.topUsers || []).map((u: any) => ({
          characterId: u.characterId,
          games: u.games,
          avgPlacement: u.games > 0 ? u.sumPlacement / u.games : null,
        })),
      },
    });
  }

  try {
    const filters = await resolveFilters(searchParams);
    // Optional velocity layer (W1-A): ?velocity=N fires a second item-stats
    // call shifted N days into the past, then computes per-item Δs in JS.
    // Items don't have a dedicated velocity-RPC like comps do, but firing the
    // lean list twice is cheap enough (sub-second warm) — and the comparison
    // semantic is identical: delta = current − previous, mit `previous` als
    // "letzte N Tage VOR dem aktuellen Window".
    const velocityShift = Math.max(0, parseInt(searchParams.get('velocity') || '0', 10));
    const wantVelocity = velocityShift > 0;
    const prevDays = filters.days;

    // Lean RPC (migration 0028): merges top_users to the top-8 carriers in SQL
    // instead of jsonb_agg-ing every per-day array. ~14x faster on the heavy
    // all-bucket/7d slice (76s→5.5s, no more 502) and ~126x on the diamond/3d
    // default (9s→72ms). Returns the same shape; the merged list is wrapped so
    // the mergeJsonbCountArrays call below still works unchanged.
    const [rows, prevRows] = await Promise.all([
      callRpc<ItemListRow[]>('get_tft_item_stats_list', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
      }),
      wantVelocity
        ? callRpc<ItemListRow[]>('get_tft_item_stats_list', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            // Previous window = days BEFORE the current N-day window. The lean
            // RPC ranges from `current_date - p_days` to today; we approximate
            // the prior window by widening p_days to (current+shift) and then
            // subtracting in JS via the day_offset filter — but the simpler
            // (and good-enough) signal is "shift days ago, same p_days length":
            // we'd need a SQL helper for an exact prior-window slice. Until
            // then we approximate by p_days = velocityShift, p_patch = null
            // (don't patch-pin the prior window), and treat it as a baseline.
            p_days: velocityShift,
            p_patch: null,
            p_set: filters.setNumber,
          }).catch(() => [] as ItemListRow[])
        : Promise.resolve([] as ItemListRow[]),
    ]);
    const totalSlots = rows[0]?.total_item_slots || 0;
    const prevTotalSlots = prevRows[0]?.total_item_slots || 0;
    // Index prior-window rows by api_name for O(1) lookup during delta merge.
    const prevByName = new Map<string, ItemListRow>();
    for (const r of prevRows) prevByName.set(r.api_name, r);

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
        const pickRate = totalSlots > 0 ? games / totalSlots : null;

        // Velocity delta (Δ): nur befüllt wenn ?velocity=N gesetzt war und die
        // Prior-Window-Daten genug Sample-Size haben. Δ-Felder werden mit
        // null geliefert wenn entweder das aktuelle ODER das prev Window
        // unter 30 Games hat — damit das UI nicht "+99.00" Junk anzeigt.
        let velocity: any = null;
        if (wantVelocity) {
          const prev = prevByName.get(r.api_name);
          const prevGames = prev ? Number(prev.games) : 0;
          if (games >= 30 && prevGames >= 30 && prev) {
            const prevAvg = Number(prev.sum_placement) / prevGames;
            const prevTop4 = Number(prev.top4) / prevGames;
            const prevPick = prevTotalSlots > 0 ? prevGames / prevTotalSlots : null;
            velocity = {
              deltaAvgPlacement: (avgPlacement ?? 0) - prevAvg,
              deltaTop4Rate: (top4Rate ?? 0) - prevTop4,
              deltaPickRate: pickRate != null && prevPick != null ? pickRate - prevPick : null,
              prevGames,
              prevAvgPlacement: prevAvg,
              prevTop4Rate: prevTop4,
            };
          } else if (games >= 30 && prevGames < 10) {
            // Neuer Eintrag — Vergleich nicht sinnvoll. UI kann das als "NEW"
            // markieren wenn gewünscht.
            velocity = { isNew: true };
          }
        }

        return {
          apiName: r.api_name,
          games,
          avgPlacement,
          top4Rate,
          pickRate,
          topUsers,
          ...(velocity ? { velocity } : {}),
        };
      });
    items.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    const patches = await getAvailablePatches();
    return cachedJson({
      hasData: items.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
        velocityShift: wantVelocity ? velocityShift : null,
      },
      patches,
      items,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, items: [], error: e.message }, { status: 502 });
  }
}

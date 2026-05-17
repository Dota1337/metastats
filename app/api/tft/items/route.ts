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
    const rows = await callRpc<ItemListRow[]>('get_tft_item_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
    });
    const totalSlots = rows[0]?.total_item_slots || 0;
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
        return {
          apiName: r.api_name,
          games: Number(r.games),
          avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
          top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
          pickRate: totalSlots > 0 ? Number(r.games) / Number(totalSlots) : null,
          topUsers,
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
      },
      patches,
      items,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, items: [], error: e.message }, { status: 502 });
  }
}

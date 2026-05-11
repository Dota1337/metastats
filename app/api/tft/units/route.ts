import { NextRequest, NextResponse } from 'next/server';
import { loadTftStats, normalizeBucket, bucketParticipants } from '../../../lib/tft-stats-loader';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';

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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Detail view stays on the legacy JSON loader — see top of file.
  if (id) {
    const region = (searchParams.get('region') || 'euw1').toLowerCase();
    const bucket = normalizeBucket(searchParams.get('bucket'));
    const stats = loadTftStats(region);
    if (!stats) return NextResponse.json({ region, bucket, hasData: false, unit: null });
    const buckets = stats.byUnit?.[id];
    if (!buckets) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const data = buckets[bucket] || buckets.all || null;
    if (!data) return NextResponse.json({ region, bucket, hasData: true, unit: null });
    const avgPlacement = data.games > 0 ? data.sumPlacement / data.games : null;
    return NextResponse.json({
      region, bucket,
      set: stats.set, patch: stats.patch,
      hasData: true,
      unit: {
        characterId: id,
        games: data.games,
        avgPlacement,
        top4Rate: data.games > 0 ? data.top4 / data.games : null,
        top1Rate: data.games > 0 ? data.top1 / data.games : null,
        topItems: (data.topItems || []).map((it: any) => ({
          item: it.item,
          games: it.games,
          avgPlacement: it.games > 0 ? it.sumPlacement / it.games : null,
          top4Rate: it.games > 0 ? it.top4 / it.games : null,
        })),
        topItemSets: (data.topItemSets || []).map((s: any) => ({
          items: s.items,
          games: s.games,
          avgPlacement: s.games > 0 ? s.sumPlacement / s.games : null,
          top4Rate: s.games > 0 ? s.top4 / s.games : null,
        })),
      },
    });
  }

  // Stats list — Supabase RPC with filter expansion.
  try {
    const filters = await resolveFilters(searchParams);
    const rows = await callRpc<UnitListRow[]>('get_tft_unit_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
    });
    const participants = rows[0]?.participants || 0;
    const units = rows.map(r => ({
      characterId: r.character_id,
      games: Number(r.games),
      avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
      top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
      top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
      pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
    }));
    units.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    const patches = await getAvailablePatches();
    return NextResponse.json({
      hasData: units.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
      },
      patches,
      units,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, units: [], error: e.message }, { status: 502 });
  }
}

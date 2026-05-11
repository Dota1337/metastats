import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';

interface TraitRow {
  name: string;
  activation: number;
  games: number;
  sum_placement: number;
  top4: number;
  participants: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  try {
    const filters = await resolveFilters(searchParams);
    const rows = await callRpc<TraitRow[]>('get_tft_trait_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
    });
    const denom = rows[0]?.participants || 0;
    const traits = rows.map(r => ({
      name: r.name,
      activation: Number(r.activation),
      games: Number(r.games),
      avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
      top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
      pickRate: denom > 0 ? Number(r.games) / Number(denom) : null,
    }));
    traits.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    const patches = await getAvailablePatches();
    return NextResponse.json({
      hasData: traits.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
      },
      patches,
      traits,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, traits: [], error: e.message }, { status: 502 });
  }
}

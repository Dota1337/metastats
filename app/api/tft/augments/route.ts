import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';

interface AugmentRow {
  api_name: string;
  slot: number | null;
  games: number;
  sum_placement: number;
  top4: number;
  participants: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slot = searchParams.get('slot'); // '0' | '1' | '2' | null=all

  try {
    const filters = await resolveFilters(searchParams);
    const rows = await callRpc<AugmentRow[]>('get_tft_augment_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
      p_slot: slot != null && slot !== '' ? Number(slot) : null,
    });
    // For augments, participants is already adjusted for "merged across slots"
    // by the RPC (multiplied by 3 when p_slot is null).
    const denom = rows[0]?.participants || 0;
    const augments = rows.map(r => ({
      apiName: r.api_name,
      slot: r.slot,
      games: Number(r.games),
      avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
      top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
      pickRate: denom > 0 ? Number(r.games) / Number(denom) : null,
    }));
    augments.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    const patches = await getAvailablePatches();
    return cachedJson({
      hasData: augments.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
        slot: slot != null && slot !== '' ? Number(slot) : null,
      },
      patches,
      augments,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, augments: [], error: e.message }, { status: 502 });
  }
}

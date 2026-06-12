import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters, callRpc, getAvailablePatches } from '../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../lib/api-cache';

// /api/tft/trait-unitcount?name=TFT17_Stargazer&region=all&bucket=master_plus
//
// Avg placement per ACTUAL unit count for one trait — the "does overcapping
// help?" curve (e.g. 7 units of a 6-breakpoint trait). Backed by the
// get_tft_trait_unitcount_stats RPC (migration 0025). Empty until the crawl
// has populated tft_daily_trait_unitcount_stats.

interface UcRow {
  name: string;
  num_units: number;
  games: number;
  sum_placement: number;
  top4: number;
}

const MIN_GAMES = 20;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name');
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  try {
    // Plan E + B (siehe comps/route.ts).
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);
    const rows = await callRpc<UcRow[]>('get_tft_trait_unitcount_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
      p_name: name,
    });
    const points = (rows || [])
      .filter(r => Number(r.games) >= MIN_GAMES)
      .map(r => ({
        numUnits: Number(r.num_units),
        games: Number(r.games),
        avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
        top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
      }))
      .sort((a, b) => a.numUnits - b.numUnits);

    return cachedJson({ hasData: points.length > 0, name, points }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, points: [], error: e.message }, { status: 502 });
  }
}

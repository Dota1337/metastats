import { NextRequest, NextResponse } from 'next/server';
import { callRpc, expandRegions, expandBuckets } from '../../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../../lib/api-cache';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import { selectFamilyMembers, familyKeyForMerge } from '../../../../lib/tft-comp-family-merge';

// /api/tft/comps/trend
//   ?slug=<cluster_key>&region=<group|exact>&bucket=<group|exact>&days=N
// Backs the Trends-Time-Series chart on /tft/comps/[slug]: 14/30-day per-day
// avg-place / top4-rate / top1-rate so the user sees the comp's movement
// within the patch, not just before/after.

interface DailyTrendRow {
  day: string;
  games: number | string;
  sum_placement: number | string;
  top4: number | string;
  top1: number | string;
}

// expandRegions/expandBuckets sind nicht exportiert — wir parsen inline. Kann
// später in den Reader extrahiert werden, wenn das Pattern mehrfach auftaucht.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get('slug');
  if (!slug) return NextResponse.json({ error: 'slug required' }, { status: 400 });

  const regionParam = searchParams.get('region') || 'all';
  const bucketParam = searchParams.get('bucket') || 'diamond';
  const days = Math.max(1, Math.min(60, parseInt(searchParams.get('days') || '14', 10)));
  // Family-Mode (Default für die Detail-Page-Trend-Linie): die RPC bekommt
  // ALLE Sub-Cluster der Family. ?variant=exact = Single-Slug-Sicht.
  const variantMode = searchParams.get('variant') === 'exact' ? 'exact' : 'family';
  // Optional: comma-separated Liste der Family-Slugs vom Detail-Page-Caller.
  // Spart Trend-Endpoint einen eigenen RPC-Roundtrip zur Family-Auflösung.
  const familySlugsParam = searchParams.get('familySlugs');
  const explicitFamilySlugs = familySlugsParam ? familySlugsParam.split(',').filter(Boolean) : null;

  try {
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const regions = expandRegions(regionParam);
    const buckets = expandBuckets(bucketParam);

    // Im Family-Mode: wenn der Caller explizite Family-Slugs übergibt, nutzen
    // wir die direkt. Sonst nimmt die RPC den Single-Slug-Pfad (Backward-
    // Compat) — Caller die Family-Slugs nicht kennen bekommen Single-Slug-
    // Sicht trotz ?variant=family.
    const useFamily = variantMode === 'family' && explicitFamilySlugs && explicitFamilySlugs.length > 1;
    // Bei Single-Slug-Family kein min-games-Floor (Backward-Compat); bei echter
    // Family wir wollen verrauschte Daily-Linien rauskippen (data-skeptic F4).
    const minGamesPerDay = useFamily ? 20 : 0;

    const rows = await callRpc<DailyTrendRow[]>('get_tft_comp_daily_trend', {
      p_cluster_key: slug,
      p_regions: regions,
      p_buckets: buckets,
      p_days: days,
      p_cluster_keys: useFamily ? explicitFamilySlugs : null,
      p_min_games_per_day: minGamesPerDay,
    });

    const points = (rows || []).map(r => {
      const games = Number(r.games);
      const sumP = Number(r.sum_placement);
      const t4 = Number(r.top4);
      const t1 = Number(r.top1);
      return {
        day: r.day,
        games,
        avgPlacement: games > 0 ? sumP / games : null,
        top4Rate: games > 0 ? t4 / games : null,
        top1Rate: games > 0 ? t1 / games : null,
      };
    });

    return cachedJson({
      hasData: points.length > 0,
      slug,
      region: regionParam,
      bucket: bucketParam,
      days,
      variantMode,
      familySize: useFamily ? explicitFamilySlugs!.length : 1,
      points,
    }, { cache: cacheControl });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, points: [], error: e.message }, { status: 502 });
  }
}

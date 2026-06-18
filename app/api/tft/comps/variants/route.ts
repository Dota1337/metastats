import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '../../../../lib/tft-supabase-reader';
import { STATS_CACHE_CONTROL, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../../lib/api-cache';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';

// Variants-Switcher API: returns all sub-cluster variants of a comp family
// (same trait + level + carry, different *N / ~aug / #secondary suffixes).
//
// Why a dedicated endpoint vs client-side filtering:
//   - Comp-Detail page doesn't load the full comp list (only the matched
//     cluster), so client-side filtering would need a parallel fetch of
//     ~2000 clusters just to surface 5-10 variants. Server-side prefix
//     query (cluster_key LIKE 'family%') is 24-49ms warm per perf-critic
//     measurement against the existing 5-column unique-key index.
//
// Threshold per data-skeptic verdict (2026-06-18):
//   - games >= 50 absolute AND games >= 5% of family total
//   - active-variant always included even when below threshold (frontend
//     responsibility — flag on the response)
//
// Cluster-key format reminder (app/lib/tft-cluster.ts):
//   <trait>@<level>_<carry>[*N][~aug][#secondary]
// Family = trait@level_carry without any suffix.

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

interface VariantRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
}

interface Variant {
  clusterKey: string;
  slug: string;
  games: number;
  avgPlacement: number;
  top4Rate: number;
  top1Rate: number;
  carryStar: number;
  augmentSlug: string | null;
  secondary: string | null;
  belowThreshold: boolean;
}

function parseClusterKey(key: string) {
  const m = /^(.+)@(\d+)_([^#*~]+)(?:\*(\d))?(?:~([A-Za-z]+))?(?:#(.+))?$/.exec(key);
  if (!m) return null;
  return {
    trait: m[1],
    level: Number(m[2]),
    carry: m[3],
    carryStar: m[4] ? Number(m[4]) : 2,
    augmentSlug: m[5] || null,
    secondary: m[6] || null,
  };
}

// Slug = cluster_key direct, matching the existing /api/tft/comps response
// shape (`slug: r.cluster_key`). The Comp-Detail page uses the slug as-is
// to look up the cluster, so transformations would break navigation.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get('family');
  if (!family) {
    return NextResponse.json({ error: 'family parameter required' }, { status: 400 });
  }
  // Validate family format — trait@level_carry, no suffixes.
  if (!/^[A-Za-z0-9_]+@\d+_[A-Za-z0-9_]+$/.test(family)) {
    return NextResponse.json({ error: 'invalid family format' }, { status: 400 });
  }

  if (!SUPA_URL || !SUPA_KEY) {
    return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 });
  }

  try {
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches) || STATS_CACHE_CONTROL;

    const filters = await resolveFilters(searchParams);
    const setNumber = filters.setNumber ?? 17;

    // PostgREST prefix-match: cluster_key=like.<family>* (escape % as URL-encode).
    // Family pattern guaranteed safe by regex above.
    const params = new URLSearchParams();
    params.set('select', 'cluster_key,games,sum_placement,top4,top1');
    params.set('cluster_key', `like.${family}*`);
    params.set('region', `in.(${filters.regions.join(',')})`);
    params.set('bucket', `in.(${filters.buckets.join(',')})`);
    params.set('set_number', `eq.${setNumber}`);
    if (filters.patchFilter) {
      params.set('patch', `eq.${filters.patchFilter}`);
    }
    // Day window: PostgREST supports gte. Use today-days as ISO date.
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - filters.days);
    params.set('day', `gte.${cutoff.toISOString().slice(0, 10)}`);
    params.set('limit', '500'); // safety cap; per-family cluster count is small

    const url = `${SUPA_URL}/rest/v1/tft_daily_comp_stats?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Variants fetch failed: HTTP ${res.status} ${body.slice(0, 200)}`);
    }

    const rows = (await res.json()) as VariantRow[];

    // Aggregate per cluster_key across day/region/bucket rows.
    const byKey = new Map<string, { games: number; sumPlacement: number; top4: number; top1: number }>();
    for (const r of rows) {
      const prev = byKey.get(r.cluster_key) || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      byKey.set(r.cluster_key, {
        games: prev.games + Number(r.games || 0),
        sumPlacement: prev.sumPlacement + Number(r.sum_placement || 0),
        top4: prev.top4 + Number(r.top4 || 0),
        top1: prev.top1 + Number(r.top1 || 0),
      });
    }

    const familyTotal = [...byKey.values()].reduce((s, v) => s + v.games, 0);
    const MIN_ABS = 50;
    const MIN_SHARE = 0.05;

    const variants: Variant[] = [...byKey.entries()]
      .map(([clusterKey, agg]) => {
        const parts = parseClusterKey(clusterKey);
        if (!parts) return null;
        const share = familyTotal > 0 ? agg.games / familyTotal : 0;
        const belowThreshold = agg.games < MIN_ABS || share < MIN_SHARE;
        return {
          clusterKey,
          slug: clusterKey,
          games: agg.games,
          avgPlacement: agg.games > 0 ? agg.sumPlacement / agg.games : 0,
          top4Rate: agg.games > 0 ? agg.top4 / agg.games : 0,
          top1Rate: agg.games > 0 ? agg.top1 / agg.games : 0,
          carryStar: parts.carryStar,
          augmentSlug: parts.augmentSlug,
          secondary: parts.secondary,
          belowThreshold,
        } as Variant;
      })
      .filter((v): v is Variant => v !== null)
      // Filter below-threshold but cap at Top-4 visible per data-skeptic.
      // Frontend re-adds the active variant when missing.
      .filter(v => !v.belowThreshold)
      .sort((a, b) => b.games - a.games)
      .slice(0, 4);

    return NextResponse.json(
      {
        family,
        familyTotal,
        variants,
        filters: {
          region: filters.regionLabel,
          bucket: filters.bucketLabel,
          days: filters.requestedDays,
          patch: filters.patch,
        },
      },
      { headers: { 'Cache-Control': cacheControl } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'unknown';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

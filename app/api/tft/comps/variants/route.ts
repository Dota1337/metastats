import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters } from '../../../../lib/tft-supabase-reader';
import { STATS_CACHE_CONTROL, cacheControlForPatches, maybeRedirectByPatchAlias } from '../../../../lib/api-cache';
import { getAvailablePatches } from '../../../../lib/tft-supabase-reader';
import { parseClusterKey } from '../../../../lib/tft-cluster';

// Variants-Switcher API: returns all sub-cluster variants of a comp family.
//
// Family-Granularität (User-Entscheid 2026-06-21 / Option C):
//   compTraitFamilyKey = <trait>__<carry> — Level UND Augment werden
//   konsolidiert. Vorher (bis 2026-06-20): compFamilyKey = <trait>@<level>_
//   <carry>. Beide Formate werden hier akzeptiert (Backward-Compat alte
//   Bookmarks/Cached-URLs).
//
// PostgREST-Query-Strategie: `__` ist NICHT als Prefix in den DB-cluster_keys
// vorhanden (DB-Format ist `<trait>@<level>_<carry>...`). Heißt: für das
// `__`-Format machen wir broad `like.<trait>@*` und filtern carry-Match auf
// JS-Seite. Etwas mehr Rows aus DB, aber Kardinalität pro trait ist niedrig.
//
// Threshold (data-skeptic 2026-06-21):
//   - min 30g absolute pro Sub-Cluster (sonst Singleton-Noise)
//   - min 5% Family-Total-Share
//   - Sort by Sample-Größe DEFAULT (most-played zuerst, statt by Avg)
//   - active-variant always included even when below threshold

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

// Slug = cluster_key direct, matching the existing /api/tft/comps response
// shape (`slug: r.cluster_key`). The Comp-Detail page uses the slug as-is
// to look up the cluster, so transformations would break navigation.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get('family');
  if (!family) {
    return NextResponse.json({ error: 'family parameter required' }, { status: 400 });
  }
  // Akzeptiere BEIDE Formate: alt <trait>@<level>_<carry> (Backward-Compat)
  // + neu <trait>__<carry> (C-Konsolidierung 2026-06-21).
  const newFmt = /^([A-Za-z0-9_]+)__([A-Za-z0-9_]+)$/.exec(family);
  const oldFmt = !newFmt ? /^([A-Za-z0-9_]+)@\d+_([A-Za-z0-9_]+)$/.exec(family) : null;
  if (!newFmt && !oldFmt) {
    return NextResponse.json({ error: 'invalid family format' }, { status: 400 });
  }
  const familyTrait = (newFmt || oldFmt)![1];
  const familyCarry = (newFmt || oldFmt)![2];

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

    // PostgREST broad prefix-match auf trait — Carry-Filter passiert JS-seitig
    // weil `<trait>__<carry>`-Format kein DB-Prefix ist. Pro trait sind das
    // typisch 10-50 cluster_keys, performant.
    const params = new URLSearchParams();
    params.set('select', 'cluster_key,games,sum_placement,top4,top1');
    params.set('cluster_key', `like.${familyTrait}@*`);
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

    // Aggregate per cluster_key across day/region/bucket rows + Carry-Filter
    // (C-Konsolidierung: nur cluster_keys mit gleichem Carry behalten).
    const byKey = new Map<string, { games: number; sumPlacement: number; top4: number; top1: number }>();
    for (const r of rows) {
      const parts = parseClusterKey(r.cluster_key);
      if (parts?.carry !== familyCarry) continue;
      const prev = byKey.get(r.cluster_key) || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      byKey.set(r.cluster_key, {
        games: prev.games + Number(r.games || 0),
        sumPlacement: prev.sumPlacement + Number(r.sum_placement || 0),
        top4: prev.top4 + Number(r.top4 || 0),
        top1: prev.top1 + Number(r.top1 || 0),
      });
    }

    const familyTotal = [...byKey.values()].reduce((s, v) => s + v.games, 0);
    // min-Sample-Threshold pro Sub-Cluster (data-skeptic 2026-06-21):
    // 30g absolute UND 5% Family-Share. Tiefer als der Listing-min-Filter
    // damit User die Sub-Strategien einer mid-played Family noch sehen kann.
    const MIN_ABS = 30;
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
      // Filter below-threshold, sort by Sample-Größe (most-played zuerst —
      // data-skeptic F1 2026-06-21: Skill-Ceiling-Variante ist nicht zwingend
      // der Modal-Pick, aber Sample-Sort ist die User-erwartete Default-View).
      // Frontend re-adds the active variant when missing. Top-6 sichtbar.
      .filter(v => !v.belowThreshold)
      .sort((a, b) => b.games - a.games)
      .slice(0, 6);

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

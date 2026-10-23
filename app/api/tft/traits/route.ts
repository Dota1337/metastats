import { NextRequest, NextResponse } from 'next/server';
import { resolveFilters, callRpc, getAvailablePatches, rpcWindowArgs, type ResolvedFilters } from '../../../lib/tft-supabase-reader';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias, DEGRADED_CACHE_CONTROL } from '../../../lib/api-cache';
import { lookupSnapshot, isSnapshotPublisher } from '../../../lib/snapshot-lookup';
import { lookupFallbackSnapshot, FALLBACK_HEADER, type FallbackFilters } from '../../../lib/snapshot-fallback';
import { snapshotFilterOpts, transitionCacheControl, withDisplayPatch } from '../../../lib/stats-patch-display';

// C3 (2026-07-04): raised so the snapshot publisher's per-permutation fetch of a
// heavy detoast perm doesn't 504 on the Vercel default (~15s) and leave a gap.
export const maxDuration = 60;

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
  // Notreserve bei DB-Ausfall, siehe app/lib/snapshot-fallback.ts.
  let fallbackFilters: (FallbackFilters & ResolvedFilters) | null = null;
  try {
    // Plan E + B (siehe comps/route.ts).
    let patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;

    const filters = await resolveFilters(searchParams, { publisher: isSnapshotPublisher(request) });
    fallbackFilters = filters;
    // Liste nach resolveFilters (ggf. neu geladen, siehe items/route.ts).
    patches = await getAvailablePatches();
    const cacheControl = transitionCacheControl(cacheControlForPatches(patches), filters);

    // Snapshot-Pfad — siehe /api/tft/comps. Den Δ-Vergleich „vs Vorpatch"
    // liefert seit 18.10.2026 /api/tft/patch-diff?full=1 (je Stufe); ein altes
    // ?velocity= wird ignoriert.
    {
      const hit = await lookupSnapshot('traits', {
        ...snapshotFilterOpts(filters),
        minGames: 0,
        skip: isSnapshotPublisher(request),
      });
      // Guard 2026-06-21: kein leeres Snapshot-Bundle ausliefern.
      const payload = hit?.payload as { hasData?: boolean; traits?: unknown[] } | undefined;
      if (hit && payload?.hasData && Array.isArray(payload.traits) && payload.traits.length > 0) {
        const resp = cachedJson(withDisplayPatch(hit.payload, filters, patches), { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    const rows = await callRpc<TraitRow[]>('get_tft_trait_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      ...rpcWindowArgs(filters),
      p_patch: filters.patchFilter,
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

    return cachedJson({
      hasData: traits.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        requestedDays: filters.requestedDays,
        patch: filters.displayPatch,
        patchFilter: filters.patchFilter,
        patchStartDay: filters.patchStartDay,
        set: filters.setNumber,
        anchorOffsetDays: filters.anchorOffsetDays,
        startDay: filters.startDay,
        endDay: filters.endDay,
        dataEnd: filters.dataEnd,
      },
      patches,
      traits,
    }, { cache: cacheControl });
  } catch (e: any) {
    // Trifft v. a. Anfragen, die am Bundle vorbei live laufen: dann lieber
    // der Vorrat als eine leere Seite. Nie fuer den Publisher.
    if (fallbackFilters && !isSnapshotPublisher(request)) {
      const fb = await lookupFallbackSnapshot('traits', 'traits', fallbackFilters);
      if (fb) {
        console.error('[api/tft/traits] Live fehlgeschlagen, Rueckfall', fb.tag, ':', e?.message ?? e);
        const resp = cachedJson(withDisplayPatch(fb.payload, fallbackFilters, await getAvailablePatches()), { cache: DEGRADED_CACHE_CONTROL });
        resp.headers.set(FALLBACK_HEADER, fb.tag);
        return resp;
      }
    }
    return NextResponse.json({ hasData: false, traits: [], error: e.message }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';
import { normalizeBucket } from '../../../lib/tft-stats-loader';
import { coreFromListRow, itemDetailBody, type Blocks, type CarrierRow, type DetailCore } from '../../../lib/tft-detail-payload';
import { itemCarriersFor } from '../../../lib/tft-detail-builds';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
  rpcWindowArgs,
} from '../../../lib/tft-supabase-reader';
import { isExcludedItem, isExcludedUnit } from '../../../lib/tft-excluded';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias, DEGRADED_CACHE_CONTROL } from '../../../lib/api-cache';
import { lookupSnapshot, isSnapshotPublisher } from '../../../lib/snapshot-lookup';
import { lookupFallbackSnapshot, FALLBACK_HEADER, type FallbackFilters } from '../../../lib/snapshot-fallback';

// C3 (2026-07-04): raised so the snapshot publisher's per-permutation fetch of a
// heavy detoast perm doesn't 504 on the Vercel default (~15s) and leave a gap.
export const maxDuration = 60;

interface ItemListRow {
  api_name: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  total_item_slots: number;
  top_users_merged: any[][];
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Detail view: Kernwerte wie die Liste, Traeger aus der Datenbank (0096).
  if (id) {
    if (isExcludedItem(id)) {
      return NextResponse.json({ region: 'euw1', bucket: 'all', hasData: true, item: null });
    }
    const region = (searchParams.get('region') || 'all').toLowerCase();
    const bucket = normalizeBucket(searchParams.get('bucket'));
    // Kernwerte aus derselben Quelle wie die Liste (Region, Zeitraum, Rang) —
    // Begruendung in /api/tft/units. Die Traeger (topUsers) seit 0096 aus der
    // Datenbank: Vorrat der Standardansicht, sonst live (tft-detail-builds.ts).
    let core: DetailCore | null = null;
    let coreKnown = false;
    let filterSet: number | null = null;
    let filterPatch: string | null = null;
    let carriers: Blocks<CarrierRow[]> = 'failed';
    try {
      const filters = await resolveFilters(searchParams, { publisher: isSnapshotPublisher(request) });
      filterSet = filters.setNumber;
      filterPatch = filters.patch;
      const carriersP = itemCarriersFor(filters, id).catch((e: Error) => {
        console.error('[items detail] carriers', e.message);
        return 'failed' as const;
      });
      const hit = await lookupSnapshot('items', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
        setNumber: filters.setNumber,
        endDay: filters.endDay,
      });
      const snapItems = (hit?.payload as { items?: any[] } | undefined)?.items;
      if (Array.isArray(snapItems) && snapItems.length > 0) {
        core = coreFromListRow(snapItems.find(x => x.apiName === id));
      } else {
        const rows = await callRpc<ItemListRow[]>('get_tft_item_stats_list', {
          p_regions: filters.regions,
          p_buckets: filters.buckets,
          ...rpcWindowArgs(filters),
          p_patch: filters.patchFilter,
          p_set: filters.setNumber,
        });
        const row = rows.find(r => r.api_name === id);
        const games = row ? Number(row.games) : 0;
        const top1Raw = row ? Number(row.top1) : 0;
        core = row && games > 0
          ? {
              games,
              avgPlacement: Number(row.sum_placement) / games,
              top4Rate: Number(row.top4) / games,
              // wie in der Liste: 0 heisst hier „noch nicht erfasst", nicht 0 %
              top1Rate: top1Raw > 0 ? top1Raw / games : null,
            }
          : null;
      }
      coreKnown = true;
      carriers = await carriersP;
    } catch {
      // Datenbank nicht erreichbar → unten auf die Wochendatei zurueckfallen.
    }
    const { body, cacheable } = itemDetailBody({ id, region, bucket, core, coreKnown, filterSet, filterPatch }, carriers);
    return cacheable ? cachedJson(body) : NextResponse.json(body);
  }

  // Notreserve bei DB-Ausfall, siehe app/lib/snapshot-fallback.ts.
  let fallbackFilters: FallbackFilters | null = null;
  try {
    // Plan E + B (siehe comps/route.ts).
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams, { publisher: isSnapshotPublisher(request) });
    fallbackFilters = filters;
    // Snapshot-Pfad: gleiches Pattern wie /api/tft/comps. Den Δ-Vergleich
    // „vs Vorpatch" liefert seit 18.10.2026 /api/tft/patch-diff?full=1; ein
    // altes ?velocity= wird ignoriert.
    {
      const hit = await lookupSnapshot('items', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
        setNumber: filters.setNumber,
        endDay: filters.endDay,
        skip: isSnapshotPublisher(request),
      });
      // Guard 2026-06-21: kein leeres Snapshot-Bundle ausliefern.
      const payload = hit?.payload as { hasData?: boolean; items?: unknown[] } | undefined;
      if (hit && payload?.hasData && Array.isArray(payload.items) && payload.items.length > 0) {
        const resp = cachedJson(hit.payload, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    // Lean RPC (migration 0028): merges top_users to the top-8 carriers in SQL
    // instead of jsonb_agg-ing every per-day array. ~14x faster on the heavy
    // all-bucket/7d slice (76s→5.5s, no more 502) and ~126x on the diamond/3d
    // default (9s→72ms). Returns the same shape; the merged list is wrapped so
    // the mergeJsonbCountArrays call below still works unchanged.
    const rows = await callRpc<ItemListRow[]>('get_tft_item_stats_list', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      ...rpcWindowArgs(filters),
      p_patch: filters.patchFilter,
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
        const games = Number(r.games);
        const avgPlacement = games > 0 ? Number(r.sum_placement) / games : null;
        const top4Rate = games > 0 ? Number(r.top4) / games : null;
        // Top1 forward-fills only — historical rows have top1=NULL aggregated
        // as 0 in the RPC. data-skeptic: keep `top1Rate = null` when the
        // aggregated top1 is 0, so the UI shows "—" instead of 0% while the
        // first 7-10 daily-crawls bootstrap (feedback_no_fake_values).
        const top1Raw = Number(r.top1);
        const top1Rate = games > 0 && top1Raw > 0 ? top1Raw / games : null;
        const pickRate = totalSlots > 0 ? games / totalSlots : null;

        return {
          apiName: r.api_name,
          games,
          avgPlacement,
          top4Rate,
          top1Rate,
          pickRate,
          topUsers,
        };
      });
    items.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    return cachedJson({
      hasData: items.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        requestedDays: filters.requestedDays,
        patch: filters.patch,
        patchFilter: filters.patchFilter,
        patchStartDay: filters.patchStartDay,
        set: filters.setNumber,
        anchorOffsetDays: filters.anchorOffsetDays,
        startDay: filters.startDay,
        endDay: filters.endDay,
        dataEnd: filters.dataEnd,
      },
      patches,
      items,
    }, { cache: cacheControl });
  } catch (e: any) {
    // Trifft v. a. Anfragen, die am Bundle vorbei live laufen: dann lieber
    // der Vorrat als eine leere Seite. Nie fuer den Publisher.
    if (fallbackFilters && !isSnapshotPublisher(request)) {
      const fb = await lookupFallbackSnapshot('items', 'items', fallbackFilters);
      if (fb) {
        console.error('[api/tft/items] Live fehlgeschlagen, Rueckfall', fb.tag, ':', e?.message ?? e);
        const resp = cachedJson(fb.payload, { cache: DEGRADED_CACHE_CONTROL });
        resp.headers.set(FALLBACK_HEADER, fb.tag);
        return resp;
      }
    }
    return NextResponse.json({ hasData: false, items: [], error: e.message }, { status: 502 });
  }
}

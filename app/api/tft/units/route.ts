import { NextRequest, NextResponse } from 'next/server';
import { parseVelocity } from '../../../lib/query-params';
import { normalizeBucket, bucketParticipants } from '../../../lib/tft-stats-loader';
import { resolveFilters, callRpc, getAvailablePatches, resolveTrendAnchorOffset } from '../../../lib/tft-supabase-reader';
import { isExcludedUnit } from '../../../lib/tft-excluded';
import { coreFromListRow, unitDetailBody, type DetailCore } from '../../../lib/tft-detail-payload';
import { cachedJson, cacheControlForPatches, maybeRedirectByPatchAlias, DEGRADED_CACHE_CONTROL } from '../../../lib/api-cache';
import { lookupSnapshot, isSnapshotPublisher } from '../../../lib/snapshot-lookup';
import { lookupFallbackSnapshot, FALLBACK_HEADER, type FallbackFilters } from '../../../lib/snapshot-fallback';
import { computeShares } from '../../../lib/tft-shares';
// Seltene Einheiten ans Ende — gleiche Reihenfolge wie die Startdaten der Seite.
import { sortUnitsRareLast } from '../../../lib/tft-list-sort';

// C3 (2026-07-04): raised so the snapshot publisher's per-permutation fetch of a
// heavy detoast perm doesn't 504 on the Vercel default (~15s) and leave a gap.
export const maxDuration = 60;

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
//   per-day Supabase rows don't carry. The list view gets its item row from
//   tft_daily_unit_top_items (migration 0069: top-15 finished items per day,
//   merged by get_tft_unit_top_items); the detail page still shows the
//   most-recent crawl.

interface UnitListRow {
  character_id: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  participants: number;
}

interface UnitTopItemRow {
  character_id: string;
  item: string;
  games: number;
}

// Item-Reihe neben dem Namen auf /tft/units.
const LIST_TOP_ITEMS = 6;

interface UnitVelocityRow {
  character_id: string;
  games_now: number;
  games_prev: number;
  sum_placement_now: number;
  sum_placement_prev: number;
  top4_now: number;
  top4_prev: number;
  top1_now: number;
  top1_prev: number;
  participants_now: number;
  participants_prev: number;
}

// Same Δ-threshold used across comp/item velocity — below ~30 games per
// window the Δs are too noisy to render with intent; the UI shows "—" instead.
const VELOCITY_MIN_GAMES = 30;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  // Detail view stays on the legacy JSON loader — see top of file.
  if (id) {
    if (isExcludedUnit(id)) {
      return NextResponse.json({ region: 'euw1', bucket: 'all', hasData: true, unit: null });
    }
    const region = (searchParams.get('region') || 'all').toLowerCase();
    const bucket = normalizeBucket(searchParams.get('bucket'));
    // Kernwerte (Spiele, Schnitt, Top 4, Sieg) aus derselben Quelle wie die
    // Liste — gleiche Region, gleicher Zeitraum, gleicher Rang. Vorher kamen
    // sie aus der EUW-Wochendatei, und Liste und Detail zeigten andere Zahlen.
    // Die Item-Bloecke gibt es nur in den Wochendateien; die bleiben die Quelle
    // (bei „alle Regionen" EUW, die groesste Stichprobe).
    let core: DetailCore | null = null;
    let coreKnown = false;
    let filterSet: number | null = null;
    let filterPatch: string | null = null;
    try {
      const filters = await resolveFilters(searchParams);
      filterSet = filters.setNumber;
      filterPatch = filters.patch;
      // Wie die Liste unten: der Snapshot enthaelt patchuebergreifende Zahlen,
      // bei einem konkret gewaehlten Patch also direkt aus der DB lesen.
      const hit = filters.patchFilter != null ? null : await lookupSnapshot('units', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
        setNumber: filters.setNumber,
      });
      const snapUnits = (hit?.payload as { units?: any[] } | undefined)?.units;
      if (Array.isArray(snapUnits) && snapUnits.length > 0) {
        core = coreFromListRow(snapUnits.find(x => x.characterId === id));
      } else {
        const rows = await callRpc<UnitListRow[]>('get_tft_unit_stats', {
          p_regions: filters.regions,
          p_buckets: filters.buckets,
          p_days: filters.days,
          p_patch: filters.patchFilter,
          p_set: filters.setNumber,
        });
        const row = rows.find(r => r.character_id === id);
        const games = row ? Number(row.games) : 0;
        core = row && games > 0
          ? {
              games,
              avgPlacement: Number(row.sum_placement) / games,
              top4Rate: Number(row.top4) / games,
              top1Rate: Number(row.top1) / games,
            }
          : null;
      }
      coreKnown = true;
    } catch {
      // Datenbank nicht erreichbar → unten auf die Wochendatei zurueckfallen.
    }
    const { body, cacheable } = unitDetailBody({ id, region, bucket, core, coreKnown, filterSet, filterPatch });
    return cacheable ? cachedJson(body) : NextResponse.json(body);
  }

  // Stats list — Supabase RPC with filter expansion.
  // Notreserve bei DB-Ausfall, siehe app/lib/snapshot-fallback.ts.
  let fallbackFilters: FallbackFilters | null = null;
  try {
    // Plan E + B (siehe comps/route.ts für Begründung): patches vorne, Alias
    // redirecten, Cache-Control patch-frische-abhängig wählen.
    const patches = await getAvailablePatches();
    const redirect = maybeRedirectByPatchAlias(request, patches);
    if (redirect) return redirect;
    const cacheControl = cacheControlForPatches(patches);

    const filters = await resolveFilters(searchParams);
    // Mit ausdruecklich gewaehltem Patch passt das patchuebergreifende Bundle
    // nicht (siehe Snapshot-Pfad unten) — dann keine Notreserve.
    if (filters.patchFilter == null) fallbackFilters = filters;

    // Optional Δ-velocity layer (parallel to comps/items): when ?velocity=N is
    // present the route fires a second RPC and merges per-character Δs into
    // each row. Uses the raw user-requested window + anchor-offset, same
    // semantics as get_tft_comp_velocity (see 0038/0039).
    const velocityShift = parseVelocity(searchParams.get('velocity'));
    const wantVelocity = velocityShift > 0;

    // Snapshot-Pfad: gleiches Pattern wie /api/tft/comps. Wenn die Permutation
    // im Bundle steckt, sparen wir den RPC-Roundtrip. Velocity-Overlays werden
    // nicht vorgerendert → live RPC. Ein ausdruecklich gewaehlter Patch geht
    // ebenfalls live: die Bundles sind patchuebergreifend gerechnet, liegen
    // aber unter dem aufgeloesten Patch — sonst zaehlt „18.3" auch Vorpatch-Spiele.
    if (!wantVelocity && filters.patchFilter == null) {
      const hit = await lookupSnapshot('units', {
        patch: filters.patch,
        region: filters.regionLabel,
        days: filters.requestedDays,
        bucket: filters.bucketLabel,
        minGames: 0,
        setNumber: filters.setNumber,
        skip: isSnapshotPublisher(request),
      });
      // Guard 2026-06-21: kein leeres Snapshot-Bundle ausliefern → sonst
      // EmptyData trotz frischer DB-Daten. Siehe Pattern in /api/tft/comps.
      const payload = hit?.payload as { hasData?: boolean; units?: unknown[] } | undefined;
      if (hit && payload?.hasData && Array.isArray(payload.units) && payload.units.length > 0) {
        // Gespeicherte Bundles sind noch nach reinem Schnitt sortiert — hier
        // gleich wie im Live-Pfad nachsortieren (Kopie, der Cache bleibt unberuehrt).
        const units = [...payload.units] as { avgPlacement?: number | null; pickRate?: number | null }[];
        sortUnitsRareLast(units);
        const resp = cachedJson({ ...payload, units }, { cache: cacheControl });
        resp.headers.set('x-snapshot', hit.tag);
        return resp;
      }
    }

    // Item-Reihe: fuer Besucher optional (Fehler → Liste ohne Items). Der
    // Snapshot-Publisher bekommt mehr Zeit und laesst Fehler durchschlagen,
    // damit nie ein Bundle ohne Items gespeichert wird.
    const publisher = isSnapshotPublisher(request);
    const topItemsCall = callRpc<UnitTopItemRow[]>('get_tft_unit_top_items', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patchFilter,
      p_set: filters.setNumber,
      p_top: LIST_TOP_ITEMS,
    }, publisher ? 25_000 : undefined);

    // Trend-Anker nicht lesbar → kurze Cache-Zeit statt 6 h schiefer Pfeile.
    let trendAnchorDegraded = false;
    const [rows, velocityRows, topItemRows] = await Promise.all([
      callRpc<UnitListRow[]>('get_tft_unit_stats', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patchFilter,
        p_set: filters.setNumber,
      }),
      wantVelocity
        ? resolveTrendAnchorOffset(filters, patches).then(anchor => { trendAnchorDegraded = anchor.degraded; return callRpc<UnitVelocityRow[]>('get_tft_unit_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patchFilter,
            p_days: filters.requestedDays,
            p_shift_days: velocityShift,
            p_anchor_offset_days: anchor.offset,
            p_min_games: 30,
          }); }).catch(() => [] as UnitVelocityRow[])
        : Promise.resolve([] as UnitVelocityRow[]),
      publisher ? topItemsCall : topItemsCall.catch(() => [] as UnitTopItemRow[]),
    ]);

    // RPC liefert pro Champion schon sortiert (Spiele absteigend) und gekappt.
    const topItemsByCid = new Map<string, { item: string; games: number }[]>();
    for (const t of topItemRows) {
      const list = topItemsByCid.get(t.character_id) ?? [];
      if (list.length < LIST_TOP_ITEMS) list.push({ item: t.item, games: Number(t.games) });
      topItemsByCid.set(t.character_id, list);
    }

    const participants = rows[0]?.participants || 0;
    const velocityByCid = new Map<string, UnitVelocityRow>();
    for (const v of velocityRows) velocityByCid.set(v.character_id, v);

    const units = rows
      .filter(r => !isExcludedUnit(r.character_id))
      .map(r => {
        // Win/Top4 Share — MetaTFT-equivalent. Same `participants` denominator
        // used for pickRate above (sum of player-instances across the filter
        // set). computeShares applies the 8-players-per-match conversion and
        // returns null when the sample is below threshold.
        const shares = computeShares({
          top1: Number(r.top1),
          top4: Number(r.top4),
          participants: Number(participants),
        });
        const base = {
          characterId: r.character_id,
          games: Number(r.games),
          avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
          top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
          top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
          pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
          winShare: shares.winShare,
          top4Share: shares.top4Share,
          topItems: topItemsByCid.get(r.character_id) ?? [],
        };
        if (!wantVelocity) return base;
        const v = velocityByCid.get(r.character_id);
        if (!v) return base;
        const gNow = Number(v.games_now);
        const gPrev = Number(v.games_prev);
        const pNow = Number(v.participants_now);
        const pPrev = Number(v.participants_prev);
        const avgNow = gNow > 0 ? Number(v.sum_placement_now) / gNow : null;
        const avgPrev = gPrev > 0 ? Number(v.sum_placement_prev) / gPrev : null;
        const top4Now = gNow > 0 ? Number(v.top4_now) / gNow : null;
        const top4Prev = gPrev > 0 ? Number(v.top4_prev) / gPrev : null;
        const pickNow = pNow > 0 ? gNow / pNow : null;
        const pickPrev = pPrev > 0 ? gPrev / pPrev : null;
        const canDelta = gPrev >= VELOCITY_MIN_GAMES && gNow >= VELOCITY_MIN_GAMES;
        return {
          ...base,
          velocity: {
            gamesNow: gNow,
            gamesPrev: gPrev,
            avgPlaceNow: avgNow,
            avgPlacePrev: avgPrev,
            deltaAvgPlace: canDelta && avgNow != null && avgPrev != null ? avgNow - avgPrev : null,
            top4RateNow: top4Now,
            top4RatePrev: top4Prev,
            deltaTop4Rate: canDelta && top4Now != null && top4Prev != null ? top4Now - top4Prev : null,
            pickRateNow: pickNow,
            pickRatePrev: pickPrev,
            deltaPickRate: canDelta && pickNow != null && pickPrev != null ? pickNow - pickPrev : null,
            isNew: gPrev < 5 && gNow >= VELOCITY_MIN_GAMES,
          },
        };
      });
    sortUnitsRareLast(units);

    return cachedJson({
      hasData: units.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        requestedDays: filters.requestedDays,
        patch: filters.patch,
        patchFilter: filters.patchFilter,
        patchStartDay: filters.patchStartDay,
        set: filters.setNumber,
        velocityShift: wantVelocity ? velocityShift : null,
        anchorOffsetDays: filters.anchorOffsetDays,
      },
      patches,
      units,
    }, { cache: trendAnchorDegraded ? DEGRADED_CACHE_CONTROL : cacheControl });
  } catch (e: any) {
    // Trifft v. a. Trend-Anfragen, die am Bundle vorbei live laufen: dann
    // lieber die Liste ohne Trend als eine leere Seite. Nie fuer den Publisher.
    if (fallbackFilters && !isSnapshotPublisher(request)) {
      const fb = await lookupFallbackSnapshot('units', 'units', fallbackFilters);
      if (fb) {
        console.error('[api/tft/units] Live fehlgeschlagen, Rueckfall', fb.tag, ':', e?.message ?? e);
        const units = [...(fb.payload.units as { avgPlacement?: number | null; pickRate?: number | null }[])];
        sortUnitsRareLast(units);
        const resp = cachedJson({ ...fb.payload, units }, { cache: DEGRADED_CACHE_CONTROL });
        resp.headers.set(FALLBACK_HEADER, fb.tag);
        return resp;
      }
    }
    return NextResponse.json({ hasData: false, units: [], error: e.message }, { status: 502 });
  }
}

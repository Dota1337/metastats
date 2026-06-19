import { NextRequest, NextResponse } from 'next/server';
import { callRpc, getAvailablePatches, BUCKET_GROUPS } from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';

// /api/tft/patch-diff?patch=17.2&prev=17.1&entity=unit|item|trait
//
// Returns each entity's avg-placement / pick-rate / top4 delta between the
// two patches. The diff is computed in-process from two RPC calls (one per
// patch) rather than a SQL JOIN — keeps the existing RPCs reusable and the
// payload small.
//
// `prev` defaults to the second-newest patch in `available_patches`. If
// fewer than 2 patches exist we return an empty `winners` / `losers` so
// the UI can render a "Komm in ein paar Tagen wieder" empty state instead
// of an error.

type Entity = 'unit' | 'item' | 'trait' | 'comp';

interface UnitRow { character_id: string; games: number; sum_placement: number; top4: number; top1: number; participants: number }
interface ItemRow { api_name: string; games: number; sum_placement: number; top4: number; total_item_slots: number }
interface TraitRow { name: string; activation: number | string; games: number; sum_placement: number; top4: number; participants: number }
interface CompRow { cluster_key: string; games: number; sum_placement: number; top4: number; top1: number; participants: number }

interface DiffEntry {
  key: string;
  currentGames: number;
  previousGames: number;
  currentAvgPlacement: number;
  previousAvgPlacement: number;
  deltaAvgPlacement: number;        // negative = better in current patch
  currentPickRate: number;
  previousPickRate: number;
  deltaPickRate: number;
  currentTop4Rate: number;
  previousTop4Rate: number;
  deltaTop4Rate: number;
}

const MIN_GAMES = 50;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const entity = (searchParams.get('entity') || 'unit').toLowerCase() as Entity;
  if (!['unit', 'item', 'trait', 'comp'].includes(entity)) {
    return NextResponse.json({ error: 'invalid entity' }, { status: 400 });
  }
  const region = searchParams.get('region');
  const bucketParam = searchParams.get('bucket') || 'master_plus';
  // Expand group names ('master_plus','all','pro_pool') to the real bucket
  // values stored in the stats tables — the RPC matches bucket = ANY(...),
  // and there are no rows literally tagged 'master_plus'.
  const buckets = BUCKET_GROUPS[bucketParam] || [bucketParam];

  try {
    const patches = await getAvailablePatches(180);
    if (patches.length === 0) {
      return cachedJson({ hasData: false, winners: [], losers: [], patches: [], reason: 'no_patches' });
    }
    const currentPatch = searchParams.get('patch') || patches[0].patch;
    const previousPatch = searchParams.get('prev') || (patches[1]?.patch ?? null);
    if (!previousPatch || currentPatch === previousPatch) {
      // Single-patch state — the pipeline hasn't accumulated a previous
      // version yet. Return the current entity stats so the UI can show
      // them as a "current only" baseline.
      return cachedJson({
        hasData: false, winners: [], losers: [],
        patches, currentPatch, previousPatch: null, reason: 'single_patch',
      });
    }

    const setNumber = patches.find(p => p.patch === currentPatch)?.set_number
                    ?? patches[0].set_number;
    const regions = region ? [region] : null;

    const [curr, prev] = await Promise.all([
      fetchEntityRows(entity, currentPatch, setNumber, regions, buckets),
      fetchEntityRows(entity, previousPatch, setNumber, regions, buckets),
    ]);

    const prevMap = new Map(prev.map(r => [r.key, r]));
    const diffs: DiffEntry[] = [];
    for (const c of curr) {
      const p = prevMap.get(c.key);
      if (!p) continue;
      if (c.games < MIN_GAMES || p.games < MIN_GAMES) continue;
      const cAvg = c.sum_placement / c.games;
      const pAvg = p.sum_placement / p.games;
      const cPick = c.participants > 0 ? c.games / c.participants : 0;
      const pPick = p.participants > 0 ? p.games / p.participants : 0;
      const cTop4 = c.top4 / c.games;
      const pTop4 = p.top4 / p.games;
      diffs.push({
        key: c.key,
        currentGames: c.games,
        previousGames: p.games,
        currentAvgPlacement: cAvg,
        previousAvgPlacement: pAvg,
        deltaAvgPlacement: cAvg - pAvg,
        currentPickRate: cPick,
        previousPickRate: pPick,
        deltaPickRate: cPick - pPick,
        currentTop4Rate: cTop4,
        previousTop4Rate: pTop4,
        deltaTop4Rate: cTop4 - pTop4,
      });
    }

    // Winners = avg placement got better (lower) by the largest amount.
    // Losers = avg placement got worse (higher).
    const winners = [...diffs].sort((a, b) => a.deltaAvgPlacement - b.deltaAvgPlacement).slice(0, 15);
    const losers  = [...diffs].sort((a, b) => b.deltaAvgPlacement - a.deltaAvgPlacement).slice(0, 15);

    return cachedJson({
      hasData: diffs.length > 0,
      currentPatch,
      previousPatch,
      entity,
      patches,
      sampleSize: diffs.length,
      winners,
      losers,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, winners: [], losers: [], error: e.message }, { status: 502 });
  }
}

interface Normalized {
  key: string;
  games: number;
  sum_placement: number;
  top4: number;
  participants: number;
}

async function fetchEntityRows(
  entity: Entity,
  patch: string,
  setNumber: number | null,
  regions: string[] | null,
  buckets: string[],
): Promise<Normalized[]> {
  const regionsArg = regions || ['all'];
  // For 'all' region the RPC expects the full list — but we use a sentinel
  // and let the SQL match on a wildcard. The reader resolves 'all' through
  // its filter helper; here we just pass the literal so the RPC's ANY()
  // clause matches each crawled region individually.
  // ph2/th2 raus — leer im TFT-Crawl (siehe tft-supabase-reader.ts).
  const allRegions = ['euw1', 'eun1', 'kr', 'na1', 'br1', 'jp1', 'la1', 'la2', 'oc1', 'tr1', 'ru', 'me1', 'sg2', 'tw2', 'vn2'];
  const effectiveRegions = regions ? regions : allRegions;

  const base = {
    p_regions: effectiveRegions,
    p_buckets: buckets,
    p_days: 30,
    p_patch: patch,
    p_set: setNumber,
  };

  if (entity === 'unit') {
    const rows = await callRpc<UnitRow[]>('get_tft_unit_stats', base);
    const participants = Number(rows[0]?.participants || 0);
    return rows.map(r => ({
      key: r.character_id,
      games: Number(r.games),
      sum_placement: Number(r.sum_placement),
      top4: Number(r.top4),
      participants,
    }));
  }
  if (entity === 'item') {
    // Use the lean RPC (Migration 0028) — the non-lean get_tft_item_stats
    // does jsonb_agg of top_users for EVERY item × day combo, which 57014-
    // times out on Supabase at 30d windows. The lean variant aggregates the
    // top_users once at the end; same diff math, sub-second response.
    const rows = await callRpc<ItemRow[]>('get_tft_item_stats_list', base);
    const participants = Number(rows[0]?.total_item_slots || 0);
    return rows.map(r => ({
      key: r.api_name,
      games: Number(r.games),
      sum_placement: Number(r.sum_placement),
      top4: Number(r.top4),
      participants,
    }));
  }
  if (entity === 'trait') {
    const rows = await callRpc<TraitRow[]>('get_tft_trait_stats', base);
    const participants = Number(rows[0]?.participants || 0);
    // Collapse per-activation rows so we have one entry per trait name. We
    // sum across activation levels because the "did this trait get
    // buffed/nerfed?" question doesn't care which activation triggered it.
    const byName = new Map<string, Normalized>();
    for (const r of rows) {
      const cur = byName.get(r.name) || { key: r.name, games: 0, sum_placement: 0, top4: 0, participants };
      cur.games += Number(r.games);
      cur.sum_placement += Number(r.sum_placement);
      cur.top4 += Number(r.top4);
      byName.set(r.name, cur);
    }
    return [...byName.values()];
  }
  // entity === 'comp' — super-lean diff RPC (migration 0035), scalar-only.
  // The list RPC carried 10 MB of jsonb_agg per call for fields we drop here.
  const rows = await callRpc<CompRow[]>('get_tft_comp_stats_for_diff', {
    ...base,
    p_min_games: 50,
  });
  const participants = Number(rows[0]?.participants || 0);
  return rows.map(r => ({
    key: r.cluster_key,
    games: Number(r.games),
    sum_placement: Number(r.sum_placement),
    top4: Number(r.top4),
    participants,
  }));
}

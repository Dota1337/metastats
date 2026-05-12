import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
} from '../../../lib/tft-supabase-reader';

// /api/tft/comps
// List view: returns aggregated comp clusters that match the filter set.
// Detail view (slug=…): looks up that specific cluster + its counter edges
//   from the comp-pair table.
// `source` param kept for backwards compatibility — only "data" is supported
// today; "editorial" stays as an empty list until that table exists.

const VALID_SOURCES = new Set(['data', 'editorial', 'all']);

interface CompRow {
  cluster_key: string;
  games: number;
  sum_placement: number;
  top4: number;
  top1: number;
  sum_level: number;
  sum_last_round: number;
  participants: number;
  typical_units_merged: any[][];
  typical_augments_merged: any[][];
  carry_items_merged: any[][];
}

interface CompPairRow {
  a_key: string;
  b_key: string;
  games: number;
  a_better: number;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceRaw = (searchParams.get('source') || 'data').toLowerCase();
  const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'data';
  const slug = searchParams.get('slug');
  const minGames = Math.max(0, parseInt(searchParams.get('minGames') || '30', 10));

  try {
    const filters = await resolveFilters(searchParams);
    const rows = await callRpc<CompRow[]>('get_tft_comp_stats', {
      p_regions: filters.regions,
      p_buckets: filters.buckets,
      p_days: filters.days,
      p_patch: filters.patch,
      p_set: filters.setNumber,
      p_min_games: minGames,
    });
    const participants = rows[0]?.participants || 0;
    const dataComps = rows.map(r => {
      const typicalUnits = mergeJsonbCountArrays(r.typical_units_merged || [], 'characterId', 9);
      const typicalAugments = mergeJsonbCountArrays(r.typical_augments_merged || [], 'apiName', 6);
      const carryItems = mergeCarryItems(r.carry_items_merged || []);
      return {
        source: 'data',
        slug: r.cluster_key,
        clusterKey: r.cluster_key,
        games: Number(r.games),
        avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
        top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
        top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
        pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
        avgLevel: r.games > 0 && r.sum_level ? Number(r.sum_level) / Number(r.games) : null,
        avgLastRound: r.games > 0 && r.sum_last_round ? Number(r.sum_last_round) / Number(r.games) : null,
        typicalUnits,
        typicalAugments,
        carryItems,
      };
    });
    dataComps.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    if (slug) {
      const comp = dataComps.find(c => c.slug === slug);
      if (!comp) return NextResponse.json({ filters, hasData: false, comp: null });

      // Counter edges — single RPC for the same region/day/patch window.
      const pairs = await callRpc<CompPairRow[]>('get_tft_comp_pairs', {
        p_regions: filters.regions,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: 10,
      });
      const beats: any[] = [];
      const losesTo: any[] = [];
      for (const p of pairs) {
        const winRate = p.games > 0 ? Number(p.a_better) / Number(p.games) : 0.5;
        if (p.a_key === slug && winRate >= 0.55) {
          beats.push({ a: p.a_key, b: p.b_key, games: Number(p.games), aWinRate: winRate });
        }
        if (p.b_key === slug && winRate <= 0.45) {
          // sort flips so the frontend's "lost to" view uses the same shape
          losesTo.push({ a: p.a_key, b: p.b_key, games: Number(p.games), aWinRate: winRate });
        }
      }
      beats.sort((a, b) => b.aWinRate - a.aWinRate);
      losesTo.sort((a, b) => a.aWinRate - b.aWinRate);

      return NextResponse.json({
        filters,
        hasData: true,
        comp: { ...comp, counters: { beats: beats.slice(0, 5), losesTo: losesTo.slice(0, 5) } },
      });
    }

    const patches = await getAvailablePatches();
    return NextResponse.json({
      hasData: dataComps.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
      },
      patches,
      minGames,
      source,
      comps: source === 'editorial' ? [] : dataComps,
    });
  } catch (e: any) {
    return NextResponse.json({ hasData: false, comps: [], error: e.message }, { status: 502 });
  }
}

// Merge per-day carry-items lists ([{items:[…], count}, …]) into a single
// top-N by count. Key on the sorted-tuple representation of the items list.
function mergeCarryItems(arrays: any[]): { items: string[]; count: number }[] {
  const map = new Map<string, { items: string[]; count: number }>();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const e of arr) {
      const items = Array.isArray(e?.items) ? [...e.items].sort() : [];
      if (items.length === 0) continue;
      const key = items.join('|');
      const cur = map.get(key) || { items, count: 0 };
      cur.count += Number(e.count ?? 0);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 3);
}

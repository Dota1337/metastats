import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
  mergeJsonbCountDicts,
} from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';

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
  sum_players_eliminated: number;
  participants: number;
  typical_units_merged: any[][];
  typical_augments_merged: any[][];
  carry_items_merged: any[][];
  last_round_dist_merged: any[] | null;
  top4_by_round_merged: any[] | null;
  level_dist_merged: any[] | null;
  level_sum_last_round_merged: any[] | null;
  // { bucket: { games, sum_placement } } from migration 0017 — for Skill-Cap.
  bucket_breakdown: Record<string, { games: number; sum_placement: number }> | null;
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
      // Sprint 6.3 — Comp-Flex-Score. Normalized entropy of the top-9 unit
      // distribution: 0 = locked (single dominant unit), 1 = fully even.
      // High flex = pivot-friendly comp; low flex = exact-hit dependent.
      const flexScore = (() => {
        const total = typicalUnits.reduce((s, u) => s + (u.count || 0), 0);
        if (total <= 0 || typicalUnits.length === 0) return null;
        let h = 0;
        for (const u of typicalUnits) {
          const p = (u.count || 0) / total;
          if (p > 0) h -= p * Math.log(p);
        }
        const maxH = Math.log(typicalUnits.length);
        return maxH > 0 ? h / maxH : null;
      })();
      // Aggro-Index (Sprint 2.1): kills per game, attributed by the comp's
      // typical pattern. High = push/streak comp, low = econ-coast comp.
      const aggroIndex = r.games > 0 && r.sum_players_eliminated
        ? Number(r.sum_players_eliminated) / Number(r.games)
        : null;
      // Leveling-Tempo-Curves (Sprint 2.2): per-final-level distribution +
      // avg death-round per level. UI plots "at lvl 8 you die at round X".
      const lvlGames = mergeJsonbCountDicts(r.level_dist_merged || []);
      const lvlSumRound = mergeJsonbCountDicts(r.level_sum_last_round_merged || []);
      const totalLevelGames = Object.values(lvlGames).reduce((s, n) => s + n, 0);
      const levelingTempo = Object.keys(lvlGames)
        .map(k => Number(k))
        .filter(n => Number.isFinite(n) && n >= 1 && n <= 11)
        .sort((a, b) => a - b)
        .map(level => {
          const g = lvlGames[String(level)] || 0;
          const sumRound = lvlSumRound[String(level)] || 0;
          return {
            level,
            games: g,
            share: totalLevelGames > 0 ? g / totalLevelGames : null,
            avgLastRound: g > 0 ? sumRound / g : null,
          };
        });
      // Skill-Cap-Index (Sprint 2.3): variance of avgPlacement across
      // rank-buckets (only buckets with ≥ 20 games). Higher = comp performs
      // very differently per skill level → execution-dependent.
      const buckets = r.bucket_breakdown || {};
      const bucketAvgs: { bucket: string; games: number; avgPlacement: number }[] = [];
      for (const [bk, v] of Object.entries(buckets)) {
        if (!v || (v as any).games < 20) continue;
        const games = Number((v as any).games);
        const sumP = Number((v as any).sum_placement);
        bucketAvgs.push({ bucket: bk, games, avgPlacement: sumP / games });
      }
      let skillCapIndex: number | null = null;
      let skillCapBuckets: typeof bucketAvgs = [];
      if (bucketAvgs.length >= 2) {
        const min = Math.min(...bucketAvgs.map(b => b.avgPlacement));
        const max = Math.max(...bucketAvgs.map(b => b.avgPlacement));
        skillCapIndex = max - min;
        skillCapBuckets = bucketAvgs.sort((a, b) => {
          const order = ['challenger','grandmaster','master','master_plus','diamond','emerald','platinum','gold','silver','bronze','iron','all','pro_pool'];
          return order.indexOf(a.bucket) - order.indexOf(b.bucket);
        });
      }

      // Death-round histogram + survival→top4 conditional.
      const roundGames = mergeJsonbCountDicts(r.last_round_dist_merged || []);
      const roundTop4 = mergeJsonbCountDicts(r.top4_by_round_merged || []);
      const totalGames = Number(r.games) || 0;
      const totalTop4 = Number(r.top4) || 0;
      const roundsSorted = Object.keys(roundGames)
        .map(k => Number(k))
        .filter(n => Number.isFinite(n) && n > 0)
        .sort((a, b) => a - b);
      const roundHistogram = roundsSorted.map(round => ({
        round,
        games: roundGames[String(round)] || 0,
        top4: roundTop4[String(round)] || 0,
      }));
      // Survival curve: at each round r, P(top4 | last_round ≥ r). This is
      // the actionable read — "if I'm still alive at round r in this comp,
      // what's my top4 probability?"
      let cumGames = totalGames;
      let cumTop4 = totalTop4;
      const survivalToTop4 = roundsSorted.map(round => {
        const point = {
          round,
          atLeast: cumGames,
          top4Rate: cumGames > 0 ? cumTop4 / cumGames : null,
        };
        cumGames -= (roundGames[String(round)] || 0);
        cumTop4 -= (roundTop4[String(round)] || 0);
        return point;
      });
      return {
        source: 'data',
        slug: r.cluster_key,
        clusterKey: r.cluster_key,
        games: totalGames,
        avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
        top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
        top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
        pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
        avgLevel: r.games > 0 && r.sum_level ? Number(r.sum_level) / Number(r.games) : null,
        avgLastRound: r.games > 0 && r.sum_last_round ? Number(r.sum_last_round) / Number(r.games) : null,
        typicalUnits,
        typicalAugments,
        carryItems,
        roundHistogram,
        survivalToTop4,
        aggroIndex,
        levelingTempo,
        skillCapIndex,
        skillCapBuckets,
        flexScore,
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

      return cachedJson({
        filters,
        hasData: true,
        comp: { ...comp, counters: { beats: beats.slice(0, 5), losesTo: losesTo.slice(0, 5) } },
      });
    }

    const patches = await getAvailablePatches();
    return cachedJson({
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

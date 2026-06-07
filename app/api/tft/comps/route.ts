import { NextRequest, NextResponse } from 'next/server';
import {
  resolveFilters,
  callRpc,
  getAvailablePatches,
  mergeJsonbCountArrays,
  mergeJsonbCountDicts,
} from '../../../lib/tft-supabase-reader';
import { cachedJson } from '../../../lib/api-cache';
import { isExcludedUnit, isExcludedItem } from '../../../lib/tft-excluded';

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
  sum_gold_left: number;
  participants: number;
  typical_units_merged: any[][];
  typical_augments_merged: any[][];
  carry_items_merged: any[][];
  last_round_dist_merged: any[] | null;
  top4_by_round_merged: any[] | null;
  level_dist_merged: any[] | null;
  level_sum_last_round_merged: any[] | null;
  // W3-A: jsonb-agg of per-day carry_star_dist objects. Each daily row ships
  // { "1": {games, sumPlacement, top4, top1}, "2": …, "3": … } — array-merge
  // sums per star key here in the API.
  carry_star_dist_merged: any[] | null;
  // W4-B: jsonb-agg of per-day contested_dist objects. Same shape as
  // carry_star_dist but keys are contested-level (1=solo, 2=one rival, 3=2+).
  contested_dist_merged: any[] | null;
  // { bucket: { games, sum_placement } } from migration 0017 — for Skill-Cap.
  bucket_breakdown: Record<string, { games: number; sum_placement: number }> | null;
}

interface CompPairRow {
  a_key: string;
  b_key: string;
  games: number;
  a_better: number;
}

interface VelocityRow {
  cluster_key: string;
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

interface CompVelocity {
  gamesNow: number;
  gamesPrev: number;
  avgPlaceNow: number | null;
  avgPlacePrev: number | null;
  deltaAvgPlace: number | null;
  pickRateNow: number | null;
  pickRatePrev: number | null;
  deltaPickRate: number | null;
  top4RateNow: number | null;
  top4RatePrev: number | null;
  deltaTop4Rate: number | null;
  // true when the cluster appeared in now-window but not in prev — usually
  // means "new comp" (post-patch surge) and shouldn't be ranked by Δ at all.
  isNew: boolean;
}

// Minimum games per window for Δ to be considered statistically meaningful.
// Below that, the row keeps its raw now/prev counts but Δs are nulled — UI
// then renders an "—" / "NEW" badge rather than misleading noise.
const VELOCITY_MIN_PREV_GAMES = 30;

function deriveVelocity(v: VelocityRow): CompVelocity {
  const gn = Number(v.games_now);
  const gp = Number(v.games_prev);
  const pn = Number(v.participants_now);
  const pp = Number(v.participants_prev);
  const avgN = gn > 0 ? Number(v.sum_placement_now) / gn : null;
  const avgP = gp > 0 ? Number(v.sum_placement_prev) / gp : null;
  const pickN = pn > 0 ? gn / pn : null;
  const pickP = pp > 0 ? gp / pp : null;
  const t4N = gn > 0 ? Number(v.top4_now) / gn : null;
  const t4P = gp > 0 ? Number(v.top4_prev) / gp : null;
  const canDelta = gp >= VELOCITY_MIN_PREV_GAMES && gn >= VELOCITY_MIN_PREV_GAMES;
  return {
    gamesNow: gn,
    gamesPrev: gp,
    avgPlaceNow: avgN,
    avgPlacePrev: avgP,
    deltaAvgPlace: canDelta && avgN != null && avgP != null ? avgN - avgP : null,
    pickRateNow: pickN,
    pickRatePrev: pickP,
    deltaPickRate: canDelta && pickN != null && pickP != null ? pickN - pickP : null,
    top4RateNow: t4N,
    top4RatePrev: t4P,
    deltaTop4Rate: canDelta && t4N != null && t4P != null ? t4N - t4P : null,
    isNew: gp < 5 && gn >= 30,
  };
}

interface CounterEdge {
  opponent: string;   // cluster_key of the other comp
  games: number;
  winRate: number;    // this comp's win-rate vs `opponent` (0–1)
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sourceRaw = (searchParams.get('source') || 'data').toLowerCase();
  const source = VALID_SOURCES.has(sourceRaw) ? sourceRaw : 'data';
  const slug = searchParams.get('slug');
  const minGames = Math.max(0, parseInt(searchParams.get('minGames') || '30', 10));

  try {
    const filters = await resolveFilters(searchParams);

    // Detail view: full metrics (death-curve, comp-DNA, matchups) for the one
    // matched cluster only. These are heavy per row — entropy, variance and
    // several jsonb-dict merges — and the list never reads them, so we don't
    // compute them for every cluster (see baseComp vs enrichComp below).
    // The full RPC aggregates all 7 jsonb columns; only the detail path needs
    // the 4 detail-only ones, so the list path below uses the lean variant.
    if (slug) {
      const rows = await callRpc<CompRow[]>('get_tft_comp_stats', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: minGames,
      });
      const participants = rows[0]?.participants || 0;
      let row = rows.find(r => r.cluster_key === slug);
      let aliasedFrom: string | null = null;
      // Core-Comp Consolidation: 1-3 unit / activation-level Varianten einer
      // Comp sind keine eigenständigen Comps (User-Vorgabe). Wenn der exakte
      // slug im aktuellen Window keine Daten hat, suchen wir nach Geschwistern
      // mit identischem Trait-Root UND Carry — also `<trait>@<x>_<carry>` für
      // alle x — und nehmen den mit den meisten Games. Der Fallback gilt nur
      // wenn die ähnliche Variante ≥ 50 Spiele hat; sonst echt "noch keine
      // Daten" und nicht aufdrängen.
      if (!row) {
        const m = /^(.+)@(\d+)_(.+)$/.exec(slug);
        if (m) {
          const sameCore = rows
            .filter(r => {
              const rm = /^(.+)@(\d+)_(.+)$/.exec(r.cluster_key);
              return rm && rm[1] === m[1] && rm[3] === m[3] && Number(r.games) >= 50;
            })
            .sort((a, b) => Number(b.games) - Number(a.games));
          if (sameCore.length > 0) {
            row = sameCore[0];
            aliasedFrom = slug;
          }
        }
      }
      if (!row) return cachedJson({ filters, hasData: false, comp: null });
      const comp = { ...baseComp(row, participants), ...enrichComp(row), aliasedFrom };

      // Counter edges — single RPC for the same region/day/patch window.
      const pairs = await callRpc<CompPairRow[]>('get_tft_comp_pairs', {
        p_regions: filters.regions,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: 10,
      });
      const beats: CounterEdge[] = [];
      const losesTo: CounterEdge[] = [];
      const even: CounterEdge[] = [];
      for (const p of pairs) {
        if (p.a_key !== slug && p.b_key !== slug) continue;
        const aWinRate = p.games > 0 ? Number(p.a_better) / Number(p.games) : 0.5;
        // Normalize so winRate is always THIS comp's win-rate vs the opponent,
        // regardless of which side it sits on in the sorted (a_key,b_key) pair.
        const selfIsA = p.a_key === slug;
        const edge: CounterEdge = {
          opponent: selfIsA ? p.b_key : p.a_key,
          games: Number(p.games),
          winRate: selfIsA ? aWinRate : 1 - aWinRate,
        };
        if (edge.winRate >= 0.55) beats.push(edge);
        else if (edge.winRate <= 0.45) losesTo.push(edge);
        else even.push(edge);   // 45–55% band — the near-even matchups
      }
      beats.sort((a, b) => b.winRate - a.winRate);
      losesTo.sort((a, b) => a.winRate - b.winRate);
      // Even matchups ranked by sample size — the most-played coin-flips are
      // the most decision-relevant.
      even.sort((a, b) => b.games - a.games);

      return cachedJson({
        filters,
        hasData: true,
        comp: {
          ...comp,
          counters: {
            beats: beats.slice(0, 5),
            losesTo: losesTo.slice(0, 5),
            even: even.slice(0, 5),
          },
        },
      });
    }

    // List view: lean RPC — aggregates only the 3 jsonb columns the list
    // renders (typical_units / augments / carry_items), skipping the 4
    // detail-only jsonb_agg merges. Measured ~12x faster cold (1847ms→152ms)
    // since the heavy detail jsonb is never detoasted or aggregated here.
    //
    // Optional velocity layer (W1-A): with ?velocity=N we fire a second RPC
    // in parallel and merge Δs (avg-place, pickrate, top4) into each row so
    // the listing can sort/visualise "what shifted in the last N days". N is
    // the shift between now-window (last `days` days) and prev-window.
    const velocityShift = Math.max(0, parseInt(searchParams.get('velocity') || '0', 10));
    const wantVelocity = velocityShift > 0;

    const [rows, velocityRows] = await Promise.all([
      callRpc<CompRow[]>('get_tft_comp_stats_list', {
        p_regions: filters.regions,
        p_buckets: filters.buckets,
        p_days: filters.days,
        p_patch: filters.patch,
        p_set: filters.setNumber,
        p_min_games: minGames,
      }),
      wantVelocity
        ? callRpc<VelocityRow[]>('get_tft_comp_velocity', {
            p_regions: filters.regions,
            p_buckets: filters.buckets,
            p_set: filters.setNumber,
            p_patch: filters.patch,
            p_days: filters.days,
            p_shift_days: velocityShift,
            // Allow newer entries with only a current-window sample to surface
            // as "NEW" rather than being filtered out for lacking a baseline.
            p_min_games: Math.max(10, Math.floor(minGames / 3)),
          }).catch(() => [] as VelocityRow[])
        : Promise.resolve([] as VelocityRow[]),
    ]);

    const participants = rows[0]?.participants || 0;
    const velocityByKey = new Map<string, VelocityRow>();
    for (const v of velocityRows) velocityByKey.set(v.cluster_key, v);

    const dataComps = rows.map(r => {
      const base = baseComp(r, participants);
      const v = velocityByKey.get(r.cluster_key);
      if (!v) return base;
      return { ...base, velocity: deriveVelocity(v) };
    });
    dataComps.sort((a, b) => (a.avgPlacement ?? 9) - (b.avgPlacement ?? 9));

    const patches = await getAvailablePatches();
    return cachedJson({
      hasData: dataComps.length > 0,
      filters: {
        region: filters.regionLabel,
        bucket: filters.bucketLabel,
        days: filters.days,
        patch: filters.patch,
        set: filters.setNumber,
        velocityShift: wantVelocity ? velocityShift : null,
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

// Lean per-comp shape — base stats + the unit/augment/carry tiles that the
// comp LIST (CompRow) and landing CompCard render. No derived metrics.
function baseComp(r: CompRow, participants: number) {
  return {
    source: 'data' as const,
    slug: r.cluster_key,
    clusterKey: r.cluster_key,
    games: Number(r.games) || 0,
    avgPlacement: r.games > 0 ? Number(r.sum_placement) / Number(r.games) : null,
    top4Rate: r.games > 0 ? Number(r.top4) / Number(r.games) : null,
    top1Rate: r.games > 0 ? Number(r.top1) / Number(r.games) : null,
    pickRate: participants > 0 ? Number(r.games) / Number(participants) : null,
    avgLevel: r.games > 0 && r.sum_level ? Number(r.sum_level) / Number(r.games) : null,
    avgLastRound: r.games > 0 && r.sum_last_round ? Number(r.sum_last_round) / Number(r.games) : null,
    typicalUnits: mergeJsonbCountArrays(r.typical_units_merged || [], 'characterId', 9, [
      { field: 'topItems', innerKey: 'apiName', topN: 3 },
    ]).filter(u => !isExcludedUnit((u as any).characterId)),
    typicalAugments: mergeJsonbCountArrays(r.typical_augments_merged || [], 'apiName', 6),
    carryItems: mergeCarryItems(r.carry_items_merged || []),
  };
}

// Detail-only derived metrics: Comp-DNA (flex / aggro / leveling / skill-cap)
// + the death-round histogram and survival→top4 curve. Heavy enough that we
// only run it for the single cluster a detail request asks for.
function enrichComp(r: CompRow) {
  const typicalUnits = mergeJsonbCountArrays(r.typical_units_merged || [], 'characterId', 9, [
    { field: 'topItems', innerKey: 'apiName', topN: 3 },
  ]).filter(u => !isExcludedUnit((u as any).characterId));
  // Sprint 6.3 — Comp-Flex-Score. Normalized entropy of the top-9 unit
  // distribution: 0 = locked (single dominant unit), 1 = fully even.
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
  // Aggro-Index (Sprint 2.1): kills per game.
  const aggroIndex = r.games > 0 && r.sum_players_eliminated
    ? Number(r.sum_players_eliminated) / Number(r.games)
    : null;
  // Comp-Eco: avg gold left when the game ended. Low = spent out / all-in,
  // high = over-econ'd (or died early sitting on gold). Backfills from the
  // next crawl — null on pre-0024 rows so the UI just hides it.
  const avgGoldLeft = r.games > 0 && r.sum_gold_left
    ? Number(r.sum_gold_left) / Number(r.games)
    : null;
  // Leveling-Tempo-Curves (Sprint 2.2): per-final-level distribution +
  // avg death-round per level.
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
  // Skill-Cap-Index (Sprint 2.3): spread of avgPlacement across rank-buckets
  // (only buckets with ≥ 20 games). Higher = execution-dependent.
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
  // Survival curve: at each round r, P(top4 | last_round ≥ r).
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
  // W3-A: Carry-Star outcome — merge the per-day jsonb dicts into a per-star
  // summary (games, avgPlacement, top4Rate, top1Rate). Reroll comps show
  // dramatically better numbers at 3★ than at 2★; pros use the gap to decide
  // whether to slow-roll a level or push 8.
  const carryStarOutcome: { star: number; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null }[] = [];
  const csMerged: Record<string, { games: number; sumPlacement: number; top4: number; top1: number }> = {};
  for (const dayDict of (r.carry_star_dist_merged || [])) {
    if (!dayDict || typeof dayDict !== 'object' || Array.isArray(dayDict)) continue;
    for (const [star, e] of Object.entries(dayDict as Record<string, any>)) {
      if (!e || typeof e !== 'object') continue;
      const cur = csMerged[star] || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      cur.games += Number(e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.top4 += Number(e.top4 ?? 0);
      cur.top1 += Number(e.top1 ?? 0);
      csMerged[star] = cur;
    }
  }
  for (const star of [1, 2, 3]) {
    const e = csMerged[String(star)];
    if (!e || e.games === 0) continue;
    carryStarOutcome.push({
      star,
      games: e.games,
      avgPlacement: e.sumPlacement / e.games,
      top4Rate: e.top4 / e.games,
      top1Rate: e.top1 / e.games,
    });
  }
  // W4-B: Contested-Distribution — per "how many lobby players forced this
  // comp" bucket {games, sumPlacement, top4, top1}. Solo = 1, one rival = 2,
  // 2+ rivals = 3 (capped to keep the UI from listing a long tail).
  const contestedOutcome: { contested: number; games: number; avgPlacement: number | null; top4Rate: number | null; top1Rate: number | null }[] = [];
  const cnMerged: Record<string, { games: number; sumPlacement: number; top4: number; top1: number }> = {};
  for (const dayDict of (r.contested_dist_merged || [])) {
    if (!dayDict || typeof dayDict !== 'object' || Array.isArray(dayDict)) continue;
    for (const [level, e] of Object.entries(dayDict as Record<string, any>)) {
      if (!e || typeof e !== 'object') continue;
      const cur = cnMerged[level] || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
      cur.games += Number(e.games ?? 0);
      cur.sumPlacement += Number(e.sumPlacement ?? e.sum_placement ?? 0);
      cur.top4 += Number(e.top4 ?? 0);
      cur.top1 += Number(e.top1 ?? 0);
      cnMerged[level] = cur;
    }
  }
  for (const lvl of [1, 2, 3]) {
    const e = cnMerged[String(lvl)];
    if (!e || e.games === 0) continue;
    contestedOutcome.push({
      contested: lvl,
      games: e.games,
      avgPlacement: e.sumPlacement / e.games,
      top4Rate: e.top4 / e.games,
      top1Rate: e.top1 / e.games,
    });
  }
  return { roundHistogram, survivalToTop4, aggroIndex, avgGoldLeft, levelingTempo, skillCapIndex, skillCapBuckets, flexScore, carryStarOutcome, contestedOutcome };
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

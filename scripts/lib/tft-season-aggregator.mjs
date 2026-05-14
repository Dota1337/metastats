// Roll per-player Set-of-matches into the tft_player_season_stats table.
//
// One row per (puuid, region, set_number). Rebuilt on every crawl run from
// the player's full set of cached matches — cheap because it's a single
// SQL scan plus arithmetic, and writes one upsert.

const TOP_N_HOT_COMPS = 10;

/**
 * @param {import('pg').Pool | import('pg').PoolClient} db
 * @param {string} puuid
 * @param {string} region
 * @param {number} setNumber
 * @param {{ matches: any[], hotCompKeys?: Set<string>, recommendedItems?: Record<string, Set<string>> }} ctx
 *        matches: the TftMatchSnapshot[] for this set (from listSeasonMatches)
 *        hotCompKeys: top-N hot comps from the patch KG (optional)
 *        recommendedItems: per-unit recommended item set (optional)
 */
export async function upsertSeasonStats(db, puuid, region, setNumber, ctx) {
  const matches = ctx.matches;
  if (matches.length === 0) {
    await db.query(
      `insert into tft_player_season_stats (puuid, region, set_number, sample_size, updated_at)
         values ($1, $2, $3, 0, now())
       on conflict (puuid, region, set_number) do update
         set sample_size = 0, updated_at = now()`,
      [puuid, region, setNumber],
    );
    return { sampleSize: 0 };
  }

  // Core placement-derived stats
  const placements = matches.map(m => m.placement).filter(p => p > 0);
  const n = placements.length;
  const avgPlace = placements.reduce((a, b) => a + b, 0) / n;
  const top4 = placements.filter(p => p <= 4).length / n;
  const top1 = placements.filter(p => p === 1).length / n;
  const bottom4 = placements.filter(p => p >= 5).length / n;
  const mean = avgPlace;
  const variance = placements.reduce((s, p) => s + (p - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(variance);

  // Longest top-4 streak (chronological — `listSeasonMatches` returns newest
  // first, so reverse for streak detection to be intuitive).
  const chrono = [...placements].reverse();
  let bestStreak = 0, current = 0;
  for (const p of chrono) {
    if (p <= 4) { current++; bestStreak = Math.max(bestStreak, current); }
    else current = 0;
  }

  // Comp diversity + dominance
  const compKeys = matches.map(m => m.comp?.clusterKey).filter(Boolean);
  const uniqueComps = new Set(compKeys);
  const dominantCount = compKeys.length > 0
    ? Math.max(...[...uniqueComps].map(k => compKeys.filter(c => c === k).length))
    : 0;
  const dominantShare = compKeys.length > 0 ? dominantCount / compKeys.length : 0;

  // Meta-pick share (hotCompKeys from KG)
  let metaPickShare = null;
  if (ctx.hotCompKeys && ctx.hotCompKeys.size > 0 && compKeys.length > 0) {
    const hits = compKeys.filter(k => ctx.hotCompKeys.has(k)).length;
    metaPickShare = hits / compKeys.length;
  }

  // Item-slam score (KG recommendedItems lookup)
  let itemSlamScore = null;
  if (ctx.recommendedItems) {
    let scored = 0, sum = 0;
    for (const m of matches) {
      const carry = m.comp?.carryUnit;
      const items = m.comp?.carryItems || [];
      if (!carry || items.length === 0) continue;
      const rec = ctx.recommendedItems[carry];
      if (!rec || rec.size === 0) continue;
      sum += items.filter(i => rec.has(i)).length / Math.max(1, items.length);
      scored++;
    }
    if (scored >= 5) itemSlamScore = sum / scored;
  }

  // first/last match timestamps from the chrono list
  const ts = matches.map(m => Number(m.gameDatetime || 0)).filter(t => t > 0).sort();
  const firstMatch = ts.length > 0 ? new Date(ts[0]) : null;
  const lastMatch  = ts.length > 0 ? new Date(ts[ts.length - 1]) : null;

  await db.query(
    `insert into tft_player_season_stats (
       puuid, region, set_number, sample_size, avg_placement, top4_rate, top1_rate,
       bottom4_rate, placement_stddev, best_top4_streak, unique_comps,
       dominant_share, meta_pick_share, item_slam_score, first_match_at,
       last_match_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
     on conflict (puuid, region, set_number) do update set
       sample_size       = excluded.sample_size,
       avg_placement     = excluded.avg_placement,
       top4_rate         = excluded.top4_rate,
       top1_rate         = excluded.top1_rate,
       bottom4_rate      = excluded.bottom4_rate,
       placement_stddev  = excluded.placement_stddev,
       best_top4_streak  = excluded.best_top4_streak,
       unique_comps      = excluded.unique_comps,
       dominant_share    = excluded.dominant_share,
       meta_pick_share   = excluded.meta_pick_share,
       item_slam_score   = excluded.item_slam_score,
       first_match_at    = excluded.first_match_at,
       last_match_at     = excluded.last_match_at,
       updated_at        = now()`,
    [
      puuid, region, setNumber, n,
      avgPlace.toFixed(3),
      top4.toFixed(4),
      top1.toFixed(4),
      bottom4.toFixed(4),
      stddev.toFixed(3),
      bestStreak,
      uniqueComps.size,
      dominantShare.toFixed(4),
      metaPickShare != null ? metaPickShare.toFixed(4) : null,
      itemSlamScore != null ? itemSlamScore.toFixed(4) : null,
      firstMatch,
      lastMatch,
    ],
  );
  return {
    sampleSize: n, avgPlace, top4Rate: top4, top1Rate: top1, stddev, bestStreak,
    uniqueComps: uniqueComps.size, dominantShare, metaPickShare, itemSlamScore,
  };
}

// Helper to derive hotCompKeys from a raw patch knowledge graph (same logic
// as buildMetaKgSlice in scripts/lib/tft-marketvalue.mjs). Kept here so the
// crawler can build it once per region and reuse for every player.
export function buildHotCompKeys(kg, topN = TOP_N_HOT_COMPS) {
  if (!kg?.edges?.compToUnit) return null;
  const compCounts = {};
  for (const e of kg.edges.compToUnit) {
    compCounts[e.comp] = (compCounts[e.comp] || 0) + (e.count || 0);
  }
  const hotKeys = Object.entries(compCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([k]) => k);
  return new Set(hotKeys);
}

export function buildRecommendedItems(kg, topPerUnit = 5) {
  if (!kg?.edges?.unitToItem) return null;
  const grouped = {};
  for (const e of kg.edges.unitToItem) {
    if (!grouped[e.unit]) grouped[e.unit] = [];
    grouped[e.unit].push({ item: e.item, games: e.games });
  }
  const out = {};
  for (const [unit, list] of Object.entries(grouped)) {
    list.sort((a, b) => b.games - a.games);
    out[unit] = new Set(list.slice(0, topPerUnit).map(x => x.item));
  }
  return out;
}

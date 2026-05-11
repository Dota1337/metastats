import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { refreshPlayerCache, loadCachedMatches, listCachedSets } from '../../../lib/tft-player-cache';
import { ensureRankHistoryBackfilled, type SeasonRank } from '../../../lib/tft-rank-history';
import { getRegionalRouting } from '../../../lib/regions';
import { isExcludedUnit } from '../../../lib/tft-excluded';

// Player season-stats endpoint.
// Reads from tft_player_match_cache. On every request we refresh the cache
// against Riot (incremental — only new matches are fetched), then aggregate
// from the cache.
//
// First-ever visit for a player: ~50s wall time (Riot's 200/10s match-detail
// method limit caps the burst). Every visit after that: ~1-2s because we
// only fetch the handful of new matches since last visit.
//
// Side effect: the cache survives Riot's per-puuid 1000-id history cap. Once
// a match is cached we keep it, so the stats can include games older than
// what Riot's match-v1 list still returns.

export const maxDuration = 60;

const STANDARD_RANKED_QUEUE = 1100;

function getCurrentSet(): number | null {
  try {
    const path = join(process.cwd(), 'public', 'tft-set.json');
    if (!existsSync(path)) return null;
    const meta = JSON.parse(readFileSync(path, 'utf8'));
    return typeof meta?.setNumber === 'number' ? meta.setNumber : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid');
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) return NextResponse.json({ error: 'Riot API Key fehlt' }, { status: 503 });
  if (!puuid) return NextResponse.json({ error: 'puuid required' }, { status: 400 });

  const currentSet = getCurrentSet();
  // ?set=16 lets the page switch to a previous set without re-fetching Riot —
  // the cache already holds every Set N match that ever survived a refresh.
  // Defaults to the current set so existing callers keep working.
  const setParam = searchParams.get('set');
  const targetSet = setParam != null && setParam !== ''
    ? Number(setParam)
    : currentSet;

  // 1) Refresh cache only when we're asking for the current set — for past
  // sets the cache is the source of truth (Riot's history no longer
  // contains those matches at scale).
  if (targetSet === currentSet) {
    try {
      await refreshPlayerCache(puuid, region, { riotApiKey: apiKey });
    } catch (e: any) {
      return NextResponse.json({ error: `cache refresh failed: ${e.message}` }, { status: 502 });
    }
  }

  // 2) Read the player's cached matches for the target set + Solo Ranked.
  const cached = await loadCachedMatches(puuid, {
    setNumber: targetSet,
    queueId: STANDARD_RANKED_QUEUE,
  });

  // 3) Available sets — every Set N that has any cached match. UI uses this
  // to show only the pills the player actually has data for.
  const availableSets = await listCachedSets(puuid);

  // 4) Historical season ranks — backfilled once from metatft, cached
  // forever in our own table. We need the player's Riot ID (gameName +
  // tagLine) for the metatft URL; cheaper to look it up here than to
  // require the frontend to pass it on every call.
  let seasonRanks: SeasonRank[] = [];
  try {
    const regional = getRegionalRouting(region);
    const accRes = await fetch(
      `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${apiKey}`,
    );
    if (accRes.ok) {
      const acc = await accRes.json();
      seasonRanks = await ensureRankHistoryBackfilled(
        puuid, region, acc.gameName || '', acc.tagLine || '',
      );
    }
  } catch (e) {
    // Backfill failures are non-fatal — endpoint still returns current-set stats.
    console.warn('rank-history backfill error:', e);
  }

  if (cached.length === 0) {
    return NextResponse.json({
      hasStats: false,
      region,
      puuid,
      totalMatches: 0,
      set: targetSet,
      currentSet,
      availableSets,
      seasonRanks,
    });
  }

  // 3) Aggregate.
  let games = 0;
  let sumPlacement = 0;
  let top4 = 0;
  let top1 = 0;
  let sumLevel = 0;
  let sumGoldLeft = 0;
  let sumEliminations = 0;
  let sumDamage = 0;
  let sumLastRound = 0;
  const placementCounts = [0, 0, 0, 0, 0, 0, 0, 0];

  const unitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const augmentGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const traitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();

  for (const m of cached) {
    const placement = m.placement;
    games++;
    sumPlacement += placement;
    if (placement <= 4) top4++;
    if (placement === 1) top1++;
    if (placement >= 1 && placement <= 8) placementCounts[placement - 1]++;
    sumLevel += m.level;
    sumGoldLeft += m.gold_left;
    sumEliminations += m.players_eliminated;
    sumDamage += m.total_damage;
    sumLastRound += m.last_round;

    for (const u of m.units || []) {
      const cid = u.character_id;
      if (!cid || isExcludedUnit(cid)) continue;
      const e = unitGames.get(cid) || { games: 0, sumPlace: 0, top4: 0 };
      e.games++;
      e.sumPlace += placement;
      if (placement <= 4) e.top4++;
      unitGames.set(cid, e);
    }
    for (const a of m.augments || []) {
      if (!a) continue;
      const e = augmentGames.get(a) || { games: 0, sumPlace: 0, top4: 0 };
      e.games++;
      e.sumPlace += placement;
      if (placement <= 4) e.top4++;
      augmentGames.set(a, e);
    }
    for (const t of m.traits || []) {
      if (!t?.name) continue;
      const key = `${t.name}@${t.tier_current ?? 0}`;
      const e = traitGames.get(key) || { games: 0, sumPlace: 0, top4: 0 };
      e.games++;
      e.sumPlace += placement;
      if (placement <= 4) e.top4++;
      traitGames.set(key, e);
    }
  }

  function topN<T extends { games: number; sumPlace: number; top4: number }>(
    map: Map<string, T>, n: number, keyName: string,
  ) {
    return [...map.entries()]
      .filter(([, v]) => v.games >= 3)
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, n)
      .map(([key, v]) => ({
        [keyName]: key,
        games: v.games,
        avgPlacement: v.sumPlace / v.games,
        top4Rate: v.top4 / v.games,
      }));
  }

  const avgPlacement = sumPlacement / games;
  const avgLevel = sumLevel / games;
  const avgGoldLeft = sumGoldLeft / games;
  const avgEliminations = sumEliminations / games;
  const avgDamage = sumDamage / games;
  const avgLastRound = sumLastRound / games;

  const scores = {
    tempo:       clamp01((avgLevel - 6) / 3) * 100,
    aggression:  clamp01(avgEliminations / 7) * 100,
    damage:      clamp01(avgDamage / 200) * 100,
    survival:    clamp01((9 - avgPlacement) / 8) * 100,
    consistency: (top4 / games) * 100,
  };

  return NextResponse.json({
    hasStats: true,
    region,
    puuid,
    set: targetSet,
    currentSet,
    availableSets,
    seasonRanks,
    totalMatches: games,
    avgPlacement,
    top4Rate: top4 / games,
    top1Rate: top1 / games,
    placementDistribution: placementCounts,
    averages: {
      level: avgLevel,
      goldLeft: avgGoldLeft,
      eliminations: avgEliminations,
      damage: avgDamage,
      lastRound: avgLastRound,
    },
    scores,
    topUnits: topN(unitGames, 15, 'character_id').map((u: any) => ({
      characterId: u.character_id, games: u.games, avgPlacement: u.avgPlacement, top4Rate: u.top4Rate,
    })),
    topAugments: topN(augmentGames, 5, 'apiName'),
    topTraits: topN(traitGames, 5, 'key'),
  });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

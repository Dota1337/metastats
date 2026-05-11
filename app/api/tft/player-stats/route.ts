import { NextRequest, NextResponse } from 'next/server';
import { getRegionalRouting } from '../../../lib/regions';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Player season-stats endpoint.
// Aggregates over every match in the player's history for the current TFT
// set. Riot's match-v1 list endpoint caps at 200 IDs per request, so we
// paginate up to 5 pages (=1000 matches max). We stop early as soon as a
// page comes back empty OR every match on a page is from a previous set
// — anything older isn't part of the current season.
//
// Returns avg placement, top1/4 rates, per-axis play-style metrics
// (Tempo/Aggression/Survival/Consistency) for the radar chart, plus
// placement distribution histogram and top 10 units + top 5 augments.

const STANDARD_RANKED_QUEUE = 1100;
const PAGE_SIZE = 200;
const MAX_PAGES = 5;

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

  const regional = getRegionalRouting(region);
  const currentSet = getCurrentSet();

  // 1) Paginated match-ID fetch.
  const allIds: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const start = page * PAGE_SIZE;
    const r = await fetch(
      `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${PAGE_SIZE}&start=${start}&api_key=${apiKey}`,
    );
    if (!r.ok) break;
    const ids: string[] = await r.json();
    if (!Array.isArray(ids) || ids.length === 0) break;
    allIds.push(...ids);
    if (ids.length < PAGE_SIZE) break;   // last page
  }
  if (allIds.length === 0) {
    return NextResponse.json({ hasStats: false, region, puuid, totalMatches: 0, set: currentSet });
  }

  // 2) Match details in parallel batches of 30. ~50 req/s effective on prod
  //    key, so 1000 details land in ~20s. We walk through every ID Riot
  //    returned — an earlier early-exit on "out-of-set streak" was cutting
  //    off active players whose history straddles a set boundary, so we now
  //    just process the full list. Cost is bounded (Riot's history cap of
  //    1000 IDs total) so the worst-case wall time stays around 20-25s.
  const matches: any[] = [];
  for (let i = 0; i < allIds.length; i += 30) {
    const batch = allIds.slice(i, i + 30);
    const results = await Promise.all(batch.map(async id => {
      const r = await fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${apiKey}`);
      return r.ok ? r.json() : null;
    }));
    for (const m of results) if (m) matches.push(m);
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
  const placementCounts = [0, 0, 0, 0, 0, 0, 0, 0]; // index 0 = placement 1

  // Diagnostics so the frontend can surface "175 of 487 set-17 matches" if
  // Riot's 1000-id cap is limiting us.
  let inSetCount = 0;
  let rankedSoloInSet = 0;

  const unitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const augmentGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const traitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();

  for (const m of matches) {
    const info = m?.info;
    if (!info?.participants) continue;
    const queueId = info.queue_id ?? info.queueId;
    const inSet = currentSet == null || info.tft_set_number === currentSet;
    if (inSet) inSetCount++;
    if (inSet && queueId === STANDARD_RANKED_QUEUE) rankedSoloInSet++;
    if (queueId !== STANDARD_RANKED_QUEUE) continue;
    if (currentSet != null && info.tft_set_number !== currentSet) continue;
    const me = info.participants.find((p: any) => p.puuid === puuid);
    if (!me) continue;

    const placement = me.placement ?? 9;
    games++;
    sumPlacement += placement;
    if (placement <= 4) top4++;
    if (placement === 1) top1++;
    if (placement >= 1 && placement <= 8) placementCounts[placement - 1]++;

    sumLevel += me.level ?? 0;
    sumGoldLeft += me.gold_left ?? 0;
    sumEliminations += me.players_eliminated ?? 0;
    sumDamage += me.total_damage_to_players ?? 0;
    sumLastRound += me.last_round ?? 0;

    for (const u of me.units || []) {
      const cid = u.character_id;
      if (!cid) continue;
      const entry = unitGames.get(cid) || { games: 0, sumPlace: 0, top4: 0 };
      entry.games++;
      entry.sumPlace += placement;
      if (placement <= 4) entry.top4++;
      unitGames.set(cid, entry);
    }
    for (const a of me.augments || []) {
      if (!a) continue;
      const entry = augmentGames.get(a) || { games: 0, sumPlace: 0, top4: 0 };
      entry.games++;
      entry.sumPlace += placement;
      if (placement <= 4) entry.top4++;
      augmentGames.set(a, entry);
    }
    for (const t of me.traits || []) {
      if (!t?.name || (t.style ?? 0) === 0) continue;
      const key = `${t.name}@${t.tier_current ?? 0}`;
      const entry = traitGames.get(key) || { games: 0, sumPlace: 0, top4: 0 };
      entry.games++;
      entry.sumPlace += placement;
      if (placement <= 4) entry.top4++;
      traitGames.set(key, entry);
    }
  }

  if (games === 0) {
    return NextResponse.json({ hasStats: false, region, puuid, totalMatches: 0, set: currentSet });
  }

  // Top-N helper — players who only see a unit once or twice in their history
  // shouldn't show up in "most-played" lists, so we floor at 3 occurrences.
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

  // Play-style scores 0-100, calibrated to typical ranked TFT ranges.
  const scores = {
    tempo:       clamp01((avgLevel - 6) / 3) * 100,                  // 6→0, 9→100
    aggression:  clamp01(avgEliminations / 7) * 100,                 // max 7 elims
    damage:      clamp01(avgDamage / 200) * 100,                     // 200dmg ≈ scaling carry
    survival:    clamp01((9 - avgPlacement) / 8) * 100,              // 1st=100%, 8th=12.5%
    consistency: (top4 / games) * 100,                               // raw top-4 rate
  };

  return NextResponse.json({
    hasStats: true,
    region,
    puuid,
    set: currentSet,
    totalMatches: games,
    sampledMatches: matches.length,
    inSetMatches: inSetCount,         // every Set N match in Riot's history (any queue)
    rankedSoloInSet: rankedSoloInSet, // Solo ranked only, current set
    totalHistoryIds: allIds.length,   // ceiling that Riot's match-v1 returned
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
    topUnits: topN(unitGames, 10, 'characterId'),
    topAugments: topN(augmentGames, 5, 'apiName'),
    topTraits: topN(traitGames, 5, 'key'),
  });
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

import { NextRequest, NextResponse } from 'next/server';
import { getRegionalRouting } from '../../../lib/regions';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// Player season-stats endpoint.
// Returns aggregated stats over the player's recent match history, filtered
// to the current TFT set so cross-set stats don't get blended. Aggregates
// game count, avg placement, top 1/4 rates, and the player's most-played
// units / augments.
//
// Sample size: up to 200 most recent matches (Riot's per-call cap). For an
// active player mid-set that's roughly 30-90 days of solo-ranked games — the
// closest "all games of the season" we can hit without persistence. Once the
// daily Supabase crawler lands (Phase 1 of the filter refactor), this route
// will switch to reading from the player-history table for true full-season
// numbers without round-tripping Riot.

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

  const regional = getRegionalRouting(region);
  const currentSet = getCurrentSet();

  // 1) Pull up to 200 recent match IDs (Riot's cap per call).
  const idsRes = await fetch(
    `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=200&api_key=${apiKey}`,
  );
  if (!idsRes.ok) {
    return NextResponse.json({ error: `match list HTTP ${idsRes.status}`, hasStats: false }, { status: 502 });
  }
  const ids: string[] = await idsRes.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ hasStats: false, region, puuid, totalMatches: 0 });
  }

  // 2) Fetch match details in parallel batches of 30. Production TFT key
  //    handles ~50 req/s — 200 detail calls finish in ~4-8s of wall time.
  const batchSize = 30;
  const matches: any[] = [];
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(async id => {
      const r = await fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${apiKey}`);
      return r.ok ? r.json() : null;
    }));
    for (const m of results) if (m) matches.push(m);
  }

  // 3) Filter to current-set ranked games + the participant matching `puuid`.
  let games = 0;
  let sumPlacement = 0;
  let top4 = 0;
  let top1 = 0;
  const unitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const augmentGames = new Map<string, { games: number; sumPlace: number; top4: number }>();
  const traitGames = new Map<string, { games: number; sumPlace: number; top4: number }>();

  for (const m of matches) {
    const info = m?.info;
    if (!info?.participants) continue;
    if ((info.queue_id ?? info.queueId) !== STANDARD_RANKED_QUEUE) continue;
    const me = info.participants.find((p: any) => p.puuid === puuid);
    if (!me) continue;
    // Detect set from any unit's character_id prefix. Skip non-current-set matches.
    if (currentSet != null) {
      const sample = me.units?.[0]?.character_id || '';
      const setMatch = /^TFT(\d+)_/.exec(sample);
      if (setMatch && Number(setMatch[1]) !== currentSet) continue;
    }

    const placement = me.placement ?? 9;
    games++;
    sumPlacement += placement;
    if (placement <= 4) top4++;
    if (placement === 1) top1++;

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

  // Top-N: units & augments sorted by games (descending), then by avg placement.
  function topN<T extends { games: number; sumPlace: number; top4: number }>(
    map: Map<string, T>, n: number, keyName: string,
  ) {
    return [...map.entries()]
      .filter(([, v]) => v.games >= 3) // drop one-offs that just rode in another comp
      .sort((a, b) => b[1].games - a[1].games)
      .slice(0, n)
      .map(([key, v]) => ({
        [keyName]: key,
        games: v.games,
        avgPlacement: v.sumPlace / v.games,
        top4Rate: v.top4 / v.games,
      }));
  }

  return NextResponse.json({
    hasStats: true,
    region,
    puuid,
    set: currentSet,
    totalMatches: games,            // games included in stats (filtered)
    sampledMatches: matches.length, // raw matches we examined
    avgPlacement: sumPlacement / games,
    top4Rate: top4 / games,
    top1Rate: top1 / games,
    topUnits: topN(unitGames, 5, 'characterId'),
    topAugments: topN(augmentGames, 5, 'apiName'),
    topTraits: topN(traitGames, 5, 'key'),
  });
}

import { NextRequest, NextResponse } from 'next/server';
import { processMatch, toLegacyMatchData, extractParticipants, extractBans, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';

import { getRegionalRouting } from '../../lib/regions';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;
  const start = parseInt(searchParams.get('start') || '0', 10);
  const count = parseInt(searchParams.get('count') || '30', 10);
  const regional = getRegionalRouting(region);

  try {
    const matchListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${Math.min(count, 30)}&api_key=${apiKey}`
    );

    if (!matchListRes.ok) {
      return NextResponse.json({ error: 'Match History nicht gefunden' }, { status: 404 });
    }

    const matchIds: string[] = await matchListRes.json();

    const rawMatches = await Promise.all(
      matchIds.map(async (id) => {
        const res = await fetch(
          `https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${apiKey}`
        );
        return res.ok ? res.json() : null;
      })
    );

    const extended = rawMatches
      .filter(Boolean)
      .map(raw => processMatch(raw, puuid))
      .filter(Boolean);

    // Build participant + ban maps for detailed match view
    const participantsMap: Record<string, any> = {};
    const bansMap: Record<string, any> = {};
    for (const raw of rawMatches.filter(Boolean)) {
      if (!raw?.metadata?.matchId) continue;
      participantsMap[raw.metadata.matchId] = extractParticipants(raw);
      bansMap[raw.metadata.matchId] = extractBans(raw);
    }

    // Return both extended data and legacy format for backwards compatibility
    const legacy = (extended as ExtendedMatchData[]).map(m => ({
      ...toLegacyMatchData(m!),
      participants: participantsMap[m!.matchId] || [],
      bans: bansMap[m!.matchId] || [],
    }));
    const statsOverview = calculateStatsOverview(extended as ExtendedMatchData[], null);

    return NextResponse.json({ matches: legacy, extended, statsOverview });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

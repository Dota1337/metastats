import { NextRequest, NextResponse } from 'next/server';
import { processMatch, toLegacyMatchData, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';

const REGIONAL: Record<string, string> = {
  euw1: 'europe',
  eun1: 'europe',
  na1: 'americas',
  kr: 'asia',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;
  const regional = REGIONAL[region] || 'europe';

  try {
    const matchListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=30&api_key=${apiKey}`
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

    // Return both extended data and legacy format for backwards compatibility
    const legacy = extended.map(m => toLegacyMatchData(m!));
    const statsOverview = calculateStatsOverview(extended as ExtendedMatchData[], null);

    return NextResponse.json({ matches: legacy, extended, statsOverview });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

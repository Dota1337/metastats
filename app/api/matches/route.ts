import { NextRequest, NextResponse } from 'next/server';

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

    const matches = await Promise.all(
      matchIds.map(async (id) => {
        const res = await fetch(
          `https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${apiKey}`
        );
        return res.ok ? res.json() : null;
      })
    );

    const filtered = matches.filter(Boolean).map((match) => {
      const participant = match.info.participants.find(
        (p: any) => p.puuid === puuid
      );
      return {
        matchId: match.metadata.matchId,
        champion: participant?.championName,
        kills: participant?.kills,
        deaths: participant?.deaths,
        assists: participant?.assists,
        win: participant?.win,
        gameDuration: match.info.gameDuration,
        gameMode: match.info.gameMode,
        cs: (participant?.totalMinionsKilled || 0) + (participant?.neutralMinionsKilled || 0),
        role: participant?.individualPosition || participant?.teamPosition || 'UNKNOWN',
        damageDealt: participant?.totalDamageDealtToChampions || 0,
        visionScore: participant?.visionScore || 0,
        wardsPlaced: participant?.wardsPlaced || 0,
        firstBloodKill: participant?.firstBloodKill || false,
        firstBloodAssist: participant?.firstBloodAssist || false,
        firstBloodVictim: participant?.firstBloodVictim || false,
        dragonKills: participant?.dragonKills || 0,
        baronKills: participant?.baronKills || 0,
        turretKills: participant?.turretKills || 0,
        objectivesStolen: participant?.objectivesStolen || 0,
        gameWonFromBehind: (participant?.wasLosing && participant?.win) || false,
        surrendered: participant?.gameEndedInSurrender || false,
      };
    });

    return NextResponse.json({ matches: filtered });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
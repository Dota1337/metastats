import { NextRequest, NextResponse } from 'next/server';
import { parseRegion } from '../../lib/regions';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const apiKey = process.env.RIOT_API_KEY!;

  if (!puuid) {
    return NextResponse.json({ error: 'puuid ist erforderlich' }, { status: 400 });
  }

  // Ungueltige Region nie cachen — sonst klebt die 400 an der Edge.
  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const res = await fetch(
      `https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${puuid}?api_key=${apiKey}`
    );

    if (res.status === 404) {
      return NextResponse.json({ inGame: false });
    }

    if (!res.ok) {
      return NextResponse.json({ error: 'Spectator-Daten nicht verfügbar' }, { status: res.status });
    }

    const gameData = await res.json();

    return NextResponse.json({ inGame: true, gameData });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

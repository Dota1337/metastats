import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;

  if (!puuid) {
    return NextResponse.json({ error: 'puuid ist erforderlich' }, { status: 400 });
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

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
      `https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=5&api_key=${apiKey}`
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Champion Mastery nicht gefunden' }, { status: 404 });
    }

    const masteries = await res.json();

    return NextResponse.json({ masteries });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

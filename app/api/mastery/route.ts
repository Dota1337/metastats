import { NextRequest, NextResponse } from 'next/server';
import { parseRegion } from '../../lib/regions';
import { riotFetch } from '../../lib/riot-fetch';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const apiKey = process.env.RIOT_API_KEY!;

  if (!puuid) {
    return NextResponse.json({ error: 'puuid ist erforderlich' }, { status: 400 });
  }

  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const res = await riotFetch(`https://${region}.api.riotgames.com/lol/champion-mastery/v4/champion-masteries/by-puuid/${puuid}/top?count=5`, apiKey);

    if (!res.ok) {
      return NextResponse.json({ error: 'Champion Mastery nicht gefunden' }, { status: 404 });
    }

    const masteries = await res.json();

    return NextResponse.json({ masteries });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

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
      if (res.status === 404) {
        return NextResponse.json({ error: 'Champion Mastery nicht gefunden' }, { status: 404 });
      }
      // Limit, Schluessel- oder Riot-Ausfall ist kein „nicht gefunden".
      const code = res.status === 429 ? 'rate_limited' : (res.status === 401 || res.status === 403) ? 'riot_auth' : 'riot_upstream';
      return NextResponse.json(
        { error: `Riot API Fehler (${res.status})`, code },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const masteries = await res.json();

    return NextResponse.json({ masteries });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

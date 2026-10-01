import { NextRequest, NextResponse } from 'next/server';
import { parseRegion } from '../../lib/regions';
import { riotFetch } from '../../lib/riot-fetch';

// Riot-Stoerung ist kein „nicht im Spiel“: 503 und nie cachen, damit das Profil
// „gerade nicht erreichbar“ zeigen kann statt eines Riot-Status (429/5xx) oder 500.
const unavailable = () => NextResponse.json(
  { error: 'Live-Spiel gerade nicht erreichbar' },
  { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '30' } },
);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const puuid = searchParams.get('puuid') || '';
  const region = parseRegion(searchParams.get('region'), { fallback: 'euw1' });
  const apiKey = process.env.RIOT_API_KEY!;

  if (!puuid) {
    return NextResponse.json({ error: 'puuid ist erforderlich' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  // Ungueltige Region nie cachen — sonst klebt die 400 an der Edge.
  if (!region) {
    return NextResponse.json(
      { error: 'Ungültige Region' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  try {
    const res = await riotFetch(`https://${region}.api.riotgames.com/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(puuid)}`, apiKey);

    if (res.status === 404) {
      return NextResponse.json({ inGame: false }, { headers: { 'Cache-Control': 'no-store' } });
    }

    // Schluessel ohne Spectator-Recht: Funktion fehlt, nicht nur kurz weg.
    if (res.status === 401 || res.status === 403) {
      return NextResponse.json({ error: 'Spectator-Daten nicht freigegeben' }, { status: 403, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!res.ok) return unavailable();

    const gameData = await res.json();

    return NextResponse.json({ inGame: true, gameData }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return unavailable();
  }
}

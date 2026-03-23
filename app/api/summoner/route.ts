import { NextRequest, NextResponse } from 'next/server';

const REGIONAL: Record<string, string> = {
  euw1: 'europe',
  eun1: 'europe',
  na1: 'americas',
  kr: 'asia',
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;
  const regional = REGIONAL[region] || 'europe';

  const decoded = decodeURIComponent(name);
  const parts = decoded.split('#');
  const gameName = parts[0].trim();
  const tagLine = parts[1]?.trim() || 'EUW';

  try {
    const accountRes = await fetch(
      `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${apiKey}`
    );

    if (!accountRes.ok) {
      return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });
    }

    const account = await accountRes.json();

    const summonerRes = await fetch(
      `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${account.puuid}?api_key=${apiKey}`
    );

    if (!summonerRes.ok) {
      return NextResponse.json({ error: 'Summoner nicht gefunden' }, { status: 404 });
    }

    const summoner = await summonerRes.json();

    const rankedRes = await fetch(
      `https://${region}.api.riotgames.com/lol/league/v4/entries/by-summoner/${summoner.id}?api_key=${apiKey}`
    );
    const ranked = rankedRes.ok ? await rankedRes.json() : [];

    return NextResponse.json({
      summoner: { ...summoner, name: `${account.gameName}#${account.tagLine}` },
      ranked
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
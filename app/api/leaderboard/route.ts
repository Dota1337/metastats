import { NextResponse } from 'next/server';

export async function GET() {
  const apiKey = process.env.RIOT_API_KEY!;

  try {
    const res = await fetch(
      `https://euw1.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`
    );

    if (!res.ok) {
      return NextResponse.json({ error: 'Daten nicht verfügbar' }, { status: 403 });
    }

    const data = await res.json();

    const top10 = data.entries
      .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints)
      .slice(0, 10);

    const entries = [];
    for (let i = 0; i < top10.length; i++) {
      const e = top10[i];
      try {
        const summonerRes = await fetch(
          `https://euw1.api.riotgames.com/lol/summoner/v4/summoners/${e.summonerId}?api_key=${apiKey}`
        );
        const summoner = await summonerRes.json();
        const accountRes = await fetch(
          `https://europe.api.riotgames.com/riot/account/v1/accounts/by-puuid/${summoner.puuid}?api_key=${apiKey}`
        );
        const account = await accountRes.json();
        entries.push({
          rank: i + 1,
          summonerName: account.gameName + '#' + account.tagLine,
          slug: account.gameName.replace(/ /g, '-') + '-' + account.tagLine,
          leaguePoints: e.leaguePoints,
          wins: e.wins,
          losses: e.losses,
          winrate: Math.round((e.wins / (e.wins + e.losses)) * 100),
        });
      } catch {
        entries.push({
          rank: i + 1,
          summonerName: 'Unbekannt',
          slug: 'unbekannt',
          leaguePoints: e.leaguePoints,
          wins: e.wins,
          losses: e.losses,
          winrate: Math.round((e.wins / (e.wins + e.losses)) * 100),
        });
      }
    }

    return NextResponse.json({ tier: data.tier, entries });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
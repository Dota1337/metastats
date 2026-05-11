import { NextRequest, NextResponse } from 'next/server';
import { getRegionalRouting } from '../../../lib/regions';

// /api/tft/leaderboard?region=euw1&tier=CHALLENGER
// Pulls a TFT ranked ladder slice from Riot. The crawler doesn't pre-build
// this — we go to Riot live each request because the data is small (top
// few hundred players per tier) and changes constantly.

const VALID_TIERS = new Set(['CHALLENGER', 'GRANDMASTER', 'MASTER']);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = (searchParams.get('region') || 'euw1').toLowerCase();
  const tier = (searchParams.get('tier') || 'CHALLENGER').toUpperCase();
  const apiKey = process.env.RIOT_API_KEY_TFT;
  if (!apiKey) {
    return NextResponse.json({ error: 'Riot API Key fehlt', code: 'no_key' }, { status: 503 });
  }
  if (!VALID_TIERS.has(tier)) {
    return NextResponse.json({ error: `Tier ${tier} nicht unterstützt — nur Master, Grandmaster, Challenger.`, code: 'bad_tier' }, { status: 400 });
  }

  const path = `https://${region}.api.riotgames.com/tft/league/v1/${tier.toLowerCase()}?api_key=${apiKey}`;
  try {
    const res = await fetch(path);
    if (!res.ok) {
      return NextResponse.json({ error: `Riot API Fehler (${res.status})` }, { status: 502 });
    }
    const league = await res.json();
    const entries = (league.entries || [])
      .filter((e: any) => e.puuid)
      .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints)
      .slice(0, 200);

    // Resolve riot IDs in parallel batches of 20
    const idMap: Record<string, { gameName: string; tagLine: string }> = {};
    const regional = getRegionalRouting(region);
    for (let i = 0; i < entries.length; i += 20) {
      const batch = entries.slice(i, i + 20);
      await Promise.all(batch.map(async (e: any) => {
        try {
          const r = await fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${e.puuid}?api_key=${apiKey}`);
          if (r.ok) idMap[e.puuid] = await r.json();
        } catch {}
      }));
    }

    const players = entries.map((e: any, idx: number) => ({
      rank: idx + 1,
      puuid: e.puuid,
      gameName: idMap[e.puuid]?.gameName || null,
      tagLine: idMap[e.puuid]?.tagLine || null,
      tier: e.tier || tier,
      leaguePoints: e.leaguePoints,
      wins: e.wins,
      losses: e.losses,
    }));

    return NextResponse.json({ region, tier, players });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

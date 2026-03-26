import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'all';
  const tier = searchParams.get('tier') || 'CHALLENGER';
  const search = searchParams.get('search') || '';

  try {
    // Search mode: find players by name
    if (search.trim()) {
      const { data: searchResults } = await supabase
        .from('players')
        .select('summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id')
        .ilike('summoner_name', `%${search}%`)
        .order('market_value', { ascending: false, nullsFirst: false })
        .limit(20);

      return NextResponse.json({
        entries: (searchResults || []).map((p, i) => ({
          rank: i + 1,
          summonerName: p.summoner_name,
          region: p.region,
          tier: p.tier,
          playerRank: p.rank,
          winrate: p.winrate || 0,
          marketValue: p.market_value,
          level: p.summoner_level,
          profileIcon: p.profile_icon_id,
        })),
        source: 'search',
        tier: null,
      });
    }

    // Leaderboard mode: fetch from Supabase (players we already have)
    let query = supabase
      .from('players')
      .select('summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id');

    // Filter by tier
    if (tier === 'CHALLENGER') {
      query = query.eq('tier', 'CHALLENGER');
    } else if (tier === 'GRANDMASTER') {
      query = query.eq('tier', 'GRANDMASTER');
    } else if (tier === 'MASTER') {
      query = query.eq('tier', 'MASTER');
    }

    // Filter by region
    if (region !== 'all') {
      query = query.eq('region', region);
    }

    const { data: players, error: dbError } = await query
      .order('market_value', { ascending: false, nullsFirst: false })
      .limit(50);

    if (dbError) {
      // Fallback: try Riot API if Supabase fails
      return NextResponse.json({ error: 'Datenbank nicht verfügbar', entries: [] }, { status: 500 });
    }

    const entries = (players || []).map((p, i) => ({
      rank: i + 1,
      summonerName: p.summoner_name || 'Unbekannt',
      region: p.region,
      tier: p.tier,
      playerRank: p.rank,
      winrate: p.winrate || 0,
      marketValue: p.market_value,
      level: p.summoner_level,
      profileIcon: p.profile_icon_id,
    }));

    // If we have no data in Supabase, try Riot API as discovery
    if (entries.length === 0) {
      const apiKey = process.env.RIOT_API_KEY;
      if (apiKey) {
        const riotEntries = await fetchFromRiot(apiKey, region !== 'all' ? region : 'euw1', tier);
        if (riotEntries.length > 0) {
          return NextResponse.json({ entries: riotEntries, source: 'riot', tier });
        }
      }

      return NextResponse.json({
        entries: [],
        source: 'empty',
        tier,
        message: 'Noch keine Spieler in dieser Kategorie. Suche Spieler um Daten aufzubauen.',
      });
    }

    return NextResponse.json({ entries, source: 'database', tier });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler', entries: [] }, { status: 500 });
  }
}

async function fetchFromRiot(apiKey: string, region: string, tier: string): Promise<any[]> {
  const REGIONAL: Record<string, string> = {
    euw1: 'europe', eun1: 'europe', na1: 'americas', kr: 'asia',
  };
  const regional = REGIONAL[region] || 'europe';

  const tierEndpoint = tier === 'GRANDMASTER' ? 'grandmasterleagues' : tier === 'MASTER' ? 'masterleagues' : 'challengerleagues';

  try {
    const res = await fetch(
      `https://${region}.api.riotgames.com/lol/league/v4/${tierEndpoint}/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`
    );
    if (!res.ok) return [];

    const data = await res.json();
    const top = data.entries
      .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints)
      .slice(0, 20);

    const entries = [];
    for (let i = 0; i < Math.min(top.length, 10); i++) {
      const e = top[i];
      try {
        // Use puuid directly (summonerId is deprecated)
        const puuid = e.puuid;
        if (!puuid) continue;

        const [accRes, sumRes] = await Promise.all([
          fetch(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${apiKey}`),
          fetch(`https://${region}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${puuid}?api_key=${apiKey}`),
        ]);
        if (!accRes.ok) continue;
        const account = await accRes.json();
        const summoner = sumRes.ok ? await sumRes.json() : {};

        if (!account.gameName) continue;

        entries.push({
          rank: i + 1,
          summonerName: `${account.gameName}#${account.tagLine}`,
          region,
          tier: data.tier,
          playerRank: e.rank,
          winrate: Math.round((e.wins / (e.wins + e.losses)) * 100),
          marketValue: null,
          level: summoner.summonerLevel || 0,
          profileIcon: summoner.profileIconId || 0,
          leaguePoints: e.leaguePoints,
        });
      } catch { continue; }
    }
    return entries;
  } catch { return []; }
}

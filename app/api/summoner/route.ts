import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';

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
  const fullName = `${gameName}#${tagLine}`;

  try {
    // Supabase Cache prüfen
    const { data: cached } = await supabase
      .from('players')
      .select('*')
      .eq('summoner_name', fullName)
      .eq('region', region)
      .single();

    if (cached) {
      const updatedAt = new Date(cached.updated_at).getTime();
      const now = Date.now();
      const fiveMinutes = 5 * 60 * 1000;

      if (now - updatedAt < fiveMinutes) {
        const { data: rankedData } = await supabase
          .from('ranked_stats')
          .select('*')
          .eq('player_id', cached.id);

        return NextResponse.json({
          summoner: {
            name: cached.summoner_name,
            summonerLevel: cached.summoner_level,
            profileIconId: cached.profile_icon_id,
            puuid: cached.puuid,
          },
          ranked: rankedData || [],
          fromCache: true,
        });
      }
    }

    // Riot API aufrufen
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

    // In Supabase speichern
    const { data: player, error: playerError } = await supabase
      .from('players')
      .upsert({
        summoner_name: fullName,
        summoner_id: summoner.id,
        puuid: account.puuid,
        region: region,
        summoner_level: summoner.summonerLevel,
        profile_icon_id: summoner.profileIconId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'puuid' })
      .select()
      .single();

    if (!playerError && player && Array.isArray(ranked) && ranked.length > 0) {
      const soloQueue = ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5');
      if (soloQueue) {
        await supabase
          .from('ranked_stats')
          .upsert({
            player_id: player.id,
            queue_type: soloQueue.queueType,
            tier: soloQueue.tier,
            rank: soloQueue.rank,
            league_points: soloQueue.leaguePoints,
            wins: soloQueue.wins,
            losses: soloQueue.losses,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'player_id' });
      }
    }

    return NextResponse.json({
      summoner: { ...summoner, name: fullName },
      ranked: Array.isArray(ranked) ? ranked : [],
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}
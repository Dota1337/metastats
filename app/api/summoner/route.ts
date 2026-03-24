import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../lib/supabase';
import { calculateMarketValue } from '../../lib/marketvalue';

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

        const mapped = (rankedData || []).map((r: any) => ({
          queueType: r.queue_type,
          tier: r.tier,
          rank: r.rank,
          leaguePoints: r.league_points,
          wins: r.wins,
          losses: r.losses,
        }));

        return NextResponse.json({
          summoner: {
            name: cached.summoner_name,
            summonerLevel: cached.summoner_level,
            profileIconId: cached.profile_icon_id,
            puuid: cached.puuid,
          },
          ranked: mapped,
          fromCache: true,
        });
      }
    }

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

    const soloQueue = Array.isArray(ranked)
      ? ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
      : null;

    const matchListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=30&api_key=${apiKey}`
    );
    const matchIds: string[] = matchListRes.ok ? await matchListRes.json() : [];

    const matchDetails = await Promise.all(
      matchIds.slice(0, 10).map(async (id) => {
        const res = await fetch(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${apiKey}`);
        return res.ok ? res.json() : null;
      })
    );

    const matches = matchDetails.filter(Boolean).map((match) => {
      const participant = match.info.participants.find((p: any) => p.puuid === account.puuid);
      const teamId = participant?.teamId;
      const teammates = match.info.participants.filter((p: any) => p.teamId === teamId);
      const teamKills = teammates.reduce((s: number, p: any) => s + (p.kills || 0), 0);
      const teamDamage = teammates.reduce((s: number, p: any) => s + (p.totalDamageDealtToChampions || 0), 0);
      const teamGold = teammates.reduce((s: number, p: any) => s + (p.goldEarned || 0), 0);
      return {
        kills: participant?.kills || 0,
        deaths: participant?.deaths || 0,
        assists: participant?.assists || 0,
        win: participant?.win || false,
        gameDuration: match.info.gameDuration,
        cs: (participant?.totalMinionsKilled || 0) + (participant?.neutralMinionsKilled || 0),
        role: participant?.individualPosition || 'UNKNOWN',
        damageDealt: participant?.totalDamageDealtToChampions || 0,
        visionScore: participant?.visionScore || 0,
        wardsPlaced: participant?.wardsPlaced || 0,
        firstBloodKill: participant?.firstBloodKill || false,
        firstBloodAssist: participant?.firstBloodAssist || false,
        firstBloodVictim: participant?.firstBloodVictim || false,
        dragonKills: participant?.dragonKills || 0,
        baronKills: participant?.baronKills || 0,
        turretKills: participant?.turretKills || 0,
        gameWonFromBehind: (participant?.wasLosing && participant?.win) || false,
        surrendered: participant?.gameEndedInSurrender || false,
        // Knowledge Graph extended fields
        teamKills,
        soloKills: participant?.challenges?.soloKills ?? participant?.soloKills ?? 0,
        totalDamageTaken: participant?.totalDamageTaken || 0,
        teamDamage,
        doubleKills: participant?.doubleKills || 0,
        tripleKills: participant?.tripleKills || 0,
        quadraKills: participant?.quadraKills || 0,
        pentaKills: participant?.pentaKills || 0,
        goldEarned: participant?.goldEarned || 0,
        teamGold,
        controlWardsPlaced: participant?.challenges?.controlWardsPlaced ?? participant?.detectorWardsPlaced ?? 0,
        wardsKilled: participant?.wardsKilled || 0,
        riftHeraldKills: participant?.challenges?.riftHeraldTakedowns ?? 0,
        inhibitorKills: participant?.inhibitorKills || 0,
        totalHealsOnTeammates: participant?.totalHealsOnTeammates || 0,
        totalDamageShieldedOnTeammates: participant?.totalDamageShieldedOnTeammates || 0,
        timeCCingOthers: participant?.timeCCingOthers || 0,
      };
    });

    const marketValue = calculateMarketValue(
      soloQueue ? {
        tier: soloQueue.tier,
        rank: soloQueue.rank,
        leaguePoints: soloQueue.leaguePoints,
        wins: soloQueue.wins,
        losses: soloQueue.losses,
      } : null,
      matches
    );

    const winrate = soloQueue
      ? Math.round((soloQueue.wins / (soloQueue.wins + soloQueue.losses)) * 100)
      : null;

const visitorId = request.cookies.get('visitor_id')?.value;

const { data: existingPlayer } = await supabase
  .from('players')
  .select('id, searched_by')
  .eq('puuid', account.puuid)
  .single();

const searchedBy = existingPlayer?.searched_by || [];
if (visitorId && !searchedBy.includes(visitorId)) {
  searchedBy.push(visitorId);
}

const { data: player } = await supabase
  .from('players')
  .upsert({
    summoner_name: fullName,
    summoner_id: summoner.id,
    puuid: account.puuid,
    region: region,
    summoner_level: summoner.summonerLevel,
    profile_icon_id: summoner.profileIconId,
    market_value: marketValue.rated ? marketValue.value : null,
    tier: soloQueue?.tier || null,
    rank: soloQueue?.rank || null,
    winrate: winrate,
    searched_by: searchedBy,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'puuid' })
  .select()
  .single();

    if (player && marketValue.rated) {
      await supabase
        .from('market_value_history')
        .insert({
          player_id: player.id,
          market_value: marketValue.value,
          recorded_at: new Date().toISOString(),
        });
    }

    if (player && soloQueue) {
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

    // Collect champion stats from matches (non-blocking)
    if (soloQueue && matches.length > 0) {
      collectChampionStats(matches, matchDetails.filter(Boolean), account.puuid, soloQueue.tier).catch(() => {});
    }

    return NextResponse.json({
      summoner: { ...summoner, name: fullName },
      ranked: Array.isArray(ranked) ? ranked : [],
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

async function collectChampionStats(
  matches: any[],
  rawMatches: any[],
  puuid: string,
  tier: string
) {
  // Aggregate champion stats from this player's matches
  const champStats: Record<string, { wins: number; games: number; kills: number; deaths: number; assists: number }> = {};
  const bannedChamps: Record<string, number> = {};
  let totalGames = rawMatches.length;

  for (const match of rawMatches) {
    if (!match?.info?.participants) continue;

    // Count bans
    for (const team of match.info.teams || []) {
      for (const ban of team.bans || []) {
        if (ban.championId > 0) {
          const key = String(ban.championId);
          bannedChamps[key] = (bannedChamps[key] || 0) + 1;
        }
      }
    }

    // Count picks and wins for all participants (not just our player)
    for (const p of match.info.participants) {
      const key = String(p.championId);
      if (!champStats[key]) {
        champStats[key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0 };
      }
      champStats[key].games++;
      if (p.win) champStats[key].wins++;
      champStats[key].kills += p.kills || 0;
      champStats[key].deaths += p.deaths || 0;
      champStats[key].assists += p.assists || 0;
    }
  }

  // Total games counted = rawMatches * 10 participants per match
  const totalParticipantGames = totalGames * 10;

  // Upsert champion stats per tier
  for (const [champKey, stats] of Object.entries(champStats)) {
    await supabase.from('champion_stats').upsert({
      champion_key: champKey,
      tier: tier,
      wins: stats.wins,
      games: stats.games,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      bans: bannedChamps[champKey] || 0,
      total_games_in_tier: totalParticipantGames,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'champion_key,tier' });
  }
}
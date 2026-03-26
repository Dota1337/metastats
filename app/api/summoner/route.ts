import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { calculateMarketValue } from '../../lib/marketvalue';
import { processMatch, toLegacyMatchData, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';

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
          matches: [], // matches fetched separately via /api/matches for cached responses
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
      `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}?api_key=${apiKey}`
    );
    const ranked = rankedRes.ok ? await rankedRes.json() : [];

    const soloQueue = Array.isArray(ranked)
      ? ranked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5')
      : null;

    // Fetch match IDs once — used for market value AND returned to client
    const matchListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=30&api_key=${apiKey}`
    );
    const matchIds: string[] = matchListRes.ok ? await matchListRes.json() : [];

    // Fetch all 30 match details (batched in groups of 10 to respect rate limits)
    const allMatchDetails: any[] = [];
    for (let batch = 0; batch < matchIds.length; batch += 10) {
      const batchIds = matchIds.slice(batch, batch + 10);
      const batchResults = await Promise.all(
        batchIds.map(async (id) => {
          const res = await fetch(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${apiKey}`);
          return res.ok ? res.json() : null;
        })
      );
      allMatchDetails.push(...batchResults);
    }

    const matchDetails = allMatchDetails.filter(Boolean);

    // Process matches with the shared processor (extracts all ~200 stats)
    const extendedMatches: ExtendedMatchData[] = matchDetails
      .map(raw => processMatch(raw, account.puuid))
      .filter(Boolean) as ExtendedMatchData[];

    // Legacy format for existing market value calculation
    const matches = extendedMatches.map(m => ({
      ...toLegacyMatchData(m),
      // Pass through new challenge fields for enhanced market value
      damagePerMinute: m.challenges.damagePerMinute,
      goldPerMinute: m.challenges.goldPerMinute,
      teamDamagePercentage: m.challenges.teamDamagePercentage,
      visionScorePerMinute: m.challenges.visionScorePerMinute,
      turretPlatesTaken: m.challenges.turretPlatesTaken,
      earlyLaningPhaseGoldExpAdvantage: m.challenges.earlyLaningPhaseGoldExpAdvantage,
      maxCsAdvantageOnLaneOpponent: m.challenges.maxCsAdvantageOnLaneOpponent,
      skillshotsDodged: m.challenges.skillshotsDodged,
      outnumberedKills: m.challenges.outnumberedKills,
      survivedSingleDigitHpCount: m.challenges.survivedSingleDigitHpCount,
      maxKillDeficit: m.challenges.maxKillDeficit,
      longestTimeSpentLiving: m.longestTimeSpentLiving,
      totalTimeSpentDead: m.totalTimeSpentDead,
      damageSelfMitigated: m.damageSelfMitigated,
      goldSpent: m.goldSpent,
      damageDealtToObjectives: m.damageDealtToObjectives,
      damageDealtToBuildings: m.damageDealtToBuildings,
      legendaryCount: m.challenges.legendaryCount,
      takedownsFirst25Minutes: m.challenges.takedownsFirst25Minutes,
      saveAllyFromDeath: m.challenges.saveAllyFromDeath,
      effectiveHealAndShielding: m.challenges.effectiveHealAndShielding,
      epicMonsterSteals: m.challenges.epicMonsterSteals,
    }));

    // Calculate 20 stat categories
    const statsOverview = calculateStatsOverview(
      extendedMatches,
      soloQueue ? {
        tier: soloQueue.tier,
        rank: soloQueue.rank,
        leaguePoints: soloQueue.leaguePoints,
        wins: soloQueue.wins,
        losses: soloQueue.losses,
      } : null
    );

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

const { data: player, error: upsertError } = await supabase
  .from('players')
  .upsert({
    summoner_name: fullName,
    summoner_id: account.puuid,
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

if (upsertError) {
  console.error('Supabase upsert error:', upsertError);
}

    if (player && marketValue.rated) {
      await supabase
        .from('market_value_history')
        .insert({
          player_id: player.id,
          market_value: marketValue.value,
          recorded_at: new Date().toISOString(),
        });
    }

    // Store all ranked queues (solo + flex)
    if (player && Array.isArray(ranked)) {
      // Delete old ranked_stats for this player, then insert all queues
      await supabase.from('ranked_stats').delete().eq('player_id', player.id);
      for (const queue of ranked) {
        await supabase.from('ranked_stats').insert({
          player_id: player.id,
          queue_type: queue.queueType,
          tier: queue.tier,
          rank: queue.rank,
          league_points: queue.leaguePoints,
          wins: queue.wins,
          losses: queue.losses,
          updated_at: new Date().toISOString(),
        });
      }
    }

    // Collect champion stats from matches (non-blocking)
    if (soloQueue && matches.length > 0) {
      collectChampionStats(matches, matchDetails, account.puuid, soloQueue.tier).catch(() => {});
    }

    return NextResponse.json({
      summoner: { ...summoner, name: fullName },
      ranked: Array.isArray(ranked) ? ranked : [],
      matches,
      statsOverview,
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
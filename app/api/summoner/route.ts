import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { calculateMarketValue } from '../../lib/marketvalue';
import { processMatch, toLegacyMatchData, extractParticipants, extractBans, type ExtendedMatchData } from '../../lib/match-processor';
import { calculateStatsOverview } from '../../lib/stats-categories';

import { getRegionalRouting } from '../../lib/regions';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = searchParams.get('name') || '';
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;
  const regional = getRegionalRouting(region);

  const decoded = decodeURIComponent(name);
  const parts = decoded.split('#');
  const gameName = parts[0].trim();
  const tagLine = parts[1]?.trim() || 'EUW';
  const fullName = `${gameName}#${tagLine}`;

  try {
    // === Step 1: Resolve account ===
    const accountRes = await fetch(
      `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${apiKey}`
    );
    if (!accountRes.ok) {
      return NextResponse.json({ error: 'Spieler nicht gefunden' }, { status: 404 });
    }
    const account = await accountRes.json();

    // === Step 2: Load cached player from Supabase ===
    const { data: cached } = await supabase
      .from('players')
      .select('*')
      .eq('puuid', account.puuid)
      .single();

    // === Step 3: Fetch match IDs ===
    // Recent 30 LoL matches (all queues) for display
    const matchListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=30&api_key=${apiKey}`
    );
    const matchIds: string[] = matchListRes.ok ? await matchListRes.json() : [];
    const latestMatchId = matchIds[0] || null;

    // Check if we have new matches since last calculation
    // summoner_id field stores the last known match ID
    const hasNewMatches = !cached || cached.summoner_id !== latestMatchId;

    // === Step 4a: No new matches → return stored data ===
    if (!hasNewMatches && cached) {
      let { data: rankedData } = await supabase
        .from('ranked_stats')
        .select('*')
        .eq('player_id', cached.id);

      // If no ranked stats stored, fetch fresh from Riot API
      if (!rankedData || rankedData.length === 0) {
        try {
          const rankedRes = await fetch(
            `https://${region}.api.riotgames.com/lol/league/v4/entries/by-puuid/${account.puuid}?api_key=${apiKey}`
          );
          if (rankedRes.ok) {
            const freshRanked = await rankedRes.json();
            if (Array.isArray(freshRanked) && freshRanked.length > 0) {
              // Store ranked stats and update player tier
              const soloQ = freshRanked.find((r: any) => r.queueType === 'RANKED_SOLO_5x5');
              const flexQ = freshRanked.find((r: any) => r.queueType === 'RANKED_FLEX_SR');
              const primary = soloQ || flexQ;
              if (primary) {
                await supabase.from('players').update({
                  tier: primary.tier,
                  rank: primary.rank,
                  winrate: Math.round((primary.wins / (primary.wins + primary.losses)) * 100),
                }).eq('id', cached.id);
                cached.tier = primary.tier;
                cached.rank = primary.rank;
              }
              for (const q of freshRanked) {
                await supabase.from('ranked_stats').upsert({
                  player_id: cached.id,
                  queue_type: q.queueType,
                  tier: q.tier,
                  rank: q.rank,
                  league_points: q.leaguePoints,
                  wins: q.wins,
                  losses: q.losses,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'player_id,queue_type' });
              }
              rankedData = freshRanked.map((q: any) => ({
                queue_type: q.queueType, tier: q.tier, rank: q.rank,
                league_points: q.leaguePoints, wins: q.wins, losses: q.losses,
              }));
            }
          }
        } catch {}
      }

      const mapped = (rankedData || []).map((r: any) => ({
        queueType: r.queue_type || r.queueType,
        tier: r.tier,
        rank: r.rank,
        leaguePoints: r.league_points || r.leaguePoints,
        wins: r.wins,
        losses: r.losses,
      }));

      // Track visitor
      const visitorId = request.cookies.get('visitor_id')?.value;
      if (visitorId) {
        const searchedBy = cached.searched_by || [];
        if (!searchedBy.includes(visitorId)) {
          searchedBy.push(visitorId);
          await supabase.from('players').update({ searched_by: searchedBy }).eq('id', cached.id);
        }
      }

      return NextResponse.json({
        summoner: {
          name: cached.summoner_name,
          summonerLevel: cached.summoner_level,
          profileIconId: cached.profile_icon_id,
          puuid: cached.puuid,
          tier: cached.tier,
          rank: cached.rank,
        },
        ranked: mapped,
        matches: [], // loaded via /api/matches
        fromCache: true,
        storedMarketValue: cached.market_value,
      });
    }

    // === Step 4b: New matches detected → full recalculation ===
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
    const flexQueue = Array.isArray(ranked)
      ? ranked.find((r: any) => r.queueType === 'RANKED_FLEX_SR')
      : null;

    // Determine which queue to use for market value: higher rank wins
    const TIER_VAL: Record<string, number> = {
      IRON: 0, BRONZE: 1, SILVER: 2, GOLD: 3, PLATINUM: 4,
      EMERALD: 5, DIAMOND: 6, MASTER: 7, GRANDMASTER: 8, CHALLENGER: 9,
    };
    const RANK_VAL: Record<string, number> = { IV: 0, III: 1, II: 2, I: 3 };
    const rankScore = (q: any) => q ? (TIER_VAL[q.tier] || 0) * 1000 + (RANK_VAL[q.rank] || 0) * 100 + (q.leaguePoints || 0) : -1;
    const soloScore = rankScore(soloQueue);
    const flexScore = rankScore(flexQueue);
    const primaryQueue = soloScore >= flexScore ? soloQueue : flexQueue;
    const primaryQueueId = soloScore >= flexScore ? 420 : 440; // 420=Solo/Duo, 440=Flex

    // Fetch ranked match IDs for market value (max 60 to stay within rate limits)
    const rankedMatchIds: string[] = [];
    const rankedListRes = await fetch(
      `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${account.puuid}/ids?queue=${primaryQueueId}&start=0&count=60&api_key=${apiKey}`
    );
    if (rankedListRes.ok) {
      const ids: string[] = await rankedListRes.json();
      rankedMatchIds.push(...ids);
    }

    // Merge: display matchIds first (for match history), then ranked matchIds (for market value)
    // Limit total fetches to stay within rate limits (dev key: 100 req/2min)
    const displaySet = new Set(matchIds);
    const rankedOnly = rankedMatchIds.filter(id => !displaySet.has(id));
    // Fetch display matches (30) + up to 30 extra ranked matches = max 60 match detail calls
    const allMatchIdArray = [...matchIds, ...rankedOnly.slice(0, 30)];

    // Fetch match details (batched)
    const allMatchDetails: any[] = [];
    for (let batch = 0; batch < allMatchIdArray.length; batch += 10) {
      const batchIds = allMatchIdArray.slice(batch, batch + 10);
      const batchResults = await Promise.all(
        batchIds.map(async (id) => {
          const res = await fetch(`https://${regional}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${apiKey}`);
          return res.ok ? res.json() : null;
        })
      );
      allMatchDetails.push(...batchResults);
    }

    const matchDetails = allMatchDetails.filter(Boolean);

    // Process ALL matches with the shared processor (extracts all ~200 stats)
    const allExtendedMatches: ExtendedMatchData[] = matchDetails
      .map(raw => processMatch(raw, account.puuid))
      .filter(Boolean) as ExtendedMatchData[];

    // Split: display matches (recent 30, all queues) vs ranked matches (prioritized queue, for market value)
    const rankedMatchIdSet = new Set(rankedMatchIds);
    const rankedExtendedMatches = allExtendedMatches.filter(m => rankedMatchIdSet.has(m.matchId));
    const displayExtendedMatches = allExtendedMatches
      .filter(m => matchIds.includes(m.matchId))
      .slice(0, 30);

    // Use display matches for the UI, ranked matches for market value
    const extendedMatches = displayExtendedMatches;

    // Extract participant data for detailed match view
    const participantsMap: Record<string, any> = {};
    const bansMap: Record<string, any> = {};
    for (const raw of matchDetails) {
      if (!raw?.metadata?.matchId) continue;
      participantsMap[raw.metadata.matchId] = extractParticipants(raw);
      bansMap[raw.metadata.matchId] = extractBans(raw);
    }

    // Helper: convert extended matches to legacy format
    const toLegacy = (m: ExtendedMatchData) => ({
      ...toLegacyMatchData(m),
      participants: participantsMap[m.matchId] || [],
      bans: bansMap[m.matchId] || [],
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
    });

    // Display matches (recent 30, all queues) — for match history UI
    const matches = extendedMatches.map(toLegacy);

    // Ranked matches (up to 200, prioritized queue only) — for market value
    const rankedMatches = rankedExtendedMatches.map(toLegacy);

    // Calculate 20 stat categories (based on display matches for overview)
    const statsOverview = calculateStatsOverview(
      extendedMatches,
      primaryQueue ? {
        tier: primaryQueue.tier,
        rank: primaryQueue.rank,
        leaguePoints: primaryQueue.leaguePoints,
        wins: primaryQueue.wins,
        losses: primaryQueue.losses,
      } : null
    );

    // Market value: based on ALL ranked matches from the prioritized queue
    const marketValue = calculateMarketValue(
      primaryQueue ? {
        tier: primaryQueue.tier,
        rank: primaryQueue.rank,
        leaguePoints: primaryQueue.leaguePoints,
        wins: primaryQueue.wins,
        losses: primaryQueue.losses,
      } : null,
      rankedMatches
    );

    const winrate = primaryQueue
      ? Math.round((primaryQueue.wins / (primaryQueue.wins + primaryQueue.losses)) * 100)
      : null;

    // === Step 5: Persist to Supabase ===
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
        summoner_id: latestMatchId || account.puuid, // stores latest match ID
        puuid: account.puuid,
        region: region,
        summoner_level: summoner.summonerLevel,
        profile_icon_id: summoner.profileIconId,
        market_value: marketValue.rated ? marketValue.value : null,
        tier: primaryQueue?.tier || null,
        rank: primaryQueue?.rank || null,
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

    // Collect champion stats from ranked matches (non-blocking)
    if (primaryQueue && rankedMatches.length > 0) {
      collectChampionStats(rankedMatches, matchDetails, account.puuid, primaryQueue.tier, region).catch(() => {});
    }

    return NextResponse.json({
      summoner: { ...summoner, name: fullName },
      ranked: Array.isArray(ranked) ? ranked : [],
      matches,
      statsOverview,
      storedMarketValue: marketValue.rated ? marketValue.value : null,
      rankedGamesAnalyzed: rankedMatches.length,
      primaryQueue: primaryQueueId === 420 ? 'RANKED_SOLO_5x5' : 'RANKED_FLEX_SR',
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

async function collectChampionStats(
  matches: any[],
  rawMatches: any[],
  puuid: string,
  tier: string,
  region: string
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
      region: region,
      wins: stats.wins,
      games: stats.games,
      kills: stats.kills,
      deaths: stats.deaths,
      assists: stats.assists,
      bans: bannedChamps[champKey] || 0,
      total_games_in_tier: totalParticipantGames,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'champion_key,tier,region' });
  }
}
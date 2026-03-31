import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'all';
  const tier = searchParams.get('tier') || 'all';

  try {
    // 1. Fetch all rated players from Supabase
    let query = supabase
      .from('players')
      .select('id, summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id, league_points, updated_at')
      .not('market_value', 'is', null)
      .gt('market_value', 0)
      .order('market_value', { ascending: false });

    if (region !== 'all') {
      query = query.eq('region', region);
    }

    if (tier !== 'all') {
      if (tier === 'DIAMOND') {
        query = query.eq('tier', 'DIAMOND');
      } else {
        query = query.eq('tier', tier);
      }
    }

    const { data: players, error: playersError } = await query.limit(100);

    if (playersError) {
      return NextResponse.json({ error: 'Datenbankfehler' }, { status: 500 });
    }

    // 2. Get market value history for weekly comparison
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const playerIds = (players || []).map(p => p.id);

    let weeklyChanges: Record<number, { oldValue: number; newValue: number }> = {};

    if (playerIds.length > 0) {
      // Get the oldest record within the last week for each player (approximation of "value 7 days ago")
      const { data: historyData } = await supabase
        .from('market_value_history')
        .select('player_id, market_value, recorded_at')
        .in('player_id', playerIds)
        .gte('recorded_at', oneWeekAgo)
        .order('recorded_at', { ascending: true });

      if (historyData) {
        // For each player, find their earliest value in the week
        const earliestPerPlayer: Record<number, number> = {};
        for (const h of historyData) {
          if (!(h.player_id in earliestPerPlayer)) {
            earliestPerPlayer[h.player_id] = h.market_value;
          }
        }

        for (const player of (players || [])) {
          if (earliestPerPlayer[player.id] !== undefined) {
            weeklyChanges[player.id] = {
              oldValue: earliestPerPlayer[player.id],
              newValue: player.market_value,
            };
          }
        }
      }
    }

    // 3. Build response
    const enrichedPlayers = (players || []).map(p => {
      const change = weeklyChanges[p.id];
      return {
        id: p.id,
        name: p.summoner_name,
        region: p.region,
        tier: p.tier,
        rank: p.rank,
        winrate: p.winrate,
        marketValue: p.market_value,
        level: p.summoner_level,
        profileIcon: p.profile_icon_id,
        weeklyChange: change ? change.newValue - change.oldValue : 0,
        weeklyChangePct: change && change.oldValue > 0
          ? Math.round(((change.newValue - change.oldValue) / change.oldValue) * 1000) / 10
          : 0,
        lp: p.league_points ?? null,
      };
    });

    // 4. Group gainers and losers by tier
    const tiers = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'];
    const gainersPerTier: Record<string, typeof enrichedPlayers> = {};
    const losersPerTier: Record<string, typeof enrichedPlayers> = {};

    for (const t of tiers) {
      const tierPlayers = enrichedPlayers.filter(p => p.tier === t);
      gainersPerTier[t] = tierPlayers
        .filter(p => p.weeklyChange > 0)
        .sort((a, b) => b.weeklyChange - a.weeklyChange)
        .slice(0, 5);
      losersPerTier[t] = tierPlayers
        .filter(p => p.weeklyChange < 0)
        .sort((a, b) => a.weeklyChange - b.weeklyChange)
        .slice(0, 5);
    }

    // 5. Tier statistics — always fetch ALL tiers regardless of filter
    const tierStats: Record<string, { count: number; avgValue: number; minValue: number; maxValue: number }> = {};
    let allPlayersQuery = supabase
      .from('players')
      .select('tier, market_value')
      .not('market_value', 'is', null)
      .gt('market_value', 0);
    if (region !== 'all') {
      allPlayersQuery = allPlayersQuery.eq('region', region);
    }
    const { data: allForStats } = await allPlayersQuery;
    if (allForStats) {
      for (const t of tiers) {
        const tierValues = allForStats.filter(p => p.tier === t).map(p => p.market_value);
        if (tierValues.length > 0) {
          tierStats[t] = {
            count: tierValues.length,
            avgValue: Math.round(tierValues.reduce((s, v) => s + v, 0) / tierValues.length),
            minValue: Math.min(...tierValues),
            maxValue: Math.max(...tierValues),
          };
        }
      }
    }

    return NextResponse.json({
      players: enrichedPlayers,
      gainersPerTier,
      losersPerTier,
      tierStats,
      total: enrichedPlayers.length,
      filter: { region, tier },
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

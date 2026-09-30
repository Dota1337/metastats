import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { expandLolTier } from '../../lib/rank-groups';
import { cachedJson, SLOW_CACHE_CONTROL } from '../../lib/api-cache';
import { fetchAllPages } from '../../lib/supabase-pages';
import {
  MV_HISTORY_COLUMNS, WEEKLY_LOOKBACK_MS, weeklyReferenceByPlayer, type MvHistoryRow,
} from '../../lib/marketvalue-history';

interface PlayerRow {
  id: string;
  summoner_name: string;
  region: string;
  tier: string;
  rank: string;
  winrate: number;
  market_value: number;
  summoner_level: number;
  profile_icon_id: number;
  updated_at: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'all';
  const tier = searchParams.get('tier') || 'all';

  try {
    const now = Date.now();
    // 1. Alle bewerteten Spieler der Region und den Verlauf seitenweise lesen
    //    (PostgREST schneidet sonst bei 1000 Zeilen still ab) und im Speicher
    //    verknuepfen — eine .in()-Liste ueber alle IDs wuerde die URL sprengen.
    const [allPlayers, historyData] = await Promise.all([
      fetchAllPages<PlayerRow>(() => {
        let q = supabase
          .from('players')
          .select('id, summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id, updated_at')
          .gt('market_value', 0)
          .order('id');
        if (region !== 'all') q = q.eq('region', region);
        return q;
      }),
      fetchAllPages<MvHistoryRow>(() => supabase
        .from('market_value_history')
        .select(MV_HISTORY_COLUMNS)
        .gte('recorded_at', new Date(now - WEEKLY_LOOKBACK_MS).toISOString())
        .order('recorded_at')
        .order('player_id')),
    ]);

    if (!allPlayers) {
      return NextResponse.json({ error: 'Datenbankfehler' }, { status: 500 });
    }

    // Master+ / Grandmaster+ fassen mehrere Raenge zusammen (app/lib/rank-groups.ts).
    const tierSet = tier !== 'all' ? new Set(expandLolTier(tier)) : null;
    const filtered = allPlayers
      .filter(p => !tierSet || tierSet.has(p.tier))
      .sort((a, b) => b.market_value - a.market_value);
    const players = filtered.slice(0, 100);

    // 2. Wochenveraenderung nur mit echtem Vergleichswert (weeklyReferenceByPlayer).
    const refs = weeklyReferenceByPlayer(historyData || [], now);
    const withChange = (p: PlayerRow) => {
      const ref = refs.get(p.id);
      return {
        weeklyChange: ref !== undefined ? p.market_value - ref : 0,
        weeklyChangePct: ref !== undefined && ref > 0
          ? Math.round(((p.market_value - ref) / ref) * 1000) / 10
          : 0,
      };
    };
    // 3. Gewinner/Verlierer je Rang aus allen Spielern des Filters, nicht nur
    //    den Top 100.
    const tiers = ['CHALLENGER', 'GRANDMASTER', 'MASTER', 'DIAMOND'];
    const changeOf = (p: PlayerRow) => p.market_value - refs.get(p.id)!;
    const changed = filtered.filter(p => refs.has(p.id));
    const gainerRows: Record<string, PlayerRow[]> = {};
    const loserRows: Record<string, PlayerRow[]> = {};
    for (const t of tiers) {
      const tierPlayers = changed.filter(p => p.tier === t);
      gainerRows[t] = tierPlayers.filter(p => changeOf(p) > 0).sort((x, y) => changeOf(y) - changeOf(x)).slice(0, 5);
      loserRows[t] = tierPlayers.filter(p => changeOf(p) < 0).sort((x, y) => changeOf(x) - changeOf(y)).slice(0, 5);
    }

    // 4. LP (Solo-Queue) nur fuer die angezeigten Spieler — hoechstens 140 IDs.
    const shown = [...players, ...Object.values(gainerRows).flat(), ...Object.values(loserRows).flat()];
    const playerIds = [...new Set(shown.map(p => p.id))];
    const lpMap: Record<string, number> = {};
    if (playerIds.length > 0) {
      const { data: rankedData } = await supabase
        .from('ranked_stats')
        .select('player_id, league_points')
        .in('player_id', playerIds)
        .eq('queue_type', 'RANKED_SOLO_5x5');
      for (const r of rankedData || []) lpMap[r.player_id] = r.league_points;
    }

    const enrich = (p: PlayerRow) => ({
      id: p.id,
      name: p.summoner_name,
      region: p.region,
      tier: p.tier,
      rank: p.rank,
      winrate: p.winrate,
      marketValue: p.market_value,
      level: p.summoner_level,
      profileIcon: p.profile_icon_id,
      ...withChange(p),
      lp: lpMap[p.id] ?? null,
    });
    const enrichedPlayers = players.map(enrich);
    const gainersPerTier: Record<string, typeof enrichedPlayers> = {};
    const losersPerTier: Record<string, typeof enrichedPlayers> = {};
    for (const t of tiers) {
      gainersPerTier[t] = gainerRows[t].map(enrich);
      losersPerTier[t] = loserRows[t].map(enrich);
    }

    // 5. Tier statistics — alle Raenge der Region, unabhaengig vom Rang-Filter
    const tierStats: Record<string, { count: number; avgValue: number; minValue: number; maxValue: number }> = {};
    {
      for (const t of tiers) {
        const tierValues = allPlayers.filter(p => p.tier === t).map(p => p.market_value);
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

    // Marktwerte kommen aus dem Tageslauf — 1h frisch, 24h SWR.
    return cachedJson({
      players: enrichedPlayers,
      gainersPerTier,
      losersPerTier,
      tierStats,
      // Alle bewerteten Spieler des Filters, nicht nur die 100 gelisteten.
      total: filtered.length,
      filter: { region, tier },
    }, { cache: SLOW_CACHE_CONTROL });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

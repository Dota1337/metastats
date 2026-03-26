import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

interface ChampionInfo {
  id: string;
  key: string;
  name: string;
  title: string;
  tags: string[];
  image: string;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tier = searchParams.get('tier') || 'all';
  const role = searchParams.get('role') || 'all';

  try {
    // Fetch Data Dragon version + champion list
    const versionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
    const versions = await versionRes.json();
    const version = versions[0];

    const champRes = await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${version}/data/de_DE/champion.json`
    );
    if (!champRes.ok) {
      return NextResponse.json({ error: 'Champion-Daten nicht verfügbar' }, { status: 502 });
    }
    const champData = await champRes.json();

    // Build champion list from Data Dragon
    const champions: ChampionInfo[] = Object.values(champData.data).map((c: any) => ({
      id: c.id,
      key: c.key,
      name: c.name,
      title: c.title,
      tags: c.tags,
      image: c.image.full,
    }));

    // Fetch aggregated stats from Supabase
    let query = supabase.from('champion_stats').select('*');
    if (tier !== 'all') {
      query = query.eq('tier', tier.toUpperCase());
    }

    const { data: statsRows } = await query;

    // Build stats map: championKey -> stats
    const statsMap: Record<string, {
      wins: number;
      games: number;
      kills: number;
      deaths: number;
      assists: number;
      bans: number;
      totalGames: number;
    }> = {};

    if (statsRows && statsRows.length > 0) {
      for (const row of statsRows) {
        const key = row.champion_key;
        if (!statsMap[key]) {
          statsMap[key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0, totalGames: 0 };
        }
        statsMap[key].wins += row.wins || 0;
        statsMap[key].games += row.games || 0;
        statsMap[key].kills += row.kills || 0;
        statsMap[key].deaths += row.deaths || 0;
        statsMap[key].assists += row.assists || 0;
        statsMap[key].bans += row.bans || 0;
        statsMap[key].totalGames += row.total_games_in_tier || 0;
      }
    }

    // Map Data Dragon tags to roles
    const tagToRole: Record<string, string> = {
      Fighter: 'TOP',
      Tank: 'TOP',
      Assassin: 'JUNGLE',
      Mage: 'MIDDLE',
      Marksman: 'BOTTOM',
      Support: 'SUPPORT',
    };

    // Merge champion info with stats
    const result = champions.map((champ) => {
      const stats = statsMap[champ.key];
      const primaryRole = tagToRole[champ.tags[0]] || 'MIDDLE';

      return {
        id: champ.id,
        key: champ.key,
        name: champ.name,
        title: champ.title,
        tags: champ.tags,
        image: champ.image,
        role: primaryRole,
        winRate: stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 1000) / 10 : null,
        pickRate: stats && stats.totalGames > 0 ? Math.round((stats.games / stats.totalGames) * 1000) / 10 : null,
        banRate: stats && stats.totalGames > 0 ? Math.round((stats.bans / stats.totalGames) * 1000) / 10 : null,
        games: stats?.games || 0,
        avgKDA: stats && stats.games > 0 && stats.deaths > 0
          ? Math.round(((stats.kills + stats.assists) / stats.deaths) * 100) / 100
          : null,
      };
    });

    // Filter by role
    const roleMap: Record<string, string> = {
      top: 'TOP',
      jungle: 'JUNGLE',
      mid: 'MIDDLE',
      adc: 'BOTTOM',
      support: 'SUPPORT',
    };
    const filtered = role !== 'all'
      ? result.filter((c) => c.role === roleMap[role.toLowerCase()])
      : result;

    // Sort: champions with data first (by pick rate desc), then alphabetically
    filtered.sort((a, b) => {
      if (a.games > 0 && b.games === 0) return -1;
      if (a.games === 0 && b.games > 0) return 1;
      if (a.games > 0 && b.games > 0) return (b.pickRate || 0) - (a.pickRate || 0);
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      version,
      champions: filtered,
      tier,
      totalChampions: filtered.length,
      hasStats: statsRows && statsRows.length > 0,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

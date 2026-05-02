import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

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
  const region = searchParams.get('region') || 'euw1';

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

    // Try Supabase first for stats
    let statsMap: Record<string, {
      wins: number; games: number;
      kills: number; deaths: number; assists: number;
      bans: number; totalGames: number;
    }> = {};
    let hasStats = false;

    try {
      let query = supabase.from('champion_stats').select('*').eq('region', region);
      if (tier !== 'all') {
        query = query.eq('tier', tier.toUpperCase());
      }
      const { data: statsRows } = await query;

      if (statsRows && statsRows.length > 0) {
        hasStats = true;
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
    } catch {
      // Supabase unavailable, continue without
    }

    // If no Supabase stats, try static JSON files collected by the script
    if (!hasStats) {
      try {
        const regionFile = `champion-stats-${region.replace('1', '')}.json`;
        // Try fetching from public folder (works on Vercel)
        const origin = new URL(request.url).origin;
        const staticRes = await fetch(`${origin}/${regionFile}`);
        if (staticRes.ok) {
          const collectData = await staticRes.json();
          if (collectData.stats && collectData.totalParticipantGames > 0) {
            hasStats = true;
            const totalGames = collectData.totalParticipantGames;
            for (const [key, s] of Object.entries(collectData.stats) as [string, any][]) {
              statsMap[key] = {
                wins: s.wins,
                games: s.games,
                kills: s.kills,
                deaths: s.deaths,
                assists: s.assists,
                bans: s.bans,
                totalGames: totalGames,
              };
            }
          }
        }
      } catch {
        // Static file not available
      }
    }

    // Last resort: try the live collection endpoint
    if (!hasStats) {
      try {
        const origin = new URL(request.url).origin;
        const collectRes = await fetch(`${origin}/api/champions/collect?region=${region}`, {
          headers: { 'x-internal': '1' },
        });
        if (collectRes.ok) {
          const collectData = await collectRes.json();
          if (collectData.stats && collectData.totalParticipantGames > 0) {
            hasStats = true;
            const totalGames = collectData.totalParticipantGames;
            for (const [key, s] of Object.entries(collectData.stats) as [string, any][]) {
              statsMap[key] = {
                wins: s.wins,
                games: s.games,
                kills: s.kills,
                deaths: s.deaths,
                assists: s.assists,
                bans: s.bans,
                totalGames: totalGames,
              };
            }
          }
        }
      } catch {
        // Collection failed, continue without stats
      }
    }

    // Match-based role data from champion-builds-{region}.json (preferred over Data Dragon tags).
    // Falls back to tag heuristic when builds JSON is not yet available.
    let roleGames: Record<string, Record<string, number>> = {}; // championKey -> { TOP: n, MID: n, ... }
    try {
      const buildsFile = join(process.cwd(), 'public', `champion-builds-${region.replace('1', '')}.json`);
      if (existsSync(buildsFile)) {
        const buildsData = JSON.parse(readFileSync(buildsFile, 'utf8'));
        for (const [champKey, roles] of Object.entries(buildsData.byChampionRole || {}) as [string, any][]) {
          roleGames[champKey] = {};
          for (const [r, d] of Object.entries(roles) as [string, any][]) {
            roleGames[champKey][r] = d.games || 0;
          }
        }
      }
    } catch {
      // builds JSON not yet generated, fall back to tags
    }
    const hasMatchRoles = Object.keys(roleGames).length > 0;

    // Map Data Dragon tags to roles (fallback for champions without match data)
    const tagToRole: Record<string, string> = {
      Fighter: 'TOP',
      Tank: 'TOP',
      Assassin: 'JUNGLE',
      Mage: 'MIDDLE',
      Marksman: 'BOTTOM',
      Support: 'UTILITY',
    };

    // Resolve primary role + significant roles for a champion. Significant = role
    // accounts for at least 5% of the champion's games — that's where op.gg/lolg
    // also draws the line for "this champion is a viable pick here".
    const ROLE_SIGNIFICANCE = 0.05;
    function resolveRoles(champKey: string, tags: string[]): { primary: string; significant: Set<string> } {
      const fromMatches = roleGames[champKey];
      if (fromMatches && Object.keys(fromMatches).length > 0) {
        const total = Object.values(fromMatches).reduce((a, b) => a + b, 0);
        const significant = new Set<string>();
        let primary = '';
        let max = -1;
        for (const [r, g] of Object.entries(fromMatches)) {
          if (g / total >= ROLE_SIGNIFICANCE) significant.add(r);
          if (g > max) { max = g; primary = r; }
        }
        return { primary, significant };
      }
      const tagPrimary = tagToRole[tags[0]] || 'MIDDLE';
      return { primary: tagPrimary, significant: new Set([tagPrimary]) };
    }

    // Merge champion info with stats
    const result = champions.map((champ) => {
      const stats = statsMap[champ.key];
      const { primary, significant } = resolveRoles(champ.key, champ.tags);

      return {
        id: champ.id,
        key: champ.key,
        name: champ.name,
        title: champ.title,
        tags: champ.tags,
        image: champ.image,
        role: primary,
        significantRoles: [...significant],
        winRate: stats && stats.games > 0 ? Math.round((stats.wins / stats.games) * 1000) / 10 : null,
        pickRate: stats && stats.totalGames > 0 ? Math.round((stats.games / stats.totalGames) * 1000) / 10 : null,
        banRate: stats && stats.totalGames > 0 ? Math.round((stats.bans / stats.totalGames) * 1000) / 10 : null,
        games: stats?.games || 0,
        avgKDA: stats && stats.games > 0 && stats.deaths > 0
          ? Math.round(((stats.kills + stats.assists) / stats.deaths) * 100) / 100
          : null,
      };
    });

    // Filter by role: when match-based roles are available, use significantRoles
    // (champion qualifies for every role he plays >= 5%). Otherwise primary only.
    const roleMap: Record<string, string> = {
      top: 'TOP',
      jungle: 'JUNGLE',
      mid: 'MIDDLE',
      adc: 'BOTTOM',
      support: 'UTILITY',
    };
    const filtered = role !== 'all'
      ? result.filter((c) => {
          const target = roleMap[role.toLowerCase()];
          if (!target) return false;
          return hasMatchRoles
            ? (c.significantRoles as string[]).includes(target)
            : c.role === target;
        })
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
      hasStats,
      region,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler' }, { status: 500 });
  }
}

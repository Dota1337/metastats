import { NextRequest, NextResponse } from 'next/server';
import { cachedJson, ASSET_CACHE_CONTROL } from '../../lib/api-cache';

export async function GET(request: NextRequest) {
  try {
    const origin = new URL(request.url).origin;

    // Load champion stats
    let topChampions: { id: string; name: string; games: number; winRate: number; role: string }[] = [];
    let matchesAnalyzed = 0;
    try {
      const statsRes = await fetch(`${origin}/champion-stats-euw.json`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const stats = statsData.stats || {};
        matchesAnalyzed = statsData.matchesAnalyzed || 0;

        // Get Data Dragon champion mapping
        const versionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await versionRes.json();
        const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${versions[0]}/data/en_US/champion.json`);
        const champData = await champRes.json();

        const idToChamp: Record<string, { id: string; name: string; tags: string[] }> = {};
        Object.values(champData.data).forEach((c: any) => {
          idToChamp[c.key] = { id: c.id, name: c.name, tags: c.tags };
        });

        // Sort by games, take top 3
        const sorted = Object.entries(stats)
          .map(([key, s]: [string, any]) => ({
            championKey: key,
            champ: idToChamp[key],
            games: s.games,
            wins: s.wins,
          }))
          .filter(e => e.champ)
          .sort((a, b) => b.games - a.games);

        topChampions = sorted.slice(0, 3).map(e => ({
          id: e.champ.id,
          name: e.champ.name,
          games: e.games,
          winRate: Math.round((e.wins / e.games) * 1000) / 10,
          role: e.champ.tags[0] || '',
        }));
      }
    } catch {}

    // Load team/player counts from pro data
    let totalTeams = 0;
    let totalProPlayers = 0;
    try {
      // Hier wird genau EINE Zahl gebraucht. Das Index-Derivat (~33 KB) traegt
      // dasselbe totalTeams wie die SoT (~2,9 MB) und spart den JSON-Parse samt
      // Heap-Spike in der Function. Fallback auf die SoT nur bei 404.
      let teamsRes = await fetch(`${origin}/pro-teams/index.json`);
      if (teamsRes.status === 404) teamsRes = await fetch(`${origin}/pro-teams.json`);
      if (teamsRes.ok) {
        const teamsData = await teamsRes.json();
        totalTeams = teamsData.totalTeams || 0;
      }
    } catch {}
    try {
      const playersRes = await fetch(`${origin}/pro-players.json`);
      if (playersRes.ok) {
        const playersData = await playersRes.json();
        totalProPlayers = playersData.totalPlayers || 0;
      }
    } catch {}

    // Die drei Quellen oben schlucken ihre Fehler einzeln (catch {}) und
    // liefern dann still leere Werte. Ohne die degraded-Bedingung wuerde so
    // eine halbe Startseite eine halbe Stunde lang festgeschrieben.
    return cachedJson({
      topChampions,
      stats: {
        totalTeams,
        totalProPlayers,
        regions: 17,
        matchesAnalyzed,
      },
    }, {
      cache: ASSET_CACHE_CONTROL,
      degraded: topChampions.length === 0 || matchesAnalyzed === 0,
    });
  } catch {
    return NextResponse.json({ topChampions: [], stats: {} }, { status: 500 });
  }
}

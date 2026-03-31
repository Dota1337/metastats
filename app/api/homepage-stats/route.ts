import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const origin = new URL(request.url).origin;

    // Load champion stats
    let topChampions: { id: string; name: string; games: number; winRate: number; role: string }[] = [];
    try {
      const statsRes = await fetch(`${origin}/champion-stats-euw.json`);
      if (statsRes.ok) {
        const statsData = await statsRes.json();
        const stats = statsData.stats || {};

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
      const teamsRes = await fetch(`${origin}/pro-teams.json`);
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

    return NextResponse.json({
      topChampions,
      stats: {
        totalTeams,
        totalProPlayers,
        regions: 17,
        matchesAnalyzed: 2564, // from our champion stats crawl
      },
    });
  } catch {
    return NextResponse.json({ topChampions: [], stats: {} }, { status: 500 });
  }
}

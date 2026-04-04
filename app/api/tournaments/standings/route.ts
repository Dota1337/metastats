import { NextRequest, NextResponse } from 'next/server';

const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

// Cache standings for 15 minutes
let standingsCache: Record<string, { data: any; time: number }> = {};
const CACHE_TTL = 15 * 60 * 1000;

async function fetchLeagues(): Promise<any[]> {
  const res = await fetch(
    'https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US',
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data?.data?.leagues || [];
}

export async function GET(request: NextRequest) {
  const leagueSlug = request.nextUrl.searchParams.get('league') || '';

  if (!leagueSlug) {
    return await getLeaguesOverview();
  }

  return await getLeagueDetail(leagueSlug);
}

async function getLeaguesOverview() {
  const cacheKey = '__overview__';
  const now = Date.now();
  if (standingsCache[cacheKey] && now - standingsCache[cacheKey].time < CACHE_TTL) {
    return NextResponse.json(standingsCache[cacheKey].data);
  }

  try {
    const leagues = await fetchLeagues();

    const activeLeagues = leagues
      .filter((l: any) => l.slug && l.name)
      .map((l: any) => ({
        slug: l.slug,
        name: l.name,
        region: l.region || '',
        image: l.image || '',
        priority: l.priority || 999,
      }))
      .sort((a: any, b: any) => a.priority - b.priority);

    const result = { leagues: activeLeagues };
    standingsCache[cacheKey] = { data: result, time: now };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Ligen' }, { status: 500 });
  }
}

async function getLeagueDetail(leagueSlug: string) {
  const now = Date.now();
  if (standingsCache[leagueSlug] && now - standingsCache[leagueSlug].time < CACHE_TTL) {
    return NextResponse.json(standingsCache[leagueSlug].data);
  }

  try {
    const leagues = await fetchLeagues();
    const league = leagues.find((l: any) => l.slug === leagueSlug);
    if (!league) {
      return NextResponse.json({ error: 'Liga nicht gefunden' }, { status: 404 });
    }

    // Get tournaments for this league
    const tournRes = await fetch(
      `https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`,
      { headers: { 'x-api-key': API_KEY } }
    );
    const tournData = await tournRes.json();
    const tournaments = tournData?.data?.leagues?.[0]?.tournaments || [];

    // Sort by startDate descending and find current tournament
    const nowDate = new Date();
    const sorted = tournaments.sort((a: any, b: any) =>
      new Date(b.startDate).getTime() - new Date(a.startDate).getTime()
    );

    const currentTournament = sorted.find((t: any) => {
      const start = new Date(t.startDate);
      const end = new Date(t.endDate);
      return start <= nowDate && end >= nowDate;
    }) || sorted[0]; // fallback to most recent

    // Fetch standings for current tournament
    let standings: any[] = [];
    if (currentTournament) {
      try {
        const standingsRes = await fetch(
          `https://esports-api.lolesports.com/persisted/gw/getStandingsV3?hl=en-US&tournamentId=${currentTournament.id}`,
          { headers: { 'x-api-key': API_KEY } }
        );
        const standingsData = await standingsRes.json();
        const rawStandings = standingsData?.data?.standings || [];

        // Parse the nested structure correctly:
        // standings[0].stages[].sections[].rankings[]
        if (rawStandings.length > 0) {
          const entry = rawStandings[0];
          const stages = entry.stages || [];
          // Use the first stage with rankings (usually "Regular Season")
          for (const stage of stages) {
            const sections = stage.sections || [];
            for (const section of sections) {
              if (section.rankings && section.rankings.length > 0) {
                standings = section.rankings.map((r: any) => ({
                  ordinal: r.ordinal,
                  teams: (r.teams || []).map((t: any) => ({
                    name: t.name,
                    code: t.code,
                    image: t.image,
                    wins: t.record?.wins || 0,
                    losses: t.record?.losses || 0,
                  })),
                }));
                break; // use first section with data
              }
            }
            if (standings.length > 0) break; // found standings, stop
          }
        }
      } catch {}
    }

    // Fetch schedule matches for this league (all pages)
    let allMatches: any[] = [];
    try {
      const schedRes = await fetch(
        'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US',
        { headers: { 'x-api-key': API_KEY } }
      );
      const schedData = await schedRes.json();
      let events = schedData?.data?.schedule?.events || [];

      // Also fetch newer page
      const newerToken = schedData?.data?.schedule?.pages?.newer;
      if (newerToken) {
        try {
          const moreRes = await fetch(
            `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&pageToken=${newerToken}`,
            { headers: { 'x-api-key': API_KEY } }
          );
          const moreData = await moreRes.json();
          events = [...events, ...(moreData?.data?.schedule?.events || [])];
        } catch {}
      }

      // Also fetch older page for more results
      const olderToken = schedData?.data?.schedule?.pages?.older;
      if (olderToken) {
        try {
          const olderRes = await fetch(
            `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&pageToken=${olderToken}`,
            { headers: { 'x-api-key': API_KEY } }
          );
          const olderData = await olderRes.json();
          events = [...(olderData?.data?.schedule?.events || []), ...events];
        } catch {}
      }

      allMatches = events
        .filter((e: any) => e.type === 'match' && e.league?.slug === leagueSlug)
        .map((e: any) => ({
          startTime: e.startTime,
          state: e.state,
          blockName: e.blockName || '',
          teams: e.match?.teams?.map((t: any) => ({
            name: t.name,
            code: t.code,
            image: t.image,
            outcome: t.result?.outcome || null,
            gameWins: t.result?.gameWins ?? 0,
          })),
        }));
    } catch {}

    const result = {
      league: {
        slug: league.slug,
        name: league.name,
        region: league.region || '',
        image: league.image || '',
      },
      tournament: currentTournament ? {
        name: currentTournament.slug || currentTournament.id,
        startDate: currentTournament.startDate,
        endDate: currentTournament.endDate,
      } : null,
      standings,
      matches: allMatches,
    };

    standingsCache[leagueSlug] = { data: result, time: now };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Liga-Details' }, { status: 500 });
  }
}

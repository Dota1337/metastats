import { NextRequest, NextResponse } from 'next/server';

const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

// Cache standings for 30 minutes
let standingsCache: Record<string, { data: any; time: number }> = {};
const CACHE_TTL = 30 * 60 * 1000;

async function fetchTournaments(): Promise<any[]> {
  const res = await fetch(
    'https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US',
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data?.data?.leagues || [];
}

async function fetchLeagues(): Promise<any[]> {
  const res = await fetch(
    'https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US',
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  return data?.data?.leagues || [];
}

async function fetchStandings(tournamentId: string): Promise<any> {
  const res = await fetch(
    `https://esports-api.lolesports.com/persisted/gw/getStandingsV3?hl=en-US&tournamentId=${tournamentId}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!res.ok) return null;
  const data = await res.json();
  return data?.data?.standings || null;
}

async function fetchScheduleForLeague(leagueSlug: string): Promise<any[]> {
  // Fetch schedule filtered by time window (today + 14 days past results + future)
  const res = await fetch(
    'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US',
    { headers: { 'x-api-key': API_KEY } }
  );
  if (!res.ok) return [];
  const data = await res.json();
  const events = data?.data?.schedule?.events || [];
  return events.filter((e: any) => e.league?.slug === leagueSlug && e.type === 'match');
}

export async function GET(request: NextRequest) {
  const leagueSlug = request.nextUrl.searchParams.get('league') || '';

  if (!leagueSlug) {
    // Return list of all active leagues with their current tournaments
    return await getLeaguesOverview();
  }

  // Return standings + matches for a specific league
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
    // Fetch league info and tournaments
    const leagues = await fetchLeagues();
    const league = leagues.find((l: any) => l.slug === leagueSlug);
    if (!league) {
      return NextResponse.json({ error: 'Liga nicht gefunden' }, { status: 404 });
    }

    // Get tournaments for this league to find current tournament ID
    const tournRes = await fetch(
      `https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`,
      { headers: { 'x-api-key': API_KEY } }
    );
    const tournData = await tournRes.json();
    const tournaments = tournData?.data?.leagues?.[0]?.tournaments || [];

    // Find current/most recent tournament
    const nowDate = new Date();
    const currentTournament = tournaments.find((t: any) => {
      const start = new Date(t.startDate);
      const end = new Date(t.endDate);
      return start <= nowDate && end >= nowDate;
    }) || tournaments[tournaments.length - 1];

    // Fetch standings for current tournament
    let standings: any[] = [];
    if (currentTournament) {
      const standingsData = await fetchStandings(currentTournament.id);
      if (standingsData) {
        for (const stage of standingsData) {
          for (const section of stage.stages || []) {
            for (const s of section.sections || []) {
              if (s.rankings) {
                standings = s.rankings.map((r: any) => ({
                  ordinal: r.ordinal,
                  teams: r.teams.map((t: any) => ({
                    name: t.name,
                    code: t.code,
                    image: t.image,
                    wins: t.record?.wins || 0,
                    losses: t.record?.losses || 0,
                  })),
                }));
              }
            }
          }
        }
      }
    }

    // Fetch recent + upcoming matches for this league
    const matches = await fetchScheduleForLeague(leagueSlug);
    const formattedMatches = matches.map((e: any) => ({
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
      matches: formattedMatches,
    };

    standingsCache[leagueSlug] = { data: result, time: now };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Liga-Details' }, { status: 500 });
  }
}

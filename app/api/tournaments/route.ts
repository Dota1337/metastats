import { NextRequest, NextResponse } from 'next/server';

interface Tournament {
  league: string;
  leagueSlug: string;
  region: string;
  blockName: string;
  startTime: string;
  state: 'completed' | 'inProgress' | 'unstarted';
  type: string;
  teams?: { name: string; code: string; image?: string; outcome?: string; gameWins?: number }[];
}

// Important leagues to prioritize
const PRIORITY_LEAGUES = new Set([
  'worlds', 'msi', 'lec', 'lck', 'lpl', 'lcs', 'lta_n', 'lta_s',
  'pcs', 'vcs', 'cblol-brazil', 'ljl-japan', 'first_stand', 'wqs',
  'lta_cross', 'emea_masters', 'lck_challengers_league',
]);

// Cache for 15 minutes
let cached: { data: any; time: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000;
const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

async function fetchLoLEsports(pageToken?: string): Promise<any> {
  const url = pageToken
    ? `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&pageToken=${pageToken}`
    : 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';

  const res = await fetch(url, {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) throw new Error(`LoL Esports API error: ${res.status}`);
  return res.json();
}

async function fetchLeagues(): Promise<Record<string, { name: string; region: string; image?: string }>> {
  const res = await fetch('https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US', {
    headers: { 'x-api-key': API_KEY },
  });
  if (!res.ok) return {};
  const data = await res.json();
  const map: Record<string, { name: string; region: string; image?: string }> = {};
  for (const l of data?.data?.leagues || []) {
    map[l.slug] = { name: l.name, region: l.region, image: l.image };
  }
  return map;
}

export async function GET(request: NextRequest) {
  const now = Date.now();
  const filter = request.nextUrl.searchParams.get('filter') || 'all'; // all, upcoming, live, completed
  const leagueFilter = request.nextUrl.searchParams.get('league') || '';

  if (cached && now - cached.time < CACHE_TTL) {
    return NextResponse.json(applyFilters(cached.data, filter, leagueFilter));
  }

  try {
    const [scheduleData, leagueMap] = await Promise.all([
      fetchLoLEsports(),
      fetchLeagues(),
    ]);

    const events = scheduleData?.data?.schedule?.events || [];

    // Fetch additional pages (older + newer) for full calendar coverage
    let moreEvents: any[] = [];
    const pages = scheduleData?.data?.schedule?.pages || {};
    for (const token of [pages.older, pages.newer]) {
      if (token) {
        try {
          const more = await fetchLoLEsports(token);
          moreEvents.push(...(more?.data?.schedule?.events || []));
        } catch {}
      }
    }

    const allEvents = [...events, ...moreEvents];

    const tournaments: Tournament[] = allEvents
      .filter((e: any) => e.type === 'match')
      .map((e: any) => {
        const leagueSlug = e.league?.slug || '';
        const leagueInfo = leagueMap[leagueSlug];
        return {
          league: e.league?.name || leagueInfo?.name || 'Unknown',
          leagueSlug,
          region: leagueInfo?.region || '',
          blockName: e.blockName || '',
          startTime: e.startTime,
          state: e.state,
          type: e.type,
          teams: e.match?.teams?.map((t: any) => ({
            name: t.name,
            code: t.code,
            image: t.image,
            outcome: t.result?.outcome || null,
            gameWins: t.result?.gameWins ?? 0,
          })),
        };
      });

    // Group by league and sort
    const byLeague: Record<string, Tournament[]> = {};
    for (const t of tournaments) {
      if (!byLeague[t.leagueSlug]) byLeague[t.leagueSlug] = [];
      byLeague[t.leagueSlug].push(t);
    }

    // Sort leagues: priority first, then alphabetical
    const sortedLeagues = Object.keys(byLeague).sort((a, b) => {
      const aPrio = PRIORITY_LEAGUES.has(a) ? 0 : 1;
      const bPrio = PRIORITY_LEAGUES.has(b) ? 0 : 1;
      if (aPrio !== bPrio) return aPrio - bPrio;
      return (byLeague[a][0]?.league || '').localeCompare(byLeague[b][0]?.league || '');
    });

    const result = {
      tournaments,
      byLeague,
      sortedLeagues,
      leagueMap,
      totalMatches: tournaments.length,
      lastUpdated: new Date().toISOString(),
    };

    cached = { data: result, time: now };

    return NextResponse.json(applyFilters(result, filter, leagueFilter));
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Turnierdaten' }, { status: 500 });
  }
}

function applyFilters(data: any, filter: string, league: string) {
  let tournaments = [...(data.tournaments || [])];

  if (filter === 'upcoming') {
    tournaments = tournaments.filter((t: Tournament) => t.state === 'unstarted');
  } else if (filter === 'live') {
    tournaments = tournaments.filter((t: Tournament) => t.state === 'inProgress');
  }

  if (league) {
    tournaments = tournaments.filter((t: Tournament) => t.leagueSlug === league);
  }

  return {
    ...data,
    tournaments,
    totalMatches: tournaments.length,
  };
}

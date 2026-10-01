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

// Cache for 30 minutes (11 API calls per refresh). Fehlte beim Abruf eine
// Seite oder der Ligen-Katalog, nur 60 s und mit degraded halten.
let cached: { data: any; time: number; degraded: boolean } | null = null;
const CACHE_TTL = 30 * 60 * 1000;
const DEGRADED_TTL = 60 * 1000;
import { lolesportsJson } from '../../lib/lolesports';
import { cachedJson, ASSET_CACHE_CONTROL } from '../../lib/api-cache';

async function fetchLoLEsports(pageToken?: string): Promise<any> {
  const url = pageToken
    ? `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&pageToken=${pageToken}`
    : 'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US';
  return lolesportsJson(url);
}

async function fetchLeagues(): Promise<Record<string, { name: string; region: string; image?: string }>> {
  const data = await lolesportsJson('https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US');
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
  // window=full keeps past events (calendar view); default drops them (drawer)
  const fullWindow = request.nextUrl.searchParams.get('window') === 'full';

  if (cached && now - cached.time < (cached.degraded ? DEGRADED_TTL : CACHE_TTL)) {
    // Edge-TTL = Prozess-TTL (30min). Laenger waere hier falsch, obwohl es
    // billiger klingt: `filter=live` transportiert Live-Status.
    return cachedJson(applyFilters(cached.data, filter, leagueFilter, fullWindow), {
      cache: ASSET_CACHE_CONTROL,
      degraded: cached.degraded,
    });
  }

  try {
    let failed = false;
    const [scheduleData, leagueMap] = await Promise.all([
      fetchLoLEsports(),
      fetchLeagues().catch(() => {
        failed = true;
        return {} as Record<string, { name: string; region: string; image?: string }>;
      }),
    ]);

    const events = scheduleData?.data?.schedule?.events || [];

    // Paginate both directions: 5 newer (future fixtures) + 5 older (results)
    // pages. The drawer/calendar consumer decides via the `window` query param
    // whether past events are kept (window=full) or dropped (default).
    const MAX_PAGES = 5;
    const initialPages = scheduleData?.data?.schedule?.pages || {};

    // Beide Richtungen laufen parallel; innerhalb einer Richtung haengt jede
    // Seite am Token der vorigen.
    const walk = async (token: string | undefined, dir: 'newer' | 'older') => {
      const out: any[] = [];
      for (let i = 0; i < MAX_PAGES && token; i++) {
        try {
          const page = await fetchLoLEsports(token);
          out.push(...(page?.data?.schedule?.events || []));
          token = page?.data?.schedule?.pages?.[dir];
        } catch { failed = true; break; }
      }
      return out;
    };
    const [newerEvents, olderEvents] = await Promise.all([
      walk(initialPages.newer, 'newer'),
      walk(initialPages.older, 'older'),
    ]);

    const allEvents = [...events, ...newerEvents, ...olderEvents];

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

    const degraded = failed || tournaments.length === 0;
    cached = { data: result, time: now, degraded };

    return cachedJson(applyFilters(result, filter, leagueFilter, fullWindow), {
      cache: ASSET_CACHE_CONTROL,
      degraded,
    });
  } catch {
    return NextResponse.json(
      { error: 'Fehler beim Laden der Turnierdaten' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}

function applyFilters(data: any, filter: string, league: string, fullWindow: boolean) {
  let tournaments = [...(data.tournaments || [])];

  if (filter === 'live') {
    tournaments = tournaments.filter((t: Tournament) => t.state === 'inProgress');
  } else if (!fullWindow) {
    // Drawer window: today 00:00 UTC through +15 days (exclusive upper bound).
    // Live matches pass through regardless of startTime so an ongoing match that
    // began before midnight UTC never disappears from the drawer.
    const now = new Date();
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const endWindow = startOfToday + 15 * 24 * 60 * 60 * 1000;
    tournaments = tournaments.filter((t: Tournament) => {
      if (t.state === 'inProgress') return true;
      const ts = new Date(t.startTime).getTime();
      return ts >= startOfToday && ts < endWindow;
    });

    if (filter === 'upcoming') {
      tournaments = tournaments.filter((t: Tournament) => t.state === 'unstarted');
    }
  } else if (filter === 'upcoming') {
    // Full window + upcoming filter: keep only future + unstarted.
    tournaments = tournaments.filter((t: Tournament) => t.state === 'unstarted');
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

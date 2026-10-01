import { NextRequest, NextResponse } from 'next/server';

import { lolesportsJson } from '../../../lib/lolesports';
import { cachedJson, ASSET_CACHE_CONTROL } from '../../../lib/api-cache';

const API = 'https://esports-api.lolesports.com/persisted/gw/';

// Vollstaendige Antworten 15 min halten. Fehlte ein Teil (Riot-Aussetzer),
// nur 60 s und mit degraded, sonst bleibt die Liga nach einem kurzen Ausfall
// eine Viertelstunde im Speicher und Stunden an der Edge leer.
const standingsCache: Record<string, { data: unknown; time: number; degraded: boolean }> = {};
const CACHE_TTL = 15 * 60 * 1000;
const DEGRADED_TTL = 60 * 1000;

function fromCache(key: string, now: number) {
  const e = standingsCache[key];
  if (!e || now - e.time >= (e.degraded ? DEGRADED_TTL : CACHE_TTL)) return null;
  return cachedJson(e.data, { cache: ASSET_CACHE_CONTROL, degraded: e.degraded });
}

// Wirft bei Fehler: ein leerer Ligen-Katalog hiesse sonst „Liga nicht gefunden".
async function fetchLeagues(): Promise<any[]> {
  const data = await lolesportsJson(`${API}getLeagues?hl=en-US`);
  return data?.data?.leagues || [];
}

function unavailable() {
  return NextResponse.json(
    { error: 'lolesports unavailable' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
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
  const hit = fromCache(cacheKey, now);
  if (hit) return hit;

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
    const degraded = activeLeagues.length === 0;
    standingsCache[cacheKey] = { data: result, time: now, degraded };
    return cachedJson(result, { cache: ASSET_CACHE_CONTROL, degraded });
  } catch {
    return unavailable();
  }
}

async function getLeagueDetail(leagueSlug: string) {
  const now = Date.now();
  const hit = fromCache(leagueSlug, now);
  if (hit) return hit;

  let leagues: Awaited<ReturnType<typeof fetchLeagues>>;
  try {
    leagues = await fetchLeagues();
  } catch {
    return unavailable();
  }

  try {
    const league = leagues.find((l: any) => l.slug === leagueSlug);
    if (!league) {
      return NextResponse.json({ error: 'Liga nicht gefunden' }, { status: 404 });
    }

    // Ein Teil-Ausfall ist kein leeres Ergebnis: merken, nur kurz halten.
    let failed = false;

    // Turnierliste und Spielplan haengen nicht voneinander ab -> parallel.
    const schedPromise = lolesportsJson(`${API}getSchedule?hl=en-US`).catch(() => null);

    let tournaments = [] as typeof leagues;
    try {
      const tournData = await lolesportsJson(
        `${API}getTournamentsForLeague?hl=en-US&leagueId=${league.id}`,
      );
      tournaments = tournData?.data?.leagues?.[0]?.tournaments || [];
    } catch {
      failed = true;
    }

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
        const standingsData = await lolesportsJson(
          `${API}getStandingsV3?hl=en-US&tournamentId=${currentTournament.id}`,
        );
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
      } catch {
        failed = true;
      }
    }

    // Fetch schedule matches for this league (all pages)
    let allMatches: any[] = [];
    try {
      const schedData = await schedPromise;
      if (!schedData) throw new Error('schedule');

      // Neuere und aeltere Seite parallel nachladen.
      const page = (token: string | undefined) => token
        ? lolesportsJson(`${API}getSchedule?hl=en-US&pageToken=${token}`)
            .then(d => d?.data?.schedule?.events || [])
            .catch(() => { failed = true; return []; })
        : Promise.resolve([]);
      const pages = schedData?.data?.schedule?.pages || {};
      const [newer, older] = await Promise.all([page(pages.newer), page(pages.older)]);
      const events = [...older, ...(schedData?.data?.schedule?.events || []), ...newer];

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
    } catch {
      failed = true;
    }

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

    // Leere Tabelle ausserhalb der Saison ist legitim; degraded nur bei echtem
    // Abruf-Fehler oder wenn gar nichts kam.
    const degraded = failed || (standings.length === 0 && allMatches.length === 0);
    standingsCache[leagueSlug] = { data: result, time: now, degraded };
    return cachedJson(result, { cache: ASSET_CACHE_CONTROL, degraded });
  } catch (error) {
    return NextResponse.json({ error: 'Fehler beim Laden der Liga-Details' }, { status: 500 });
  }
}

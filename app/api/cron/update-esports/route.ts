import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';

const API_KEY = '0TvQnueqKa5mxJntVWt0w4LpLfEkrV1Ta8rQBb9Z';

// Cron job: Fetches latest LoL Esports schedules, standings, and league data
// Stores in Supabase site_config for fast access
// Runs every 2 hours via Vercel Cron

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const results: string[] = [];

  try {
    // 1. Fetch all leagues
    const leaguesRes = await fetch(
      'https://esports-api.lolesports.com/persisted/gw/getLeagues?hl=en-US',
      { headers: { 'x-api-key': API_KEY } }
    );
    const leaguesData = await leaguesRes.json();
    const leagues = leaguesData?.data?.leagues || [];

    await supabase.from('site_config').upsert({
      key: 'esports_leagues',
      value: JSON.stringify(leagues),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    results.push(`Leagues: ${leagues.length} gespeichert`);

    // 2. Fetch schedule (current page + next page)
    const scheduleRes = await fetch(
      'https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US',
      { headers: { 'x-api-key': API_KEY } }
    );
    const scheduleData = await scheduleRes.json();
    let events = scheduleData?.data?.schedule?.events || [];

    // Fetch next page for more upcoming matches
    const newerToken = scheduleData?.data?.schedule?.pages?.newer;
    if (newerToken) {
      try {
        const moreRes = await fetch(
          `https://esports-api.lolesports.com/persisted/gw/getSchedule?hl=en-US&pageToken=${newerToken}`,
          { headers: { 'x-api-key': API_KEY } }
        );
        const moreData = await moreRes.json();
        const moreEvents = moreData?.data?.schedule?.events || [];
        events = [...events, ...moreEvents];
      } catch {}
    }

    const matches = events.filter((e: any) => e.type === 'match');
    await supabase.from('site_config').upsert({
      key: 'esports_schedule',
      value: JSON.stringify(matches),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    results.push(`Schedule: ${matches.length} Matches gespeichert`);

    // 3. Fetch standings for major leagues
    const majorLeagues = leagues.filter((l: any) =>
      ['lec', 'lck', 'lpl', 'lcs', 'lta_n', 'lta_s', 'pcs', 'vcs', 'cblol-brazil', 'ljl-japan', 'worlds', 'msi'].includes(l.slug)
    );

    let standingsCount = 0;
    for (const league of majorLeagues) {
      try {
        // Get tournaments for league
        const tournRes = await fetch(
          `https://esports-api.lolesports.com/persisted/gw/getTournamentsForLeague?hl=en-US&leagueId=${league.id}`,
          { headers: { 'x-api-key': API_KEY } }
        );
        const tournData = await tournRes.json();
        const tournaments = tournData?.data?.leagues?.[0]?.tournaments || [];

        // Find current tournament
        const now = new Date();
        const current = tournaments.find((t: any) => {
          const start = new Date(t.startDate);
          const end = new Date(t.endDate);
          return start <= now && end >= now;
        }) || tournaments[tournaments.length - 1];

        if (current) {
          const standingsRes = await fetch(
            `https://esports-api.lolesports.com/persisted/gw/getStandingsV3?hl=en-US&tournamentId=${current.id}`,
            { headers: { 'x-api-key': API_KEY } }
          );
          const standingsData = await standingsRes.json();
          const standings = standingsData?.data?.standings || [];

          await supabase.from('site_config').upsert({
            key: `esports_standings_${league.slug}`,
            value: JSON.stringify({
              league: { slug: league.slug, name: league.name, region: league.region, image: league.image },
              tournament: { name: current.slug, startDate: current.startDate, endDate: current.endDate },
              standings,
            }),
            updated_at: new Date().toISOString(),
          }, { onConflict: 'key' });
          standingsCount++;
        }
      } catch {}
    }
    results.push(`Standings: ${standingsCount} Ligen aktualisiert`);

    // 4. Count live matches
    const liveCount = matches.filter((m: any) => m.state === 'inProgress').length;
    await supabase.from('site_config').upsert({
      key: 'esports_live_count',
      value: JSON.stringify({ count: liveCount, updatedAt: new Date().toISOString() }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' });
    results.push(`Live: ${liveCount} Matches`);

    return NextResponse.json({
      status: 'success',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Esports update failed',
      details: String(error),
    }, { status: 500 });
  }
}

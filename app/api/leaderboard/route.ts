import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../lib/supabase';

import { getRegionalRouting } from '../../lib/regions';

// In-memory cache for PUUID -> Riot ID (gameName#tagLine)
const nameCache: Record<string, string> = {};
const NAME_RESOLVE_BATCH = 80; // max names to resolve per request (rate limit safe)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'euw1';
  const tier = searchParams.get('tier') || 'CHALLENGER';
  const division = searchParams.get('division') || '';
  const page = parseInt(searchParams.get('page') || '1', 10);
  const search = searchParams.get('search') || '';
  const PAGE_SIZE = 100;
  const apiKey = process.env.RIOT_API_KEY;

  try {
    // Search mode: find players by name in Supabase
    if (search.trim()) {
      const { data: searchResults } = await supabase
        .from('players')
        .select('summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id')
        .ilike('summoner_name', `%${search}%`)
        .order('market_value', { ascending: false, nullsFirst: false })
        .limit(20);

      return NextResponse.json({
        entries: (searchResults || []).map((p, i) => ({
          rank: i + 1,
          summonerName: p.summoner_name,
          region: p.region,
          tier: p.tier,
          playerRank: p.rank,
          winrate: p.winrate || 0,
          marketValue: p.market_value,
          level: p.summoner_level,
          profileIcon: p.profile_icon_id,
        })),
        source: 'search',
        tier: null,
      });
    }

    // Primary: fetch from Riot API
    if (apiKey) {
      const riotRegion = region === 'all' ? 'euw1' : region;
      const isApex = ['CHALLENGER', 'GRANDMASTER', 'MASTER'].includes(tier);

      let riotRes: Response;
      if (isApex) {
        const tierEndpoint = tier === 'GRANDMASTER' ? 'grandmasterleagues'
          : tier === 'MASTER' ? 'masterleagues'
          : 'challengerleagues';
        riotRes = await fetch(
          `https://${riotRegion}.api.riotgames.com/lol/league/v4/${tierEndpoint}/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`
        );
      } else {
        // For Diamond and below: fetch the specific division + page from Riot API
        const div = division || 'I';
        const riotPageRes = await fetch(
          `https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=${page}&api_key=${apiKey}`
        );
        const pageEntries = riotPageRes.ok ? await riotPageRes.json() : [];

        // Check if there's a next page
        let hasNextPage = false;
        if (pageEntries.length >= 205) {
          const peekRes = await fetch(
            `https://${riotRegion}.api.riotgames.com/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${div}?page=${page + 1}&api_key=${apiKey}`
          );
          if (peekRes.ok) {
            const peek = await peekRes.json();
            hasNextPage = peek.length > 0;
          }
        }

        const combinedEntries = pageEntries.map((e: any) => ({
          puuid: e.puuid || null,
          summonerName: e.summonerName || null,
          leaguePoints: e.leaguePoints || 0,
          rank: e.rank,
          wins: e.wins || 0,
          losses: e.losses || 0,
          veteran: e.veteran || false,
          hotStreak: e.hotStreak || false,
          freshBlood: e.freshBlood || false,
        }));
        // Create a synthetic Response
        riotRes = new Response(JSON.stringify({ tier, entries: combinedEntries, _page: page, _hasNextPage: hasNextPage, _division: div }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (riotRes.ok) {
        const league = await riotRes.json();
        const sortedAll = (league.entries || [])
          .sort((a: any, b: any) => b.leaguePoints - a.leaguePoints);

        // For apex tiers: paginate server-side. For non-apex: already paginated by Riot API.
        let pageEntries: any[];
        let totalPlayers: number;
        let hasNextPage: boolean;
        let currentPage: number;
        let startRank: number;

        if (isApex) {
          totalPlayers = sortedAll.length;
          const start = (page - 1) * PAGE_SIZE;
          pageEntries = sortedAll.slice(start, start + PAGE_SIZE);
          hasNextPage = start + PAGE_SIZE < totalPlayers;
          currentPage = page;
          startRank = start;
        } else {
          pageEntries = sortedAll;
          totalPlayers = pageEntries.length; // we don't know the total for non-apex
          hasNextPage = league._hasNextPage || false;
          currentPage = league._page || page;
          startRank = (currentPage - 1) * 205; // Riot uses 205 per page
        }

        // Load known players from Supabase for enrichment
        const { data: knownPlayers } = await supabase
          .from('players')
          .select('puuid, summoner_name, market_value, profile_icon_id, summoner_level')
          .eq('region', riotRegion);

        const knownMap: Record<string, any> = {};
        for (const p of knownPlayers || []) {
          if (p.puuid) {
            knownMap[p.puuid] = p;
            if (p.summoner_name && !nameCache[p.puuid]) {
              nameCache[p.puuid] = p.summoner_name;
            }
          }
        }

        // Resolve missing names via Account API (batched)
        const regional = getRegionalRouting(riotRegion);
        const unresolvedPuuids = pageEntries
          .map((e: any) => e.puuid)
          .filter((puuid: string) => puuid && !nameCache[puuid]);

        const toResolve = unresolvedPuuids.slice(0, NAME_RESOLVE_BATCH);
        if (toResolve.length > 0) {
          for (let i = 0; i < toResolve.length; i += 10) {
            const batch = toResolve.slice(i, i + 10);
            await Promise.all(
              batch.map(async (puuid: string) => {
                try {
                  const accRes = await fetch(
                    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${apiKey}`
                  );
                  if (accRes.ok) {
                    const acc = await accRes.json();
                    if (acc.gameName) {
                      nameCache[puuid] = `${acc.gameName}#${acc.tagLine || ''}`;
                    }
                  }
                } catch {}
              })
            );
          }
        }

        const entries = pageEntries.map((e: any, i: number) => {
          const known = e.puuid ? knownMap[e.puuid] : null;
          const cachedName = e.puuid ? nameCache[e.puuid] : null;
          const wr = (e.wins + e.losses) > 0
            ? Math.round((e.wins / (e.wins + e.losses)) * 100)
            : 0;

          return {
            rank: startRank + i + 1,
            summonerName: cachedName || known?.summoner_name || null,
            puuid: e.puuid || null,
            region: riotRegion,
            tier: league.tier,
            playerRank: e.rank,
            leaguePoints: e.leaguePoints,
            wins: e.wins,
            losses: e.losses,
            winrate: wr,
            marketValue: known?.market_value || null,
            level: known?.summoner_level || 0,
            profileIcon: known?.profile_icon_id || 0,
            veteran: e.veteran,
            hotStreak: e.hotStreak,
            freshBlood: e.freshBlood,
          };
        });

        return NextResponse.json({
          entries,
          source: 'riot',
          tier: league.tier,
          totalPlayers: isApex ? totalPlayers : undefined,
          page: currentPage,
          hasNextPage,
          hasPrevPage: currentPage > 1,
          region: riotRegion,
        });
      }
    }

    // Fallback: Supabase only
    let query = supabase
      .from('players')
      .select('summoner_name, region, tier, rank, winrate, market_value, summoner_level, profile_icon_id');

    if (tier === 'CHALLENGER') query = query.eq('tier', 'CHALLENGER');
    else if (tier === 'GRANDMASTER') query = query.eq('tier', 'GRANDMASTER');
    else if (tier === 'MASTER') query = query.eq('tier', 'MASTER');

    if (region !== 'all') query = query.eq('region', region);

    const { data: players } = await query
      .order('market_value', { ascending: false, nullsFirst: false })
      .limit(50);

    return NextResponse.json({
      entries: (players || []).map((p, i) => ({
        rank: i + 1,
        summonerName: p.summoner_name,
        region: p.region,
        tier: p.tier,
        playerRank: p.rank,
        winrate: p.winrate || 0,
        marketValue: p.market_value,
        level: p.summoner_level,
        profileIcon: p.profile_icon_id,
      })),
      source: 'database',
      tier,
    });

  } catch (error) {
    return NextResponse.json({ error: 'Server Fehler', entries: [] }, { status: 500 });
  }
}

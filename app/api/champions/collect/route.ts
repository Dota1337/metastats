import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '../../../lib/supabase';
import { getRegionalRouting } from '../../../lib/regions';

// In-memory cache per region (survives across requests in serverless for a while)
const cache: Record<string, { data: any; ts: number }> = {};
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Collects champion statistics from high-elo matches for a given region.
 * Fetches Challenger + Grandmaster players, samples their recent matches,
 * and returns computed champion win/pick/ban rates.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const region = searchParams.get('region') || 'euw1';
  const apiKey = process.env.RIOT_API_KEY!;
  const regional = getRegionalRouting(region);
  const forceRefresh = searchParams.get('refresh') === '1';

  if (!apiKey) {
    return NextResponse.json({ error: 'API Key not configured' }, { status: 500 });
  }

  // Return cached data if fresh (unless force refresh)
  if (!forceRefresh && cache[region] && Date.now() - cache[region].ts < CACHE_TTL) {
    return NextResponse.json(cache[region].data);
  }

  try {
    // Fetch Challenger + Grandmaster + Master league entries
    const [challRes, gmRes, masterRes] = await Promise.all([
      fetch(`https://${region}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`),
      fetch(`https://${region}.api.riotgames.com/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`),
      fetch(`https://${region}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5?api_key=${apiKey}`),
    ]);

    const allEntries: any[] = [];
    if (challRes.ok) {
      const chall = await challRes.json();
      if (chall.entries) allEntries.push(...chall.entries.map((e: any) => ({ ...e, tier: 'CHALLENGER' })));
    }
    if (gmRes.ok) {
      const gm = await gmRes.json();
      if (gm.entries) allEntries.push(...gm.entries.map((e: any) => ({ ...e, tier: 'GRANDMASTER' })));
    }
    if (masterRes.ok) {
      const master = await masterRes.json();
      if (master.entries) allEntries.push(...master.entries.map((e: any) => ({ ...e, tier: 'MASTER' })));
    }

    if (allEntries.length === 0) {
      return NextResponse.json({ error: 'Keine Liga-Daten verfuegbar', region }, { status: 404 });
    }

    // Sample players from each tier for balanced representation
    // Keep it small enough to finish within Vercel's 60s timeout
    const challEntries = allEntries.filter(e => e.tier === 'CHALLENGER').sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, 8);
    const gmEntries = allEntries.filter(e => e.tier === 'GRANDMASTER').sort((a, b) => b.leaguePoints - a.leaguePoints).slice(0, 8);
    // Skip top 100 Master (they overlap with GM games), take the next 15
    const masterAll = allEntries.filter(e => e.tier === 'MASTER').sort((a, b) => b.leaguePoints - a.leaguePoints);
    const masterEntries = masterAll.slice(100, 115);
    const samplePlayers = [...challEntries, ...gmEntries, ...masterEntries];

    // Build tier map: puuid -> tier (most entries have puuid directly)
    const puuidTierMap: Record<string, string> = {};
    const puuids: string[] = [];
    const needResolve: any[] = [];

    for (const entry of samplePlayers) {
      if (entry.puuid) {
        puuidTierMap[entry.puuid] = entry.tier;
        puuids.push(entry.puuid);
      } else {
        needResolve.push(entry);
      }
    }

    // Only resolve entries without puuid (rare, older API responses)
    if (needResolve.length > 0) {
      const results = await Promise.all(
        needResolve.map(async (entry) => {
          try {
            const res = await fetch(
              `https://${region}.api.riotgames.com/lol/summoner/v4/summoners/${entry.summonerId}?api_key=${apiKey}`
            );
            if (!res.ok) return null;
            const data = await res.json();
            puuidTierMap[data.puuid] = entry.tier;
            return data.puuid;
          } catch { return null; }
        })
      );
      puuids.push(...results.filter(Boolean) as string[]);
    }

    const matchTierMap: Record<string, string> = {};

    // Fetch match IDs — process each tier separately to ensure clean tier attribution
    const allMatchIds = new Set<string>();

    // Group puuids by tier for sequential processing
    const puuidsByTier: Record<string, string[]> = { CHALLENGER: [], GRANDMASTER: [], MASTER: [] };
    for (const puuid of puuids) {
      const tier = puuidTierMap[puuid] || 'MASTER';
      puuidsByTier[tier]?.push(puuid);
    }

    // Process Master first so they get their own matches before C/GM claim them
    const tierOrder: [string, string[]][] = [
      ['MASTER', puuidsByTier['MASTER'] || []],
      ['GRANDMASTER', puuidsByTier['GRANDMASTER'] || []],
      ['CHALLENGER', puuidsByTier['CHALLENGER'] || []],
    ];
    for (const [tier, tierPuuids] of tierOrder) {
      for (let i = 0; i < tierPuuids.length; i += 10) {
        const batch = tierPuuids.slice(i, i + 10);
        const results = await Promise.all(
          batch.map(async (puuid) => {
            try {
              const res = await fetch(
                `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?queue=420&start=0&count=8&api_key=${apiKey}`
              );
              if (!res.ok) return [];
              return res.json();
            } catch {
              return [];
            }
          })
        );
        for (const ids of results) {
          for (const id of ids as string[]) {
            if (!allMatchIds.has(id)) {
              allMatchIds.add(id);
              matchTierMap[id] = tier;
            }
          }
        }
      }
    }

    // Fetch match details (up to 100 unique matches within timeout)
    const matchIdArray = Array.from(allMatchIds).slice(0, 100);

    // Stats per tier + aggregated
    type ChampStat = { wins: number; games: number; kills: number; deaths: number; assists: number; bans: number };
    const tierStats: Record<string, Record<string, ChampStat>> = {
      CHALLENGER: {}, GRANDMASTER: {}, MASTER: {}, ALL: {},
    };
    const tierGames: Record<string, number> = { CHALLENGER: 0, GRANDMASTER: 0, MASTER: 0, ALL: 0 };

    const ensureStat = (tier: string, key: string) => {
      if (!tierStats[tier][key]) tierStats[tier][key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
    };

    for (let i = 0; i < matchIdArray.length; i += 10) {
      const batch = matchIdArray.slice(i, i + 10);
      const results = await Promise.all(
        batch.map(async (matchId) => {
          try {
            const res = await fetch(
              `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchId}?api_key=${apiKey}`
            );
            if (!res.ok) return { matchId, data: null };
            return { matchId, data: await res.json() };
          } catch {
            return { matchId, data: null };
          }
        })
      );

      for (const { matchId, data: match } of results) {
        if (!match?.info?.participants) continue;
        if (match.info.queueId !== 420) continue;

        const matchTier = matchTierMap[matchId] || 'MASTER';
        tierGames[matchTier]++;
        tierGames['ALL']++;

        for (const p of match.info.participants) {
          const key = String(p.championId);
          for (const t of [matchTier, 'ALL']) {
            ensureStat(t, key);
            tierStats[t][key].games++;
            if (p.win) tierStats[t][key].wins++;
            tierStats[t][key].kills += p.kills || 0;
            tierStats[t][key].deaths += p.deaths || 0;
            tierStats[t][key].assists += p.assists || 0;
          }
        }

        for (const team of match.info.teams || []) {
          for (const ban of team.bans || []) {
            if (ban.championId > 0) {
              const key = String(ban.championId);
              for (const t of [matchTier, 'ALL']) {
                ensureStat(t, key);
                tierStats[t][key].bans++;
              }
            }
          }
        }
      }
    }

    // Save per-tier stats to Supabase (batched for speed)
    let savedCount = 0;
    const now = new Date().toISOString();
    for (const tierKey of ['CHALLENGER', 'GRANDMASTER', 'MASTER'] as const) {
      const stats = tierStats[tierKey];
      const totalParticipant = tierGames[tierKey] * 10;
      if (totalParticipant === 0) continue;

      const rows = Object.entries(stats).map(([champKey, s]) => ({
        champion_key: champKey,
        tier: tierKey,
        region: region,
        wins: s.wins,
        games: s.games,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        bans: s.bans,
        total_games_in_tier: totalParticipant,
        updated_at: now,
      }));

      // Upsert in batches of 50
      for (let b = 0; b < rows.length; b += 50) {
        await supabase.from('champion_stats').upsert(rows.slice(b, b + 50), { onConflict: 'champion_key,tier,region' });
      }
      savedCount += rows.length;
    }

    const totalGames = tierGames['ALL'];
    const totalParticipantGames = totalGames * 10;
    const champStats = tierStats['ALL'];

    const result = {
      region,
      matchesAnalyzed: totalGames,
      totalParticipantGames,
      championsFound: Object.keys(champStats).length,
      stats: champStats,
      perTier: {
        CHALLENGER: { matches: tierGames['CHALLENGER'], champions: Object.keys(tierStats['CHALLENGER']).length },
        GRANDMASTER: { matches: tierGames['GRANDMASTER'], champions: Object.keys(tierStats['GRANDMASTER']).length },
        MASTER: { matches: tierGames['MASTER'], champions: Object.keys(tierStats['MASTER']).length },
      },
      savedToSupabase: savedCount,
    };

    cache[region] = { data: result, ts: Date.now() };

    return NextResponse.json(result);

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Collection failed' }, { status: 500 });
  }
}

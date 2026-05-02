/**
 * Collects champion statistics from Korean + Chinese high-elo players.
 * KR: Direct from Riot API (kr region)
 * CN: Not available via Riot API — Chinese servers are operated by Tencent.
 *     We collect KR data which includes many Chinese pros playing on KR server.
 *
 * Handles Riot API rate limits: 100 requests / 2 minutes.
 * Saves results to public/champion-stats-kr.json + public/champion-builds-kr.json + Supabase.
 */

import { loadBootSet, aggregateMatch, finalizeBuilds, ALLOWED_QUEUES } from './lib/build-aggregator.mjs';

const API_KEY = process.env.RIOT_API_KEY;
if (!API_KEY) {
  console.error('RIOT_API_KEY env var required');
  process.exit(1);
}

const REGIONS = [
  { id: 'kr', regional: 'asia', label: 'Korea' },
];

let requestCount = 0;
let windowStart = Date.now();
const MAX_REQUESTS_PER_WINDOW = 90;
const WINDOW_MS = 2 * 60 * 1000 + 5000;

async function rateLimitedFetch(url) {
  const elapsed = Date.now() - windowStart;
  if (requestCount >= MAX_REQUESTS_PER_WINDOW) {
    const waitTime = WINDOW_MS - elapsed;
    if (waitTime > 0) {
      console.log(`  [Rate Limit] ${requestCount} Requests. Warte ${Math.ceil(waitTime / 1000)}s...`);
      await sleep(waitTime);
    }
    requestCount = 0;
    windowStart = Date.now();
  }
  requestCount++;
  const res = await fetch(url);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '120', 10);
    console.log(`  [429] Rate limited! Warte ${retryAfter}s...`);
    await sleep(retryAfter * 1000 + 2000);
    requestCount = 0;
    windowStart = Date.now();
    return rateLimitedFetch(url);
  }
  return res;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function collectRegion(region, regional, label) {
  console.log(`\n=== ${label} (${region}) — Challenger + Grandmaster + Master ===\n`);

  // Step 1: Fetch leagues
  console.log('[1/4] Lade Ligen...');
  const [challRes, gmRes, masterRes] = await Promise.all([
    rateLimitedFetch(`https://${region}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`),
    rateLimitedFetch(`https://${region}.api.riotgames.com/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`),
    rateLimitedFetch(`https://${region}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`),
  ]);

  if (!challRes.ok || !gmRes.ok) {
    console.error('Fehler:', challRes.status, gmRes.status);
    return;
  }

  const chall = await challRes.json();
  const gm = await gmRes.json();
  const master = masterRes.ok ? await masterRes.json() : { entries: [] };

  const allPlayers = [
    ...(chall.entries || []).map(e => ({ ...e, tier: 'CHALLENGER' })),
    ...(gm.entries || []).map(e => ({ ...e, tier: 'GRANDMASTER' })),
    ...(master.entries || []).map(e => ({ ...e, tier: 'MASTER' })),
  ];
  allPlayers.sort((a, b) => b.leaguePoints - a.leaguePoints);

  // Sample: all C+GM, top 200 Master
  const masterSample = allPlayers.filter(e => e.tier === 'MASTER').slice(0, 200);
  const sampledPlayers = [
    ...allPlayers.filter(e => e.tier !== 'MASTER'),
    ...masterSample,
  ];
  const puuids = sampledPlayers.map(e => e.puuid).filter(Boolean);
  const puuidTierMap = {};
  for (const p of sampledPlayers) {
    if (p.puuid) puuidTierMap[p.puuid] = p.tier;
  }

  console.log(`  Challenger: ${chall.entries?.length || 0}`);
  console.log(`  Grandmaster: ${gm.entries?.length || 0}`);
  console.log(`  Master: ${master.entries?.length || 0} (top ${masterSample.length} gesampled)`);
  console.log(`  Gesamt: ${puuids.length} Spieler\n`);

  // Step 2: Fetch match IDs per tier (Solo+Flex)
  console.log('[2/4] Lade Match-IDs (Solo+Flex, je 8 pro Spieler)...');
  const allMatchIds = new Set();
  const matchTierMap = {};

  const tierOrder = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
  for (const tier of tierOrder) {
    const tierPuuids = puuids.filter(p => puuidTierMap[p] === tier);
    for (let i = 0; i < tierPuuids.length; i++) {
      for (const queue of [420, 440]) {
        try {
          const res = await rateLimitedFetch(
            `https://${regional}.api.riotgames.com/lol/match/v5/matches/by-puuid/${tierPuuids[i]}/ids?queue=${queue}&start=0&count=8&api_key=${API_KEY}`
          );
          if (res.ok) {
            const ids = await res.json();
            for (const id of ids) {
              if (!allMatchIds.has(id)) {
                allMatchIds.add(id);
                matchTierMap[id] = tier;
              }
            }
          }
        } catch {}
      }
      if ((i + 1) % 25 === 0 || i === tierPuuids.length - 1) {
        console.log(`  ${tier}: ${i + 1}/${tierPuuids.length} (${allMatchIds.size} unique)`);
      }
    }
  }
  console.log(`\n  ${allMatchIds.size} einzigartige Matches\n`);

  // Step 3: Fetch match details + builds
  console.log('[3/4] Lade Match-Details...');
  const ddVersionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const ddVersions = await ddVersionRes.json();
  const ddVersion = ddVersions[0];
  const bootSet = await loadBootSet(ddVersion);
  console.log(`  Data Dragon ${ddVersion} — ${bootSet.size} Boot-Item-IDs erkannt`);

  const matchIdArray = Array.from(allMatchIds);
  const champStats = {};
  const tierStats = { CHALLENGER: {}, GRANDMASTER: {}, MASTER: {} };
  const tierGames = { CHALLENGER: 0, GRANDMASTER: 0, MASTER: 0 };
  const builds = {};
  let totalGames = 0;
  let errors = 0;

  for (let i = 0; i < matchIdArray.length; i++) {
    try {
      const res = await rateLimitedFetch(
        `https://${regional}.api.riotgames.com/lol/match/v5/matches/${matchIdArray[i]}?api_key=${API_KEY}`
      );
      if (res.ok) {
        const match = await res.json();
        if (match?.info?.participants && ALLOWED_QUEUES.has(match.info.queueId)) {
          totalGames++;
          const mTier = matchTierMap[matchIdArray[i]] || 'MASTER';
          tierGames[mTier]++;

          for (const p of match.info.participants) {
            const key = String(p.championId);
            if (!champStats[key]) champStats[key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
            champStats[key].games++;
            if (p.win) champStats[key].wins++;
            champStats[key].kills += p.kills || 0;
            champStats[key].deaths += p.deaths || 0;
            champStats[key].assists += p.assists || 0;

            if (!tierStats[mTier][key]) tierStats[mTier][key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
            tierStats[mTier][key].games++;
            if (p.win) tierStats[mTier][key].wins++;
            tierStats[mTier][key].kills += p.kills || 0;
            tierStats[mTier][key].deaths += p.deaths || 0;
            tierStats[mTier][key].assists += p.assists || 0;
          }

          for (const team of match.info.teams || []) {
            for (const ban of team.bans || []) {
              if (ban.championId > 0) {
                const key = String(ban.championId);
                if (!champStats[key]) champStats[key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
                champStats[key].bans++;
                if (!tierStats[mTier][key]) tierStats[mTier][key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
                tierStats[mTier][key].bans++;
              }
            }
          }

          aggregateMatch(match, builds, bootSet);
        }
      } else { errors++; }
    } catch { errors++; }

    if ((i + 1) % 50 === 0 || i === matchIdArray.length - 1) {
      console.log(`  ${i + 1}/${matchIdArray.length} (${totalGames} Ranked, ${errors} Fehler)`);
    }
  }

  const totalParticipantGames = totalGames * 10;

  // Save JSON
  const fs = await import('fs');
  const output = {
    region, collectedAt: new Date().toISOString(),
    matchesAnalyzed: totalGames, totalParticipantGames,
    playersScanned: puuids.length,
    championsFound: Object.keys(champStats).length,
    perTier: {
      CHALLENGER: { matches: tierGames.CHALLENGER, champions: Object.keys(tierStats.CHALLENGER).length },
      GRANDMASTER: { matches: tierGames.GRANDMASTER, champions: Object.keys(tierStats.GRANDMASTER).length },
      MASTER: { matches: tierGames.MASTER, champions: Object.keys(tierStats.MASTER).length },
    },
    stats: champStats,
  };
  fs.writeFileSync(`public/champion-stats-${region}.json`, JSON.stringify(output));
  console.log(`\n  -> public/champion-stats-${region}.json`);

  // Builds JSON
  const buildsOut = {
    region,
    collectedAt: new Date().toISOString(),
    matchesAnalyzed: totalGames,
    ddragonVersion: ddVersion,
    byChampionRole: finalizeBuilds(builds),
  };
  fs.writeFileSync(`public/champion-builds-${region}.json`, JSON.stringify(buildsOut));
  const champRoleCount = Object.values(buildsOut.byChampionRole).reduce((a, r) => a + Object.keys(r).length, 0);
  console.log(`  -> public/champion-builds-${region}.json (${Object.keys(buildsOut.byChampionRole).length} Champs, ${champRoleCount} Champ×Rollen)`);

  // Step 4: Save to Supabase
  console.log('\n[4/4] Supabase speichern...');
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (SUPABASE_KEY) {
    const now = new Date().toISOString();
    let saved = 0;
    for (const tierKey of ['CHALLENGER', 'GRANDMASTER', 'MASTER']) {
      const stats = tierStats[tierKey];
      const totalInTier = tierGames[tierKey] * 10;
      if (totalInTier === 0) continue;
      const rows = Object.entries(stats).map(([champKey, s]) => ({
        champion_key: champKey, tier: tierKey, region,
        wins: s.wins, games: s.games, kills: s.kills, deaths: s.deaths, assists: s.assists, bans: s.bans,
        total_games_in_tier: totalInTier, updated_at: now,
      }));
      for (let b = 0; b < rows.length; b += 50) {
        const batch = rows.slice(b, b + 50);
        const res = await fetch(`${SUPABASE_URL}/rest/v1/champion_stats`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) console.log(`  Supabase error ${tierKey}: ${res.status}`);
      }
      saved += rows.length;
      console.log(`  ${tierKey}: ${rows.length} Champions (${tierGames[tierKey]} Matches)`);
    }
    console.log(`  Gesamt: ${saved} Eintraege`);
  } else {
    console.log('  SUPABASE_SERVICE_ROLE_KEY fehlt!');
  }

  console.log(`\n  ${label}: ${totalGames} Matches (C:${tierGames.CHALLENGER} GM:${tierGames.GRANDMASTER} M:${tierGames.MASTER}), ${Object.keys(champStats).length} Champions`);
}

async function main() {
  for (const r of REGIONS) {
    await collectRegion(r.id, r.regional, r.label);
  }
  console.log('\n=== Alle Regionen fertig! ===');
}

main().catch(e => { console.error(e); process.exit(1); });

/**
 * Collects champion statistics from ALL Challenger + Grandmaster players (EUW).
 * Rate-limiting handled by the shared Riot client (200 req/s on production key).
 * Saves:
 *   - public/champion-stats-euw.json   (legacy aggregate stats)
 *   - public/champion-builds-euw.json  (per-champion-per-role builds, runes, counters)
 */

import { loadBootSet, aggregateMatch, finalizeBuilds, ALLOWED_QUEUES } from './lib/build-aggregator.mjs';
import { createRiotClient } from './lib/riot-client.mjs';

const API_KEY = process.env.RIOT_API_KEY;
if (!API_KEY) {
  console.error('RIOT_API_KEY env var required');
  process.exit(1);
}
const REGION = 'euw1';
const REGIONAL = 'europe';

const riot = createRiotClient();
const rateLimitedFetch = riot.fetch;

async function main() {
  console.log('=== Champion-Stats Collector: Challenger + Grandmaster + Master (EUW) ===\n');

  // Step 1: Fetch all apex leagues (puuids are directly in entries!)
  console.log('[1/3] Lade Challenger + Grandmaster + Master Ligen...');
  const challRes = await rateLimitedFetch(
    `https://${REGION}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`
  );
  const gmRes = await rateLimitedFetch(
    `https://${REGION}.api.riotgames.com/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`
  );
  const masterRes = await rateLimitedFetch(
    `https://${REGION}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`
  );

  if (!challRes.ok || !gmRes.ok) {
    console.error('Fehler beim Laden der Ligen:', challRes.status, gmRes.status);
    process.exit(1);
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

  // Sample: all Challenger + GM, plus top 200 Master (by LP) for manageable API calls
  const challGmCount = (chall.entries?.length || 0) + (gm.entries?.length || 0);
  const masterSample = allPlayers.filter(e => e.tier === 'MASTER').slice(0, 200);
  const sampledPlayers = [
    ...allPlayers.filter(e => e.tier !== 'MASTER'),
    ...masterSample,
  ];
  const puuids = sampledPlayers.map(e => e.puuid).filter(Boolean);

  console.log(`  Challenger: ${chall.entries?.length || 0} Spieler`);
  console.log(`  Grandmaster: ${gm.entries?.length || 0} Spieler`);
  console.log(`  Master: ${master.entries?.length || 0} Spieler (top ${masterSample.length} gesampled)`);
  console.log(`  Gesamt: ${puuids.length} Spieler mit PUUID\n`);

  // Build tier map for each puuid
  const puuidTierMap = {};
  for (const p of sampledPlayers) {
    if (p.puuid) puuidTierMap[p.puuid] = p.tier;
  }

  // Step 2: Fetch match IDs (Solo-only — Flex was tried in Stage 2 but the
  // doubled match volume blows the 360min GHA cap on a dev key. Build
  // aggregation works perfectly fine on Solo data alone, and Flex queues
  // tend to skew toward off-meta picks anyway.)
  console.log('[2/4] Lade Match-IDs (Solo, 8 pro Spieler)...');
  const allMatchIds = new Set();
  const matchTierMap = {};

  // Process Master first, then GM, then Challenger (so each tier gets unique matches)
  const tierOrder = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
  for (const tier of tierOrder) {
    const tierPuuids = puuids.filter(p => puuidTierMap[p] === tier);
    for (let i = 0; i < tierPuuids.length; i++) {
      try {
        const res = await rateLimitedFetch(
          `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/by-puuid/${tierPuuids[i]}/ids?queue=420&start=0&count=8&api_key=${API_KEY}`
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

      if ((i + 1) % 25 === 0 || i === tierPuuids.length - 1) {
        console.log(`  ${tier}: ${i + 1}/${tierPuuids.length} Spieler (${allMatchIds.size} unique Matches)`);
      }
    }
  }

  console.log(`\n  ${allMatchIds.size} einzigartige Matches gefunden\n`);

  // Step 3: Fetch match details + aggregate per tier (legacy stats) + per role (builds)
  console.log('[3/4] Lade Match-Details und berechne Stats...');
  const ddVersionRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const ddVersions = await ddVersionRes.json();
  const ddVersion = ddVersions[0];
  const bootSet = await loadBootSet(ddVersion);
  console.log(`  Data Dragon ${ddVersion} — ${bootSet.size} Boot-Item-IDs erkannt`);

  const matchIdArray = Array.from(allMatchIds);
  const champStats = {};
  const tierStats = { CHALLENGER: {}, GRANDMASTER: {}, MASTER: {} };
  const tierGames = { CHALLENGER: 0, GRANDMASTER: 0, MASTER: 0 };
  const builds = {};                  // Per-role build aggregator
  let totalGames = 0;
  let errors = 0;

  for (let i = 0; i < matchIdArray.length; i++) {
    try {
      const res = await rateLimitedFetch(
        `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/${matchIdArray[i]}?api_key=${API_KEY}`
      );
      if (res.ok) {
        const match = await res.json();
        if (match?.info?.participants && ALLOWED_QUEUES.has(match.info.queueId)) {
          totalGames++;
          const mTier = matchTierMap[matchIdArray[i]] || 'MASTER';
          tierGames[mTier] = (tierGames[mTier] || 0) + 1;

          for (const p of match.info.participants) {
            const key = String(p.championId);
            // Aggregate stats
            if (!champStats[key]) champStats[key] = { wins: 0, games: 0, kills: 0, deaths: 0, assists: 0, bans: 0 };
            champStats[key].games++;
            if (p.win) champStats[key].wins++;
            champStats[key].kills += p.kills || 0;
            champStats[key].deaths += p.deaths || 0;
            champStats[key].assists += p.assists || 0;

            // Per-tier stats
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

          // Build aggregation (per champion + teamPosition)
          aggregateMatch(match, builds, bootSet);
        }
      } else {
        errors++;
      }
    } catch {
      errors++;
    }

    if ((i + 1) % 50 === 0 || i === matchIdArray.length - 1) {
      console.log(`  ${i + 1}/${matchIdArray.length} Matches (${totalGames} Ranked, ${Object.keys(champStats).length} Champs, ${errors} Fehler)`);
    }
  }

  const totalParticipantGames = totalGames * 10;

  // Save to JSON
  const output = {
    region: REGION,
    collectedAt: new Date().toISOString(),
    matchesAnalyzed: totalGames,
    totalParticipantGames,
    playersScanned: puuids.length,
    championsFound: Object.keys(champStats).length,
    perTier: {
      CHALLENGER: { matches: tierGames.CHALLENGER, champions: Object.keys(tierStats.CHALLENGER).length },
      GRANDMASTER: { matches: tierGames.GRANDMASTER, champions: Object.keys(tierStats.GRANDMASTER).length },
      MASTER: { matches: tierGames.MASTER, champions: Object.keys(tierStats.MASTER).length },
    },
    stats: champStats,
  };

  const fs = await import('fs');
  fs.writeFileSync('public/champion-stats-euw.json', JSON.stringify(output));
  console.log('\n  -> public/champion-stats-euw.json gespeichert');

  // Builds JSON
  const buildsOut = {
    region: REGION,
    collectedAt: new Date().toISOString(),
    matchesAnalyzed: totalGames,
    ddragonVersion: ddVersion,
    byChampionRole: finalizeBuilds(builds),
  };
  fs.writeFileSync('public/champion-builds-euw.json', JSON.stringify(buildsOut));
  const champRoleCount = Object.values(buildsOut.byChampionRole).reduce((a, r) => a + Object.keys(r).length, 0);
  console.log(`  -> public/champion-builds-euw.json gespeichert (${Object.keys(buildsOut.byChampionRole).length} Champs, ${champRoleCount} Champ×Rollen)`);

  // Step 4: Save per-tier stats to Supabase
  console.log('\n[4/4] Speichere per-Tier Stats in Supabase...');
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

  if (SUPABASE_KEY) {
    const now = new Date().toISOString();
    let savedCount = 0;

    for (const tierKey of ['CHALLENGER', 'GRANDMASTER', 'MASTER']) {
      const stats = tierStats[tierKey];
      const totalInTier = tierGames[tierKey] * 10;
      if (totalInTier === 0) continue;

      const rows = Object.entries(stats).map(([champKey, s]) => ({
        champion_key: champKey,
        tier: tierKey,
        region: REGION,
        wins: s.wins,
        games: s.games,
        kills: s.kills,
        deaths: s.deaths,
        assists: s.assists,
        bans: s.bans,
        total_games_in_tier: totalInTier,
        updated_at: now,
      }));

      // Upsert in batches of 50
      for (let b = 0; b < rows.length; b += 50) {
        const batch = rows.slice(b, b + 50);
        const res = await fetch(`${SUPABASE_URL}/rest/v1/champion_stats`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(batch),
        });
        if (!res.ok) {
          console.log(`  Supabase error for ${tierKey}: ${res.status}`);
        }
      }
      savedCount += rows.length;
      console.log(`  ${tierKey}: ${rows.length} Champions gespeichert (${tierGames[tierKey]} Matches)`);
    }
    console.log(`  Gesamt: ${savedCount} Eintraege in Supabase`);
  } else {
    console.log('  SUPABASE_SERVICE_ROLE_KEY nicht gesetzt, ueberspringe Supabase.');
  }

  // Top 15
  console.log('\n=== Top 15 Champions (Pickrate, Challenger+GM+Master EUW) ===');
  Object.entries(champStats)
    .map(([key, s]) => ({
      key,
      wr: ((s.wins / s.games) * 100).toFixed(1),
      pr: ((s.games / totalParticipantGames) * 100).toFixed(1),
      br: ((s.bans / totalGames) * 100).toFixed(1),
      kda: s.deaths > 0 ? ((s.kills + s.assists) / s.deaths).toFixed(2) : 'P',
      games: s.games,
    }))
    .sort((a, b) => b.games - a.games)
    .slice(0, 15)
    .forEach((c, i) => {
      console.log(`  ${i + 1}. ID:${c.key} | ${c.games} Games | ${c.wr}% WR | ${c.pr}% PR | ${c.br}% BR | ${c.kda} KDA`);
    });

  console.log(`\nFertig! ${totalGames} Matches (C:${tierGames.CHALLENGER} GM:${tierGames.GRANDMASTER} M:${tierGames.MASTER}), ${Object.keys(champStats).length} Champions.`);
}

main().catch(e => { console.error(e); process.exit(1); });

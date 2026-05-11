/**
 * Smoke test for the centralized Riot client + crawler pipeline.
 * Runs the same call patterns as collect-highelo.mjs but only against
 * a tiny sample (3 players, 2 matches each) and writes no output files.
 *
 * Verifies the refactor end-to-end:
 *   1. League fetch (Challenger)
 *   2. Match-IDs by puuid (regional endpoint)
 *   3. Match details (regional endpoint)
 *   4. Build aggregator integration
 *   5. Rate-limiting behaviour under steady + burst load
 */

import { loadBootSet, aggregateMatch, finalizeBuilds, ALLOWED_QUEUES } from './lib/build-aggregator.mjs';
import { createRiotClient } from './lib/riot-client.mjs';

const API_KEY = process.env.RIOT_API_KEY;
if (!API_KEY) { console.error('RIOT_API_KEY required'); process.exit(1); }

const REGION = 'euw1';
const REGIONAL = 'europe';
const SAMPLE_PLAYERS = 3;
const MATCHES_PER_PLAYER = 2;

const riot = createRiotClient();

async function main() {
  const t0 = Date.now();
  console.log(`=== Smoke Test: Riot Client + Pipeline ===\n`);

  // Step 1: League
  console.log('[1/5] Challenger league...');
  const challRes = await riot.fetch(
    `https://${REGION}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5?api_key=${API_KEY}`
  );
  if (!challRes.ok) { console.error(`  FAIL: ${challRes.status}`); process.exit(1); }
  const chall = await challRes.json();
  const players = (chall.entries || []).slice(0, SAMPLE_PLAYERS);
  console.log(`  ${chall.entries?.length || 0} total, sampling top ${players.length}`);

  // Step 2: Match-IDs
  console.log('\n[2/5] Match-IDs per player...');
  const matchIds = new Set();
  for (const p of players) {
    const res = await riot.fetch(
      `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/by-puuid/${p.puuid}/ids?queue=420&start=0&count=${MATCHES_PER_PLAYER}&api_key=${API_KEY}`
    );
    if (!res.ok) { console.log(`  WARN: ${p.puuid.slice(0, 8)}... HTTP ${res.status}`); continue; }
    const ids = await res.json();
    for (const id of ids) matchIds.add(id);
    console.log(`  ${p.puuid.slice(0, 8)}... → ${ids.length} matches`);
  }
  console.log(`  ${matchIds.size} unique match IDs`);

  // Step 3: Match details
  console.log('\n[3/5] Match details...');
  const ddRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
  const ddVersion = (await ddRes.json())[0];
  const bootSet = await loadBootSet(ddVersion);
  console.log(`  DDragon ${ddVersion}, ${bootSet.size} boot-item-IDs`);

  const builds = {};
  let analyzed = 0;
  let errors = 0;
  const matchIdArray = [...matchIds];
  for (const id of matchIdArray) {
    const res = await riot.fetch(
      `https://${REGIONAL}.api.riotgames.com/lol/match/v5/matches/${id}?api_key=${API_KEY}`
    );
    if (!res.ok) { errors++; continue; }
    const match = await res.json();
    if (match?.info?.participants && ALLOWED_QUEUES.has(match.info.queueId)) {
      aggregateMatch(match, builds, bootSet);
      analyzed++;
    }
  }
  console.log(`  ${analyzed} analyzed, ${errors} errors`);

  // Step 4: Aggregator finalize
  console.log('\n[4/5] Build aggregator...');
  const finalized = finalizeBuilds(builds);
  const champCount = Object.keys(finalized).length;
  const roleCount = Object.values(finalized).reduce((a, r) => a + Object.keys(r).length, 0);
  console.log(`  ${champCount} champions, ${roleCount} champ×role combos`);

  // Step 5: Burst behaviour
  console.log('\n[5/5] Burst test (20 parallel status calls)...');
  const burstStart = Date.now();
  const burstRes = await Promise.all(
    Array.from({ length: 20 }, () =>
      riot.fetch(`https://${REGION}.api.riotgames.com/lol/status/v4/platform-data?api_key=${API_KEY}`)
    )
  );
  const burstOk = burstRes.filter(r => r.status === 200).length;
  const burstFail = burstRes.length - burstOk;
  console.log(`  ${burstOk}/20 OK, ${burstFail} failed in ${Date.now() - burstStart}ms`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== Smoke test passed in ${elapsed}s ===`);
  if (burstFail > 0 || errors > matchIdArray.length / 2) {
    console.error('FAIL: too many errors');
    process.exit(1);
  }
}

main().catch(e => { console.error('FAIL:', e); process.exit(1); });

#!/usr/bin/env node
/**
 * Refreshes market values for all Challenger + Grandmaster players.
 * Calls /api/summoner for each player which triggers full recalculation.
 *
 * Usage:
 *   node scripts/refresh-highelo-marketvalues.mjs                  # Challenger only (~300 players)
 *   node scripts/refresh-highelo-marketvalues.mjs --gm             # Challenger + Grandmaster (~1000)
 *   node scripts/refresh-highelo-marketvalues.mjs --region kr      # Different region
 *   node scripts/refresh-highelo-marketvalues.mjs --limit 50       # Only top 50
 *   node scripts/refresh-highelo-marketvalues.mjs --resume 120     # Resume from player #120
 *
 * Requires: dev server running (npm run dev), .env.local with RIOT_API_KEY
 * Rate limit: ~1 player per 90 seconds (dev key: 100 req/2min)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env.local
const envPath = resolve(process.cwd(), '.env.local');
const envFile = readFileSync(envPath, 'utf8');
const env = Object.fromEntries(
  envFile.split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const API_KEY = env.RIOT_API_KEY;
if (!API_KEY) { console.error('RIOT_API_KEY not found in .env.local'); process.exit(1); }

// Parse args
const args = process.argv.slice(2);
const getArg = (name) => { const i = args.indexOf(name); return i !== -1 ? args[i + 1] : null; };
const hasFlag = (name) => args.includes(name);

const REGION = getArg('--region') || 'euw1';
const INCLUDE_GM = hasFlag('--gm') || hasFlag('--all-tiers');
const INCLUDE_MASTER = hasFlag('--master') || hasFlag('--all-tiers');
const LIMIT = parseInt(getArg('--limit') || '0', 10);
const TOP_PER_TIER = parseInt(getArg('--top-per-tier') || '0', 10);
const RESUME_FROM = parseInt(getArg('--resume') || '0', 10);
const BASE_URL = getArg('--url') || 'http://localhost:3000';
const DELAY_MS = parseInt(getArg('--delay') || '95000', 10); // 95s between players (safe for 100 req/2min)

const REGIONAL = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
}[REGION] || 'europe';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function riotFetch(url) {
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}api_key=${API_KEY}`);
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('Retry-After') || '10', 10);
    console.log(`  Rate limited, waiting ${retryAfter}s...`);
    await sleep(retryAfter * 1000 + 1000);
    return riotFetch(url);
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  console.log(`\n=== Market Value Refresh ===`);
  console.log(`Region: ${REGION} (${REGIONAL})`);
  console.log(`Tiers: Challenger${INCLUDE_GM ? ' + Grandmaster' : ''}${INCLUDE_MASTER ? ' + Master' : ''}`);
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Delay: ${DELAY_MS / 1000}s between players\n`);

  // Step 1: Fetch league entries
  console.log('Fetching Challenger league...');
  const chall = await riotFetch(
    `https://${REGION}.api.riotgames.com/lol/league/v4/challengerleagues/by-queue/RANKED_SOLO_5x5`
  );
  let entries = (chall.entries || []).map(e => ({ ...e, tier: 'CHALLENGER' }));
  console.log(`  ${entries.length} Challenger players`);

  if (INCLUDE_GM) {
    await sleep(1200);
    console.log('Fetching Grandmaster league...');
    const gm = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/league/v4/grandmasterleagues/by-queue/RANKED_SOLO_5x5`
    );
    const gmEntries = (gm.entries || []).map(e => ({ ...e, tier: 'GRANDMASTER' }));
    console.log(`  ${gmEntries.length} Grandmaster players`);
    entries.push(...gmEntries);
  }

  if (INCLUDE_MASTER) {
    await sleep(1200);
    console.log('Fetching Master league...');
    const master = await riotFetch(
      `https://${REGION}.api.riotgames.com/lol/league/v4/masterleagues/by-queue/RANKED_SOLO_5x5`
    );
    const masterEntries = (master.entries || []).map(e => ({ ...e, tier: 'MASTER' }));
    console.log(`  ${masterEntries.length} Master players`);
    entries.push(...masterEntries);
  }

  // Top N per tier (sort each tier by LP, take top N, then merge)
  if (TOP_PER_TIER > 0) {
    const byTier = {};
    for (const e of entries) {
      if (!byTier[e.tier]) byTier[e.tier] = [];
      byTier[e.tier].push(e);
    }
    entries = [];
    for (const tier of ['CHALLENGER', 'GRANDMASTER', 'MASTER']) {
      if (!byTier[tier]) continue;
      byTier[tier].sort((a, b) => b.leaguePoints - a.leaguePoints);
      const top = byTier[tier].slice(0, TOP_PER_TIER);
      console.log(`  Taking top ${top.length} from ${tier}`);
      entries.push(...top);
    }
  } else {
    entries.sort((a, b) => b.leaguePoints - a.leaguePoints);
  }
  if (LIMIT > 0) entries = entries.slice(0, LIMIT);
  if (RESUME_FROM > 0) entries = entries.slice(RESUME_FROM);

  const total = entries.length;
  const estimatedMinutes = Math.round((total * DELAY_MS) / 60000);
  console.log(`\nTotal: ${total} players to process`);
  console.log(`Estimated time: ~${estimatedMinutes} minutes (~${(estimatedMinutes / 60).toFixed(1)} hours)\n`);

  // Step 2: Resolve names + trigger market value
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const num = RESUME_FROM + i + 1;
    const pct = ((i + 1) / total * 100).toFixed(1);

    try {
      // Resolve puuid → Riot ID
      let gameName, tagLine;

      if (entry.puuid) {
        const account = await riotFetch(
          `https://${REGIONAL}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${entry.puuid}`
        );
        gameName = account.gameName;
        tagLine = account.tagLine;
      } else {
        // Older API: resolve via summonerId → puuid → account
        await sleep(1200);
        const summoner = await riotFetch(
          `https://${REGION}.api.riotgames.com/lol/summoner/v4/summoners/${entry.summonerId}`
        );
        await sleep(1200);
        const account = await riotFetch(
          `https://${REGIONAL}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${summoner.puuid}`
        );
        gameName = account.gameName;
        tagLine = account.tagLine;
      }

      if (!gameName) {
        console.log(`[${num}/${total}] (${pct}%) ${entry.tier} ${entry.leaguePoints}LP — SKIP (no name)`);
        skipped++;
        continue;
      }

      const fullName = `${gameName}#${tagLine}`;
      process.stdout.write(`[${num}/${total}] (${pct}%) ${entry.tier} ${entry.leaguePoints}LP — ${fullName} ... `);

      // Call /api/summoner to trigger market value calculation
      await sleep(2000); // small buffer before heavy call
      const summonerRes = await fetch(
        `${BASE_URL}/api/summoner?name=${encodeURIComponent(fullName)}&region=${REGION}`
      );

      if (summonerRes.ok) {
        const data = await summonerRes.json();
        const mv = data.storedMarketValue;
        console.log(mv ? `$${mv.toLocaleString('de-DE')}` : 'Not Rated');
        success++;
      } else {
        const err = await summonerRes.text();
        console.log(`FAILED (${summonerRes.status})`);
        failed++;
      }
    } catch (e) {
      console.log(`ERROR: ${e.message}`);
      failed++;
    }

    // Wait between players to stay within rate limits
    if (i < entries.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Total: ${total}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

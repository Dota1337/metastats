#!/usr/bin/env node
/**
 * Collects TFT champion / item / augment / trait stats across every ranked
 * tier — Iron through Challenger. Writes:
 *   public/tft-stats-{set}-{region}.json
 *
 * Uses RIOT_API_KEY_TFT (production tier, ~50 req/s app-wide).
 *
 * Usage:
 *   node scripts/collect-tft-allranks.mjs --region euw1
 *   node scripts/collect-tft-allranks.mjs --region kr  --matches-per-player 10
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { aggregateMatch, finalize, emptyAggregate } from './lib/tft-build-aggregator.mjs';
import { createRiotClient } from './lib/riot-client.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const MATCHES_PER_PLAYER = Number(arg('--matches-per-player', '8'));
const SAMPLE_SIZES = {
  IRON:        Number(arg('--max-iron',        '100')),
  BRONZE:      Number(arg('--max-bronze',      '150')),
  SILVER:      Number(arg('--max-silver',      '200')),
  GOLD:        Number(arg('--max-gold',        '250')),
  PLATINUM:    Number(arg('--max-platinum',    '300')),
  EMERALD:     Number(arg('--max-emerald',     '400')),
  DIAMOND:     Number(arg('--max-diamond',    '1000')),
};
const REGIONAL = ({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
})[REGION] || 'europe';

const API_KEY = process.env.RIOT_API_KEY_TFT;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT env var required'); process.exit(1); }

let setMeta = null;
if (existsSync('public/tft-set.json')) {
  try { setMeta = JSON.parse(readFileSync('public/tft-set.json', 'utf8')); } catch {}
}
const CURRENT_SET = setMeta?.setNumber ?? null;

// Production TFT limits (verified from X-App-Rate-Limit: 500:10,30000:600 +
// match-detail method-limit 200:10). We cap below the match-detail method
// (the bottleneck) so we never blow it across alternating endpoints.
const riot = createRiotClient({
  shortWindowRequests: 180,    // 90% of match-detail 200/10s
  shortWindowMs: 10_500,
  longWindowRequests: 28000,   // 93% of app 30000/600s
  longWindowMs: 605_000,
});
const rl = url => riot.fetchJson(url, { safe: true });

async function fetchApex(tier) {
  const data = await rl(`https://${REGION}.api.riotgames.com/tft/league/v1/${tier}?api_key=${API_KEY}`);
  if (!data || data._status) return [];
  return (data.entries || []).map(e => ({ puuid: e.puuid, lp: e.leaguePoints, tier: tier.toUpperCase() }));
}

async function fetchEntries(tier, division, page) {
  const data = await rl(`https://${REGION}.api.riotgames.com/tft/league/v1/entries/${tier}/${division}?page=${page}&api_key=${API_KEY}`);
  if (!data || data._status) return [];
  return (data || []).map(e => ({ puuid: e.puuid, lp: e.leaguePoints, tier }));
}

// Sample the top N players of a tier by walking divisions I -> IV across page=1.
// Riot returns 200 entries / page; the first page of division I is essentially
// "the strongest of that tier". For rough representativeness this is enough —
// we're not trying to enumerate every Iron player.
async function sampleTier(tier, target) {
  const divs = ['I', 'II', 'III', 'IV'];
  const perDiv = Math.ceil(target / divs.length);
  const out = [];
  for (const div of divs) {
    let page = 1;
    while (out.filter(e => e.tier === tier).length < (out.length + perDiv) && page <= 3) {
      const batch = await fetchEntries(tier, div, page);
      if (batch.length === 0) break;
      for (const e of batch) {
        if (e.puuid && !out.some(x => x.puuid === e.puuid)) out.push(e);
        if (out.length >= target) return out.slice(0, target);
      }
      page++;
    }
    if (out.length >= target) break;
  }
  return out.slice(0, target);
}

async function discoverPlayers() {
  const all = [];
  console.log('[discovery] Apex tiers');
  for (const tier of ['challenger','grandmaster','master']) {
    const entries = await fetchApex(tier);
    console.log(`  ${tier}: ${entries.length}`);
    all.push(...entries);
  }
  for (const tier of ['DIAMOND','EMERALD','PLATINUM','GOLD','SILVER','BRONZE','IRON']) {
    const target = SAMPLE_SIZES[tier];
    if (!target) continue;
    console.log(`[discovery] ${tier} target=${target}`);
    const sample = await sampleTier(tier, target);
    console.log(`  ${tier}: ${sample.length}`);
    all.push(...sample);
  }
  return all;
}

function tierBucketOf(tier) {
  return (tier || '').toLowerCase();
}

async function main() {
  console.log(`=== TFT Crawler ${REGION} (regional ${REGIONAL}) — set ${CURRENT_SET ?? '?'} ===`);

  // Step 1: discover sample players per tier
  const players = await discoverPlayers();
  const playersByPuuid = {};
  for (const p of players) {
    // Keep the highest-tier mapping if we have duplicates (shouldn't happen but be safe)
    if (!playersByPuuid[p.puuid]) playersByPuuid[p.puuid] = p;
  }
  const uniquePlayers = Object.values(playersByPuuid);
  console.log(`\n[1/3] ${uniquePlayers.length} unique players (after dedup)\n`);

  // Step 2: fetch match IDs per player
  console.log('[2/3] Fetching match IDs');
  const allMatchIds = new Set();
  const matchTier = {};   // matchId -> tierBucket of the source player (first one wins)
  let i = 0;
  for (const p of uniquePlayers) {
    i++;
    const ids = await rl(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/by-puuid/${p.puuid}/ids?count=${MATCHES_PER_PLAYER}&api_key=${API_KEY}`);
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (!allMatchIds.has(id)) {
          allMatchIds.add(id);
          matchTier[id] = tierBucketOf(p.tier);
        }
      }
    }
    if (i % 100 === 0 || i === uniquePlayers.length) {
      console.log(`  ${i}/${uniquePlayers.length} players (${allMatchIds.size} unique match ids)`);
    }
  }

  // Step 3: fetch match details + aggregate
  console.log(`\n[3/3] Aggregating ${allMatchIds.size} matches`);
  // Use the helper so we can't drift from the aggregator's expected shape —
  // last time we hand-rolled the init we forgot byComp/byCompPair.
  const agg = emptyAggregate();
  const ids = [...allMatchIds];
  for (let j = 0; j < ids.length; j++) {
    const id = ids[j];
    const raw = await rl(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${API_KEY}`);
    if (!raw || raw._status) { agg.matchesSkipped++; continue; }
    aggregateMatch(raw, agg, { tierBucket: matchTier[id], currentSet: CURRENT_SET });
    if ((j + 1) % 100 === 0 || j === ids.length - 1) {
      console.log(`  ${j+1}/${ids.length} (${agg.matchesAnalyzed} aggregated, ${agg.matchesSkipped} skipped)`);
    }
  }

  // Finalize + write
  const finalized = finalize(agg, { minUnitGames: 5, minItemGames: 5, minAugmentGames: 5 });
  const payload = {
    set: CURRENT_SET,
    setName: setMeta?.setName,
    patch: setMeta?.latestPatch,
    region: REGION,
    collectedAt: new Date().toISOString(),
    sampledPlayers: uniquePlayers.length,
    ...finalized,
  };
  const file = `public/tft-stats-${REGION}.json`;
  writeFileSync(file, JSON.stringify(payload));
  console.log(`\n  -> ${file} (${payload.matchesAnalyzed} matches, ${Object.keys(payload.byUnit).length} units, ${Object.keys(payload.byItem).length} items)`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

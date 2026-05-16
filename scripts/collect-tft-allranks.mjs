#!/usr/bin/env node
/**
 * Collects TFT champion / item / augment / trait stats across every ranked
 * tier — Iron through Challenger. Writes:
 *   public/tft-stats-{set}-{region}.json
 *
 * Uses RIOT_API_KEY_TFT (production tier, ~50 req/s app-wide).
 *
 * Pulls the most recently completed 24h window [yesterday 05:00 UTC, today
 * 05:00 UTC) via Riot's startTime/endTime match-ids filter, paginating
 * through up to N pages of 100 ids per player. The window anchor (05:00 UTC)
 * sits before Riot's typical EU patch deploy window, giving us near-clean
 * patch separation: each day's row primarily contains matches from one
 * patch. Matches are further re-grouped by their parsed game_version so a
 * mid-window patch boundary writes two rows (different `patch` values) for
 * the same `day`, fully cleaning the seam.
 *
 * Usage:
 *   node scripts/collect-tft-allranks.mjs --region euw1
 *   node scripts/collect-tft-allranks.mjs --region kr
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { aggregateMatch, finalize, emptyAggregate } from './lib/tft-build-aggregator.mjs';
import { createRiotClient } from './lib/riot-client.mjs';
import { writeTftStatsToSupabase } from './lib/tft-supabase-writer.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const SKIP_SUPABASE = hasFlag('--no-supabase');
const SKIP_JSON = hasFlag('--no-json');
// Window mode:
//   'auto'  (default) — most recent completed 24h window [yesterday 05, today 05),
//                       day = yesterday. Used by the 05:15 UTC final daily run.
//   'today'           — rolling window [today 05 UTC, now), day = today. Used
//                       by the intraday runs (11/17/23 UTC) so the current
//                       day's aggregates grow throughout the day.
const MODE = (arg('--mode', 'auto') || 'auto').toLowerCase();
// Backfill flag: --day YYYY-MM-DD treats the window as [day 05 UTC, day+1 05 UTC)
// and writes `day = YYYY-MM-DD`. Used when a daily run was missed.
const DAY_OVERRIDE_RAW = arg('--day', null);
const DAY_OVERRIDE = DAY_OVERRIDE_RAW && /^\d{4}-\d{2}-\d{2}$/.test(DAY_OVERRIDE_RAW)
  ? DAY_OVERRIDE_RAW
  : null;
if (DAY_OVERRIDE_RAW && !DAY_OVERRIDE) {
  console.error(`Invalid --day '${DAY_OVERRIDE_RAW}', expected YYYY-MM-DD`);
  process.exit(1);
}
// Hard cap per player to bound runtime when something goes weird (e.g. an
// inflated startTime would normally page forever). 200 is well above any
// realistic 24h grinding session (max ~45 matches/24h given 30min game length).
const MAX_MATCHES_PER_PLAYER = Number(arg('--max-matches-per-player', '200'));
// Iron is intentionally skipped — too few games per day for meaningful
// per-region stats below Bronze.
const SAMPLE_SIZES = {
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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 24h window anchored at 05:00 UTC.
//
// mode='auto'  → most recent completed 24h window [yesterday 05, today 05).
//                Used by the 05:15 UTC final daily run; day = yesterday.
//                Falls back to the previous slice if invoked before 05:00 UTC
//                (manual dispatch) so we never ask Riot for "future" matches.
//
// mode='today' → rolling window [today 05 UTC, now). day = today. Used by the
//                intraday runs (11/17/23 UTC) so the current day's aggregates
//                grow throughout the day. Each intraday upsert overwrites the
//                previous one for the same (region, bucket, patch, set, day, …)
//                key, and the next morning's 05:15 final run closes the day
//                with the full 24h window.
//                If invoked before today 05 UTC, falls back to mode='auto'
//                semantics so we don't crawl a zero-length window.
function computeWindow(now = new Date(), mode = 'auto', dayOverride = null) {
  if (dayOverride) {
    const startTime = new Date(dayOverride + 'T05:00:00Z');
    const endTime = new Date(startTime.getTime() + 86_400_000);
    return { startTime, endTime };
  }
  const today5 = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 5, 0, 0, 0,
  ));
  if (mode === 'today' && now >= today5) {
    return { startTime: today5, endTime: now };
  }
  const endTime = now < today5 ? new Date(today5.getTime() - 86_400_000) : today5;
  const startTime = new Date(endTime.getTime() - 86_400_000);
  return { startTime, endTime };
}
const WINDOW = computeWindow(new Date(), MODE, DAY_OVERRIDE);
const WINDOW_START_SEC = Math.floor(WINDOW.startTime.getTime() / 1000);
const WINDOW_END_SEC = Math.floor(WINDOW.endTime.getTime() / 1000);
// `day` column = the calendar date the window primarily covers (its start).
const DAY = WINDOW.startTime.toISOString().slice(0, 10);

// Parse "15.4" from any of: "Releases/Game/15.4", "15.4.612.6512", "Version 15.4.x".
// Returns null if no recognisable version found.
function parseMatchPatchBase(gameVersion) {
  if (!gameVersion) return null;
  const m = String(gameVersion).match(/(\d+)\.(\d+)/);
  return m ? `${m[1]}.${m[2]}` : null;
}

// Resolve a match to the canonical patch label we store. If the parsed
// game_version matches the current setMeta.latestPatch base (e.g. parsed
// "15.4" === setMeta "15.4b" base "15.4"), use the full latestPatch with
// its b/c suffix — Riot's game_version doesn't carry b-patch markers, but
// our reporting layer expects them. Otherwise fall back to the parsed base.
function resolvePatch(gameVersion, currentPatch) {
  const parsed = parseMatchPatchBase(gameVersion);
  if (!parsed) return currentPatch || 'unknown';
  const currentBase = currentPatch?.match(/^(\d+\.\d+)/)?.[1];
  if (parsed === currentBase) return currentPatch;
  return parsed;
}

// Pre-fetch the set of TFT pro PUUIDs so the aggregator can flag matches
// containing pros and write a parallel `pro_pool` bucket. Falls through to
// an empty set if Supabase isn't reachable — pipeline keeps working, just
// without pro-only stats.
async function loadProPuuids() {
  if (!SUPA_KEY) return new Set();
  try {
    const url = `${SUPA_URL}/rest/v1/tft_pro_players?select=puuid`;
    const r = await fetch(url, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    });
    if (!r.ok) return new Set();
    const rows = await r.json();
    const set = new Set();
    for (const row of rows || []) if (row.puuid) set.add(row.puuid);
    return set;
  } catch { return new Set(); }
}

let setMeta = null;
if (existsSync('public/tft-set.json')) {
  try { setMeta = JSON.parse(readFileSync('public/tft-set.json', 'utf8')); } catch {}
}
const CURRENT_SET = setMeta?.setNumber ?? null;
const CURRENT_PATCH = setMeta?.latestPatch ?? null;

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

// Page through match-ids for a single player, restricted to the configured
// 24h window. Stops when Riot returns fewer than `count` ids (no more pages)
// or when we hit the safety cap.
async function fetchMatchIdsForPlayer(puuid) {
  const COUNT = 100;
  const ids = [];
  let start = 0;
  while (ids.length < MAX_MATCHES_PER_PLAYER) {
    const url = `https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids`
      + `?startTime=${WINDOW_START_SEC}&endTime=${WINDOW_END_SEC}`
      + `&start=${start}&count=${COUNT}&api_key=${API_KEY}`;
    const batch = await rl(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    ids.push(...batch);
    if (batch.length < COUNT) break;
    start += COUNT;
  }
  return ids.slice(0, MAX_MATCHES_PER_PLAYER);
}

async function main() {
  console.log(`=== TFT Crawler ${REGION} (regional ${REGIONAL}) — set ${CURRENT_SET ?? '?'} ===`);
  console.log(`[window] ${WINDOW.startTime.toISOString()} → ${WINDOW.endTime.toISOString()}  (day=${DAY})`);

  // Step 1: discover sample players per tier
  const players = await discoverPlayers();
  const playersByPuuid = {};
  for (const p of players) {
    // Keep the highest-tier mapping if we have duplicates (shouldn't happen but be safe)
    if (!playersByPuuid[p.puuid]) playersByPuuid[p.puuid] = p;
  }
  const uniquePlayers = Object.values(playersByPuuid);
  console.log(`\n[1/3] ${uniquePlayers.length} unique players (after dedup)\n`);

  // Step 2: fetch match IDs per player, restricted to the 24h window
  console.log('[2/3] Fetching match IDs in window');
  const allMatchIds = new Set();
  const matchTier = {};   // matchId -> tierBucket of the source player (first one wins)
  let i = 0;
  let totalCalls = 0;
  for (const p of uniquePlayers) {
    i++;
    const ids = await fetchMatchIdsForPlayer(p.puuid);
    totalCalls += Math.max(1, Math.ceil(ids.length / 100));
    for (const id of ids) {
      if (!allMatchIds.has(id)) {
        allMatchIds.add(id);
        matchTier[id] = tierBucketOf(p.tier);
      }
    }
    if (i % 100 === 0 || i === uniquePlayers.length) {
      console.log(`  ${i}/${uniquePlayers.length} players (${allMatchIds.size} unique match ids, ${totalCalls} ids-calls)`);
    }
  }

  // Step 3: fetch match details + aggregate, splitting by patch (parsed from
  // each match's game_version). One aggregate per patch — finalized and
  // written separately, so a mid-window patch boundary produces two rows
  // (different `patch`) for the same `day`.
  console.log(`\n[3/3] Aggregating ${allMatchIds.size} matches`);
  const proPuuids = await loadProPuuids();
  console.log(`  [pro] loaded ${proPuuids.size} pro PUUIDs for pro_pool tagging`);
  const aggsByPatch = new Map(); // patch -> aggregate
  let totalSkipped = 0;
  const ids = [...allMatchIds];
  for (let j = 0; j < ids.length; j++) {
    const id = ids[j];
    const raw = await rl(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${API_KEY}`);
    if (!raw || raw._status) { totalSkipped++; continue; }
    const patch = resolvePatch(raw?.info?.game_version, CURRENT_PATCH);
    let agg = aggsByPatch.get(patch);
    if (!agg) { agg = emptyAggregate(); aggsByPatch.set(patch, agg); }
    aggregateMatch(raw, agg, { tierBucket: matchTier[id], currentSet: CURRENT_SET, proPuuids });
    if ((j + 1) % 100 === 0 || j === ids.length - 1) {
      const totals = [...aggsByPatch.values()].reduce((s, a) => s + a.matchesAnalyzed, 0);
      console.log(`  ${j+1}/${ids.length} (${totals} aggregated across ${aggsByPatch.size} patch(es), ${totalSkipped} skipped)`);
    }
  }

  // Finalize + write per patch
  const writtenPatches = [];
  for (const [patch, agg] of aggsByPatch) {
    const finalized = finalize(agg, { minUnitGames: 5, minItemGames: 5, minAugmentGames: 5 });
    const payload = {
      set: CURRENT_SET,
      setName: setMeta?.setName,
      patch,
      region: REGION,
      collectedAt: new Date().toISOString(),
      windowStart: WINDOW.startTime.toISOString(),
      windowEnd: WINDOW.endTime.toISOString(),
      day: DAY,
      sampledPlayers: uniquePlayers.length,
      ...finalized,
    };

    if (!SKIP_JSON) {
      // Only write JSON for the primary (current-meta) patch — keeps the
      // public/tft-stats-<region>.json file shape stable for the legacy
      // JSON readers. Older overlapping patches still land in Supabase.
      if (patch === CURRENT_PATCH) {
        const file = `public/tft-stats-${REGION}.json`;
        writeFileSync(file, JSON.stringify(payload));
        console.log(`\n  -> ${file} (patch=${patch}, ${payload.matchesAnalyzed} matches, ${Object.keys(payload.byUnit).length} units, ${Object.keys(payload.byItem).length} items)`);
      }
    }

    if (!SKIP_SUPABASE) {
      console.log(`\n[supabase] writing ${REGION} day=${DAY} patch=${patch} set=${CURRENT_SET} (${payload.matchesAnalyzed} matches)`);
      await writeTftStatsToSupabase({
        region: REGION,
        day: DAY,
        patch,
        setNumber: CURRENT_SET,
        payload,
      });
    }
    writtenPatches.push({ patch, matches: payload.matchesAnalyzed });
  }

  console.log(`\n[done] window=${WINDOW.startTime.toISOString()}..${WINDOW.endTime.toISOString()} day=${DAY}`);
  for (const w of writtenPatches) console.log(`       patch=${w.patch}: ${w.matches} matches`);
  if (writtenPatches.length === 0) console.log('       no matches found in window');
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

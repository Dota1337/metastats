#!/usr/bin/env node
/**
 * TFT marketvalue crawler — Hetzner Postgres edition.
 *
 * Per player (Master/GM/Challenger by default; --include-diamond to extend):
 *   1. Discover via apex/league endpoints
 *   2. refreshPlayerMatchCache → keeps tft_player_match_cache current
 *   3. listSeasonMatches(currentSet) → all the player's matches for the live set
 *   4. upsertSeasonStats → tft_player_season_stats
 *   5. scoreSkill (population-relative) over the full set → tft_player_marketvalue_snapshots
 *
 * Writes go to the local Hetzner Postgres (DATABASE_URL). A separate
 * sync-marketvalue-to-supabase.mjs script pushes the snapshot + season_stats
 * rows to Supabase so the Vercel API stays simple.
 *
 * Usage:
 *   node scripts/collect-tft-marketvalues.mjs --region euw1
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --include-diamond
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --limit 5 --verbose
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --snapshot-date 2026-05-15 --puuids p1,p2,p3
 *
 * `--snapshot-date` overrides `current_date` for the inserted row — used
 * by the backfill workflow when a daily run was missed.
 * `--puuids` skips the apex/diamond discovery and processes exactly those
 * players (rank/LP fetched fresh via tft/league/v1/by-puuid).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { buildCompMeta, applyMeta, buildPopulation } from './lib/tft-skill-score.mjs';
import {
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';
import {
  getRegionalCluster,
  loadCurrentSet,
  loadGraph,
  gatherPlayer,
  persistPopulation,
  snapshotPlayer,
} from './lib/tft-marketvalue-pipeline.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const INCLUDE_DIAMOND = hasFlag('--include-diamond');
const LIMIT = parseInt(arg('--limit', '0'), 10);
const FORCE_REFRESH = hasFlag('--force-refresh');
const SKIP_CACHE_REFRESH = hasFlag('--skip-cache-refresh');
const VERBOSE = hasFlag('--verbose');

// Graceful shutdown: on SIGTERM (systemctl stop) finish the current player and
// jump to Pass 2 + persist, so a manual stop still lands a population row +
// snapshots for everyone gathered so far. No artificial time budget — a region
// runs until it naturally completes.
let aborting = false;
process.on('SIGTERM', () => {
  if (aborting) return;
  aborting = true;
  console.log('\n  [signal] SIGTERM — finishing current player, then jumping to Pass 2 + persist');
});

const SNAPSHOT_DATE_RAW = arg('--snapshot-date', null);
const SNAPSHOT_DATE = SNAPSHOT_DATE_RAW && /^\d{4}-\d{2}-\d{2}$/.test(SNAPSHOT_DATE_RAW)
  ? SNAPSHOT_DATE_RAW
  : null;
if (SNAPSHOT_DATE_RAW && !SNAPSHOT_DATE) {
  console.error(`Invalid --snapshot-date '${SNAPSHOT_DATE_RAW}', expected YYYY-MM-DD`);
  process.exit(1);
}

const PUUIDS_RAW = arg('--puuids', null);
const PUUIDS = PUUIDS_RAW ? PUUIDS_RAW.split(',').map(s => s.trim()).filter(Boolean) : null;

const REGIONAL = getRegionalCluster(REGION);

// Load .env style file from /etc/metastats-crawler/env (production) or
// .env.local (local dev) — supports either as the env source.
function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
loadEnv();

const API_KEY = process.env.RIOT_API_KEY_TFT;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT env var required'); process.exit(1); }

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL env var required'); process.exit(1); }

// Optional Supabase mirror for the population stats so the Vercel live-calc
// fallback can read them (the snapshots themselves are mirrored separately).
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || null;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || null;

// ─────────────────────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────────────────────

// Cap just below the TFT prod match-detail method limit (200/10s), matching
// the all-ranks crawler. The previous 18/1.1s short window throttled us to
// ~16 req/s — far below the method limit — and combined with serial per-player
// fetches the cold-fill crawled at ~3 req/s (~60s/cold player), so the apex
// regions never finished before the next 00:02 aggregate crawl killed the run.
const riot = createRiotClient({
  shortWindowRequests: 180,    // 90% of match-detail 200/10s
  shortWindowMs: 10_500,
  longWindowRequests: 28000,   // 93% of app 30000/600s
  longWindowMs: 605_000,
});
const rl = url => riot.fetchJson(url, { safe: true });

// How many match-detail fetches to run concurrently *within* one player's
// cold backfill. The riot-client sliding window still gates the global rate
// (concurrency just fills the otherwise-idle headroom up to the method limit),
// and a single key bucket means no cross-region contention. 6 keeps us under
// 200/10s even at ~0.3s/request while cutting cold-player time ~5x.
const MATCH_FETCH_CONCURRENCY = parseInt(arg('--match-concurrency', '6'), 10);

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5, statement_timeout: 60_000 });

// ─────────────────────────────────────────────────────────────────────────────
// discovery
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApex(tier) {
  const data = await rl(`https://${REGION}.api.riotgames.com/tft/league/v1/${tier}?api_key=${API_KEY}`);
  if (!data || data._status) {
    if (data?._status) console.log(`  [discovery] ${tier} HTTP ${data._status}`);
    return [];
  }
  return (data.entries || []).map(e => ({
    puuid: e.puuid, lp: e.leaguePoints ?? 0, tier: tier.toUpperCase(),
    wins: e.wins ?? 0, losses: e.losses ?? 0,
  }));
}

async function fetchDiamond() {
  // Rated floor is Diamond II — only walk divisions I + II (D3/D4 are not
  // rated, see computeBaseValue, and skipping them keeps the crawl scope sane).
  const all = [];
  for (const division of ['I', 'II']) {
    let page = 1;
    while (true) {
      const url = `https://${REGION}.api.riotgames.com/tft/league/v1/entries/DIAMOND/${division}?page=${page}&api_key=${API_KEY}`;
      const data = await rl(url);
      if (!data || data._status || !Array.isArray(data) || data.length === 0) break;
      for (const e of data) {
        all.push({
          puuid: e.puuid, lp: e.leaguePoints ?? 0, tier: 'DIAMOND',
          rank: division, wins: e.wins ?? 0, losses: e.losses ?? 0,
        });
      }
      if (data.length < 205) break;   // riot returns ~205 entries per page; smaller = last
      page++;
    }
  }
  return all;
}

async function discoverPlayers() {
  console.log(`[discovery] ${REGION} — apex tiers${INCLUDE_DIAMOND ? ' + Diamond' : ''}`);
  const all = [];
  for (const tier of ['challenger', 'grandmaster', 'master']) {
    const entries = await fetchApex(tier);
    console.log(`  ${tier}: ${entries.length}`);
    all.push(...entries);
  }
  if (INCLUDE_DIAMOND) {
    const diamond = await fetchDiamond();
    console.log(`  diamond: ${diamond.length}`);
    all.push(...diamond);
  }
  // Ladder rank (within the regional apex ladder) — drives the top-50 chal
  // base-value curve. Diamond entries keep ladderRank=undefined.
  const apexOnly = all.filter(p => p.tier !== 'DIAMOND').sort((a, b) => b.lp - a.lp);
  for (let i = 0; i < apexOnly.length; i++) apexOnly[i].ladderRank = i + 1;
  return all;
}

// --puuids mode: skip apex discovery, fetch each player's RANKED_TFT entry
// directly. Used by the backfill workflow. ladderRank is reused from the
// most recent existing snapshot in the same region — without it CHALLENGER
// players fall onto the LP-only base-value curve (~12k vs real ~130k),
// which would produce 10× too-low backfilled values.
async function loadPlayersByPuuids(puuids) {
  console.log(`[discovery] ${REGION} — explicit ${puuids.length} puuid(s)`);
  const out = [];
  for (const puuid of puuids) {
    const data = await rl(
      `https://${REGION}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}?api_key=${API_KEY}`,
    );
    if (!data || data._status) {
      if (VERBOSE) console.log(`  [skip] no league entry for ${puuid.slice(0, 8)}…`);
      continue;
    }
    const arr = Array.isArray(data) ? data : [];
    const entry = arr.find(e => e.queueType === 'RANKED_TFT');
    if (!entry) {
      if (VERBOSE) console.log(`  [skip] no RANKED_TFT entry for ${puuid.slice(0, 8)}…`);
      continue;
    }
    const lr = await pool.query(
      `select ladder_rank from tft_player_marketvalue_snapshots
         where puuid=$1 and region=$2 and ladder_rank is not null
         order by snapshot_date desc limit 1`,
      [puuid, REGION],
    );
    out.push({
      puuid,
      tier: entry.tier,
      rank: entry.rank,
      lp: entry.leaguePoints ?? 0,
      wins: entry.wins ?? 0,
      losses: entry.losses ?? 0,
      ladderRank: lr.rows[0]?.ladder_rank ?? undefined,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// per-region context: KG, current set, per-player pipeline
// → loadGraph/loadCurrentSet/gatherPlayer/persistPopulation/snapshotPlayer
//   leben in scripts/lib/tft-marketvalue-pipeline.mjs (shared mit dem
//   neuen daily-marketvalue-snapshot Driver, Phase A4).
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== TFT Marketvalue Crawler (Hetzner) — ${REGION}${SNAPSHOT_DATE ? ` · snapshot_date=${SNAPSHOT_DATE}` : ''} ===`);
  const t0 = Date.now();
  try {
  const setNumber = loadCurrentSet();
  if (setNumber == null) { console.error('No current set, aborting'); process.exit(1); }
  console.log(`  current set: ${setNumber}`);

  const graph = loadGraph(REGION);
  console.log(`  graph: ${graph ? 'loaded' : 'not available'}`);
  const hotCompKeys = buildHotCompKeys(graph);
  const recommendedItems = buildRecommendedItems(graph);

  let players = PUUIDS ? await loadPlayersByPuuids(PUUIDS) : await discoverPlayers();
  if (LIMIT > 0) players = players.slice(0, LIMIT);
  // Cold players otherwise backfill their entire ~1000-match multi-set history
  // (~55s each — the throughput killer; diagnosed: 0 rate-limit hits, pure fetch
  // volume). Restrict the id walk to the current set: startTime = earliest cached
  // game_datetime for this set (−1d cushion), capped at maxColdIds recent set-era
  // ids. A ~100-match sample is plenty for the skill-score percentiles; daily
  // incremental refreshes top up the rest.
  const maxColdIds = parseInt(arg('--max-cold-ids', '200'), 10);
  let startTimeSec = Math.floor((Date.now() - 150 * 86400 * 1000) / 1000); // fallback
  try {
    const r = await pool.query('select min(game_datetime) as m from tft_player_match_cache where set_number = $1 and game_datetime > 0', [setNumber]);
    const m = Number(r.rows[0]?.m);
    if (Number.isFinite(m) && m > 0) startTimeSec = Math.floor(m / 1000) - 86400;
  } catch { /* keep fallback */ }
  console.log(`  cache-refresh window: matches since ${new Date(startTimeSec * 1000).toISOString().slice(0, 10)} (current set), cap ${maxColdIds} ids/player`);

  console.log(`\n[1/3] ${players.length} players — Pass 1: cache refresh + raw metrics`);
  const ctx = {
    region: REGION, regional: REGIONAL,
    setNumber, hotCompKeys, recommendedItems,
    startTimeSec, maxIds: maxColdIds,
    concurrency: MATCH_FETCH_CONCURRENCY,
    force: FORCE_REFRESH, skipCacheRefresh: SKIP_CACHE_REFRESH, verbose: VERBOSE,
  };
  const gathered = [];
  let p1 = 0, tooFew = 0, failed = 0;
  for (const p of players) {
    if (aborting) {
      console.log(`  [signal] Pass 1 stopped at ${p1}/${players.length} (${gathered.length} usable) — jumping to Pass 2 + persist`);
      break;
    }
    try {
      const g = await gatherPlayer(pool, riot, p, ctx);
      p1++;
      if (g.skip) tooFew++; else gathered.push({ p, raw: g.raw });
      if (VERBOSE || p1 % 25 === 0 || p1 === players.length) {
        console.log(`  ${p1}/${players.length} | ${gathered.length} usable, ${tooFew} too-few | ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    } catch (err) {
      failed++;
      console.error(`  [error] puuid=${p.puuid.slice(0, 8)}…: ${err.message}`);
      if (VERBOSE) console.error(err.stack);
    }
  }

  if (gathered.length === 0) {
    console.log('No usable players (≥5 matches) — nothing to score.');
    return;
  }

  // Pass 2 prep: cohort comp-benchmark + population median/MAD, persisted for the live path.
  console.log(`\n[2/3] Build population from ${gathered.length} players`);
  const compMeta = buildCompMeta(gathered.map(g => g.raw));
  for (const g of gathered) applyMeta(g.raw, compMeta);
  const pop = buildPopulation(gathered.map(g => g.raw));
  await persistPopulation(pool, REGION, setNumber, pop, compMeta, gathered.length, {
    supaUrl: SUPA_URL, supaKey: SUPA_KEY,
  });
  console.log(`  comp-benchmark: ${compMeta.size} comps · population persisted`);

  // Pass 2 must NOT bail on `aborting` — it's cheap (DB writes only, no Riot
  // calls) and dropping snapshots was the bug that left vn2 with 0 writes for
  // 4+ days (2026-06-04 → 06-06). The Conflicts= SIGTERM from the daily-crawl
  // timer fires mid-Pass-1; before this fix the same flag killed Pass 2 too,
  // discarding every gathered player. Memory:
  // feedback_verify_background_services + project_status 2026-06-06.
  //
  // The whole-run timeout (TimeoutStopSec=600) still bounds Pass 2 if it ever
  // somehow gets stuck — systemd SIGKILLs after the grace period.
  console.log(`\n[3/3] Pass 2: score + snapshot (runs to completion regardless of SIGTERM)`);
  let snapshotted = 0, unrated = 0;
  const snapshotCtx = {
    region: REGION, regional: REGIONAL,
    apiKey: API_KEY, snapshotDate: SNAPSHOT_DATE,
  };
  for (const g of gathered) {
    try {
      const r = await snapshotPlayer(pool, riot, g.p, g.raw, pop, snapshotCtx);
      if (r.snapshotted) snapshotted++; else unrated++;
    } catch (err) {
      failed++;
      console.error(`  [error] snapshot ${g.p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }
  if (aborting) {
    console.log(`  [signal] Pass 2 completed despite SIGTERM — ${snapshotted} snapshots persisted`);
  }

  const totalS = (Date.now() - t0) / 1000;
  console.log(`\nDone. ${snapshotted} snapshots / ${gathered.length} usable / ${players.length} total | ${tooFew} too-few, ${unrated} unrated, ${failed} failed in ${totalS.toFixed(0)}s`);
  } finally {
    // Always close the pool so the event loop drains and the systemd oneshot
    // can exit instead of sitting in "activating" forever on a stuck socket.
    await pool.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});

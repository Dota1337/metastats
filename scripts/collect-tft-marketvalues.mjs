#!/usr/bin/env node
/**
 * TFT marketvalue crawler — Hetzner Postgres edition.
 *
 * Per player (Master/GM/Challenger by default; --include-diamond to extend):
 *   1. Discover via apex/league endpoints
 *   2. refreshPlayerMatchCache → keeps tft_player_match_cache current
 *   3. listSeasonMatches(currentSet) → all the player's matches for the live set
 *   4. upsertSeasonStats → tft_player_season_stats
 *   5. calculateTftMarketValue over the full set → tft_player_marketvalue_snapshots
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
import { calculateTftMarketValue, buildSnapshotForPlayer } from './lib/tft-marketvalue.mjs';
import { refreshPlayerMatchCache, listSeasonMatches } from './lib/tft-match-cache-pg.mjs';
import {
  upsertSeasonStats,
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const INCLUDE_DIAMOND = hasFlag('--include-diamond');
const LIMIT = parseInt(arg('--limit', '0'), 10);
const FORCE_REFRESH = hasFlag('--force-refresh');
const SKIP_CACHE_REFRESH = hasFlag('--skip-cache-refresh');
const VERBOSE = hasFlag('--verbose');

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

const REGIONAL = ({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
})[REGION] || 'europe';

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

// ─────────────────────────────────────────────────────────────────────────────
// setup
// ─────────────────────────────────────────────────────────────────────────────

// Cap below the TFT prod match-detail method limit (200/10s), shared with
// the all-ranks crawler.
const riot = createRiotClient({
  shortWindowRequests: 18,
  shortWindowMs: 1100,
  longWindowRequests: 180,
  longWindowMs: 10_500,
});
const rl = url => riot.fetchJson(url, { safe: true });

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });

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
  // Diamond has 4 divisions × pages. Walk until empty.
  const all = [];
  for (const division of ['I', 'II', 'III', 'IV']) {
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
// per-region context: KG, current set
// ─────────────────────────────────────────────────────────────────────────────

function loadGraph() {
  const path = resolve(process.cwd(), 'public', `tft-graph-${REGION}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function loadCurrentSet() {
  const path = resolve(process.cwd(), 'public', 'tft-set.json');
  if (!existsSync(path)) {
    console.error('public/tft-set.json missing — set detection unavailable');
    return null;
  }
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j.currentSet?.number ?? j.setNumber ?? null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// per-player pipeline
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAccount(puuid) {
  const r = await rl(`https://${REGIONAL}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${API_KEY}`);
  if (!r || r._status) return null;
  return { gameName: r.gameName || null, tagLine: r.tagLine || null };
}

async function processPlayer(p, ctx) {
  const { setNumber, hotCompKeys, recommendedItems, graph } = ctx;
  // 1) Bring match cache up-to-date for this player
  if (!SKIP_CACHE_REFRESH) {
    await refreshPlayerMatchCache(pool, p.puuid, REGION, REGIONAL, riot, {
      force: FORCE_REFRESH,
      log: VERBOSE ? (msg) => console.log(`    ${msg}`) : undefined,
    });
  }

  // 2) Read all set matches from cache
  const matches = await listSeasonMatches(pool, p.puuid, setNumber);

  // 3) Aggregate per-set stats (always — even on empty matches we write
  //    a row so the UI can show 0 sample-size honestly)
  await upsertSeasonStats(pool, p.puuid, REGION, setNumber, {
    matches, hotCompKeys, recommendedItems,
  });

  // 4) Marketvalue snapshot — only persist if we have enough sample
  if (matches.length < 5) {
    return { snapshotted: false, sampleSize: matches.length, reason: 'too few matches' };
  }
  const result = calculateTftMarketValue({
    ranked: { tier: p.tier, rank: p.rank || 'I', leaguePoints: p.lp, wins: p.wins, losses: p.losses },
    playerRank: p.tier === 'CHALLENGER' ? p.ladderRank : undefined,
    matches,
    patchKnowledgeGraph: graph,
  });
  if (!result.rated) {
    return { snapshotted: false, sampleSize: matches.length, reason: result.notRatedReason };
  }

  const acc = await fetchAccount(p.puuid);
  const snapshotDateExpr = SNAPSHOT_DATE ? '$3::date' : 'current_date';
  const baseParams = SNAPSHOT_DATE ? [SNAPSHOT_DATE] : [];
  await pool.query(
    `insert into tft_player_marketvalue_snapshots (
       puuid, region, snapshot_date, game_name, tag_line, tier, rank, lp, ladder_rank,
       base_value, multiplier, final_value, sample_size, damping, agents
     ) values ($1, $2, ${snapshotDateExpr}, $${3 + baseParams.length}, $${4 + baseParams.length}, $${5 + baseParams.length}, $${6 + baseParams.length}, $${7 + baseParams.length}, $${8 + baseParams.length}, $${9 + baseParams.length}, $${10 + baseParams.length}, $${11 + baseParams.length}, $${12 + baseParams.length}, $${13 + baseParams.length}, $${14 + baseParams.length}::jsonb)
     on conflict (puuid, region, snapshot_date) do update set
       game_name   = excluded.game_name,
       tag_line    = excluded.tag_line,
       tier        = excluded.tier,
       rank        = excluded.rank,
       lp          = excluded.lp,
       ladder_rank = excluded.ladder_rank,
       base_value  = excluded.base_value,
       multiplier  = excluded.multiplier,
       final_value = excluded.final_value,
       sample_size = excluded.sample_size,
       damping     = excluded.damping,
       agents      = excluded.agents`,
    [
      p.puuid, REGION,
      ...baseParams,
      acc?.gameName ?? null, acc?.tagLine ?? null,
      p.tier, p.rank ?? 'I', p.lp, p.ladderRank ?? null,
      result.baseValue, result.multiplier, result.finalValue,
      result.sampleSize, result.damping, JSON.stringify(result.agents),
    ],
  );
  return { snapshotted: true, sampleSize: matches.length, finalValue: result.finalValue };
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== TFT Marketvalue Crawler (Hetzner) — ${REGION}${SNAPSHOT_DATE ? ` · snapshot_date=${SNAPSHOT_DATE}` : ''} ===`);
  const t0 = Date.now();

  const setNumber = loadCurrentSet();
  if (setNumber == null) { console.error('No current set, aborting'); process.exit(1); }
  console.log(`  current set: ${setNumber}`);

  const graph = loadGraph();
  console.log(`  graph: ${graph ? 'loaded' : 'not available'}`);
  const hotCompKeys = buildHotCompKeys(graph);
  const recommendedItems = buildRecommendedItems(graph);

  let players = PUUIDS ? await loadPlayersByPuuids(PUUIDS) : await discoverPlayers();
  if (LIMIT > 0) players = players.slice(0, LIMIT);
  console.log(`\n[1/2] ${players.length} players to process\n`);

  console.log('[2/2] Refresh cache + snapshot per player');
  let processed = 0, snapshotted = 0, skipped = 0, failed = 0;
  const ctx = { setNumber, hotCompKeys, recommendedItems, graph };
  for (const p of players) {
    try {
      const r = await processPlayer(p, ctx);
      processed++;
      if (r.snapshotted) snapshotted++; else skipped++;
      if (VERBOSE || processed % 25 === 0 || processed === players.length) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${processed}/${players.length} | ${snapshotted} snapshots, ${skipped} skipped, ${failed} failed | ${elapsed}s`);
      }
    } catch (err) {
      failed++;
      console.error(`  [error] puuid=${p.puuid.slice(0, 8)}…: ${err.message}`);
      if (VERBOSE) console.error(err.stack);
    }
  }

  const totalS = (Date.now() - t0) / 1000;
  console.log(`\nDone. ${snapshotted} snapshots / ${processed} processed / ${players.length} total in ${totalS.toFixed(0)}s`);

  await pool.end();
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  pool.end().catch(() => {});
  process.exit(1);
});

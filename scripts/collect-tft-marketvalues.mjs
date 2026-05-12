#!/usr/bin/env node
/**
 * Daily TFT marketvalue snapshot crawler.
 *
 * For each Master+ player in the given region:
 *   1. resolve account (puuid + Riot ID)
 *   2. fetch ranked entry (tier/rank/lp)
 *   3. fetch last 30 ranked TFT matches
 *   4. compute marketvalue via scripts/lib/tft-marketvalue.mjs
 *   5. upsert one row into tft_player_marketvalue_snapshots
 *
 * Uses RIOT_API_KEY_TFT (Production tier, ~50 req/s app-wide; capped by
 * match-detail method-limit 200 req/10s).
 *
 * Usage:
 *   node scripts/collect-tft-marketvalues.mjs --region euw1                  # Chall+GM only (default)
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --include-master # +Master (10x volume)
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --limit 5        # smoke-test: top 5 only
 *   node scripts/collect-tft-marketvalues.mjs --region euw1 --no-supabase    # skip DB write
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRiotClient } from './lib/riot-client.mjs';
import {
  calculateTftMarketValue,
  buildSnapshotForPlayer,
} from './lib/tft-marketvalue.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const INCLUDE_MASTER = hasFlag('--include-master') || hasFlag('--all-tiers');
const LIMIT = parseInt(arg('--limit', '0'), 10);
const MATCHES_PER_PLAYER = parseInt(arg('--matches-per-player', '30'), 10);
const SKIP_SUPABASE = hasFlag('--no-supabase');
const VERBOSE = hasFlag('--verbose');

const REGIONAL = ({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
})[REGION] || 'europe';

// Load env from .env.local for local runs; CI passes them in via secrets.
function loadEnv() {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const API_KEY = process.env.RIOT_API_KEY_TFT;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT env var required'); process.exit(1); }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY missing (or pass --no-supabase)');
  process.exit(1);
}

// Match TFT-allranks crawler settings: 90% of method-limit so concurrent
// crawlers / API endpoints can't blow the bucket.
const riot = createRiotClient({
  shortWindowRequests: 180,
  shortWindowMs: 10_500,
  longWindowRequests: 28000,
  longWindowMs: 605_000,
});
const rl = url => riot.fetchJson(url, { safe: true });

// ─────────────────────────────────────────────────────────────────────────────
// player discovery — apex tiers (Chall/GM/Master)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchApex(tier) {
  // tier = 'challenger' | 'grandmaster' | 'master'
  const data = await rl(`https://${REGION}.api.riotgames.com/tft/league/v1/${tier}?api_key=${API_KEY}`);
  if (!data || data._status) {
    if (data?._status) console.log(`  [discovery] ${tier} returned HTTP ${data._status}`);
    return [];
  }
  return (data.entries || []).map(e => ({
    puuid: e.puuid,
    lp: e.leaguePoints ?? 0,
    tier: tier.toUpperCase(),
    wins: e.wins ?? 0,
    losses: e.losses ?? 0,
  }));
}

async function discoverPlayers() {
  console.log(`[discovery] ${REGION} — apex tiers${INCLUDE_MASTER ? ' (incl. Master)' : ''}`);
  const all = [];
  for (const tier of ['challenger', 'grandmaster']) {
    const entries = await fetchApex(tier);
    console.log(`  ${tier}: ${entries.length}`);
    all.push(...entries);
  }
  if (INCLUDE_MASTER) {
    const master = await fetchApex('master');
    console.log(`  master: ${master.length}`);
    all.push(...master);
  }
  // Rank players within the regional apex ladder (descending LP). This
  // ladder_rank goes into the base-value curve for top-N Challenger players.
  all.sort((a, b) => b.lp - a.lp);
  for (let i = 0; i < all.length; i++) all[i].ladderRank = i + 1;
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// graph (optional — degrades gracefully if missing)
// ─────────────────────────────────────────────────────────────────────────────

function loadGraph() {
  const path = resolve(process.cwd(), 'public', `tft-graph-${REGION}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// per-player snapshot
// ─────────────────────────────────────────────────────────────────────────────

async function fetchAccount(puuid) {
  // by-puuid → gameName + tagLine
  const r = await rl(`https://${REGIONAL}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${API_KEY}`);
  if (!r || r._status) return null;
  return { gameName: r.gameName || null, tagLine: r.tagLine || null };
}

async function fetchRecentMatches(puuid) {
  const ids = await rl(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${MATCHES_PER_PLAYER}&api_key=${API_KEY}`);
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids) {
    const m = await rl(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${API_KEY}`);
    if (m && !m._status) out.push(m);
  }
  return out;
}

async function snapshotForPlayer(p, graph) {
  const acc = await fetchAccount(p.puuid);
  const rawMatches = await fetchRecentMatches(p.puuid);
  const matches = rawMatches
    .map(raw => buildSnapshotForPlayer(raw, p.puuid))
    .filter(Boolean);
  const result = calculateTftMarketValue({
    ranked: { tier: p.tier, rank: 'I', leaguePoints: p.lp, wins: p.wins, losses: p.losses },
    playerRank: p.tier === 'CHALLENGER' ? p.ladderRank : undefined,
    matches,
    patchKnowledgeGraph: graph,
  });
  return {
    puuid: p.puuid,
    region: REGION,
    snapshot_date: new Date().toISOString().slice(0, 10),
    game_name: acc?.gameName ?? null,
    tag_line: acc?.tagLine ?? null,
    tier: p.tier,
    rank: 'I',
    lp: p.lp,
    ladder_rank: p.ladderRank,
    base_value: result.baseValue,
    multiplier: result.multiplier,
    final_value: result.finalValue,
    sample_size: result.sampleSize,
    damping: result.damping,
    agents: result.agents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase upsert (batched)
// ─────────────────────────────────────────────────────────────────────────────

const BATCH = 200;

async function upsertSnapshots(rows) {
  if (rows.length === 0) return;
  if (SKIP_SUPABASE) {
    console.log(`  [supabase] --no-supabase set, skipping ${rows.length} rows`);
    return;
  }
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const url = `${SUPA_URL}/rest/v1/tft_player_marketvalue_snapshots?on_conflict=puuid,region,snapshot_date`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }
  console.log(`  [supabase] upserted ${rows.length} rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`=== TFT Marketvalue Crawler ${REGION} (regional ${REGIONAL}) ===`);
  const t0 = Date.now();

  let players = await discoverPlayers();
  if (LIMIT > 0) players = players.slice(0, LIMIT);
  console.log(`\n[1/2] ${players.length} players to snapshot\n`);

  const graph = loadGraph();
  console.log(`  [graph] ${graph ? 'loaded' : 'not available — agents degrade'}\n`);

  console.log('[2/2] Building snapshots');
  const rows = [];
  let processed = 0, failed = 0, unrated = 0;
  for (const p of players) {
    try {
      const row = await snapshotForPlayer(p, graph);
      if (row.final_value > 0) {
        rows.push(row);
      } else {
        unrated++;
      }
      processed++;
      if (VERBOSE || processed % 25 === 0 || processed === players.length) {
        const ratedPct = rows.length / Math.max(1, processed) * 100;
        const elapsedS = (Date.now() - t0) / 1000;
        console.log(`  ${processed}/${players.length} (${rows.length} rated, ${unrated} unrated, ${failed} failed) — ${elapsedS.toFixed(0)}s`);
      }
    } catch (err) {
      failed++;
      console.error(`  [error] puuid=${p.puuid.slice(0, 8)}…: ${err.message}`);
    }
  }

  console.log(`\n[supabase] writing ${rows.length} snapshots for ${REGION}`);
  await upsertSnapshots(rows);

  const totalS = (Date.now() - t0) / 1000;
  console.log(`\nDone. ${rows.length} rows / ${players.length} players in ${totalS.toFixed(0)}s (${(totalS / Math.max(1, players.length)).toFixed(1)}s per player avg)`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

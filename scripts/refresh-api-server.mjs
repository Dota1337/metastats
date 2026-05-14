#!/usr/bin/env node
/**
 * HTTP API on the Hetzner crawler box for on-demand single-player refresh.
 *
 * Vercel calls POST /refresh-player with { puuid, region } and a bearer token.
 * We refresh the player's match cache, re-compute their season stats and
 * marketvalue snapshot, and push the snapshot+stats straight to Supabase so
 * the Vercel API picks it up immediately without waiting for the daily sync.
 *
 * Routes:
 *   GET  /healthz         — liveness probe
 *   POST /refresh-player  — { puuid, region } → snapshot result
 *
 * Auth: Bearer token from $REFRESH_API_TOKEN (managed by /etc/metastats-crawler/env).
 * Rate limit: 60s per (puuid, region) — protects Riot quota from spam.
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRiotClient } from './lib/riot-client.mjs';
import { refreshPlayerMatchCache, listSeasonMatches, backfillPlayerCacheToSupabase } from './lib/tft-match-cache-pg.mjs';
import {
  upsertSeasonStats,
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';
import { calculateTftMarketValue } from './lib/tft-marketvalue.mjs';

const REGIONAL = ({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
});

// ─ env loader (matches crawler) ────────────────────────────────────────────
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

const PORT = Number(process.env.REFRESH_API_PORT || 4000);
const AUTH_TOKEN = process.env.REFRESH_API_TOKEN;
const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
const DB_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!AUTH_TOKEN || !RIOT_KEY || !DB_URL || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing env: REFRESH_API_TOKEN / RIOT_API_KEY_TFT / DATABASE_URL / SUPABASE_*');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DB_URL, max: 5 });

// Single shared riot client — the rate-limiter must be process-wide so a
// burst of refresh calls doesn't trip 429s.
const riot = createRiotClient({
  shortWindowRequests: 18,
  shortWindowMs: 1100,
  longWindowRequests: 180,
  longWindowMs: 10_500,
});

// ─ KG cache per region ─────────────────────────────────────────────────────
const kgCache = new Map();   // region → { hotCompKeys, recommendedItems, graph }
function loadGraph(region) {
  const path = resolve(process.cwd(), 'public', `tft-graph-${region}.json`);
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}
function getRegionCtx(region) {
  if (kgCache.has(region)) return kgCache.get(region);
  const graph = loadGraph(region);
  const ctx = {
    graph,
    hotCompKeys: buildHotCompKeys(graph),
    recommendedItems: buildRecommendedItems(graph),
  };
  kgCache.set(region, ctx);
  return ctx;
}
function loadCurrentSet() {
  const path = resolve(process.cwd(), 'public', 'tft-set.json');
  if (!existsSync(path)) return null;
  try {
    const j = JSON.parse(readFileSync(path, 'utf8'));
    return j.currentSet?.number ?? j.setNumber ?? null;
  } catch { return null; }
}

// ─ Supabase push of one snapshot + one season-stats row ────────────────────
async function pushToSupabase(snapshotRow, seasonRow) {
  const headers = {
    apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  await fetch(`${SUPA_URL}/rest/v1/tft_player_marketvalue_snapshots?on_conflict=puuid,region,snapshot_date`, {
    method: 'POST', headers, body: JSON.stringify([snapshotRow]),
  }).then(r => { if (!r.ok) throw new Error(`snapshot push ${r.status}`); });
  await fetch(`${SUPA_URL}/rest/v1/tft_player_season_stats?on_conflict=puuid,region,set_number`, {
    method: 'POST', headers, body: JSON.stringify([seasonRow]),
  }).then(r => { if (!r.ok) throw new Error(`season push ${r.status}`); });
}

// ─ Fetch ranked + account for the puuid ────────────────────────────────────
async function fetchPlayerRanked(puuid, region) {
  const rankedUrl = `https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}?api_key=${RIOT_KEY}`;
  const ranked = await riot.fetchJson(rankedUrl, { safe: true });
  const rankedSolo = Array.isArray(ranked)
    ? ranked.find(r => r.queueType === 'RANKED_TFT')
    : null;
  return rankedSolo;
}
async function fetchAccount(puuid, regional) {
  const r = await riot.fetchJson(
    `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-puuid/${puuid}?api_key=${RIOT_KEY}`,
    { safe: true },
  );
  if (!r || r._status) return null;
  return { gameName: r.gameName, tagLine: r.tagLine };
}

// ─ Main work: refresh one player end-to-end ────────────────────────────────
async function refreshOnePlayer(puuid, region) {
  const setNumber = loadCurrentSet();
  if (setNumber == null) throw new Error('no current set');
  const regional = REGIONAL[region];
  if (!regional) throw new Error(`unknown region ${region}`);

  const ctx = getRegionCtx(region);

  // 1) Cache refresh (Hetzner-PG, with Supabase mirror of new rows)
  await refreshPlayerMatchCache(pool, puuid, region, regional, riot, { force: true });

  // 1b) Backfill Supabase with ANY cached matches not yet mirrored. The
  //     refresh above only mirrors *new* rows — for players who were
  //     crawled before the mirror was wired up this is the catch-up.
  //     Fire-and-forget; failure shouldn't block the marketvalue compute.
  backfillPlayerCacheToSupabase(pool, puuid).catch(() => {});

  // 2) Read set matches
  const matches = await listSeasonMatches(pool, puuid, setNumber);

  // 3) Aggregate season stats
  await upsertSeasonStats(pool, puuid, region, setNumber, {
    matches, hotCompKeys: ctx.hotCompKeys, recommendedItems: ctx.recommendedItems,
  });

  if (matches.length < 5) {
    return { ok: true, rated: false, reason: 'too_few_matches', sampleSize: matches.length };
  }

  // 4) Pull ranked + account
  const ranked = await fetchPlayerRanked(puuid, region);
  if (!ranked) {
    return { ok: true, rated: false, reason: 'unranked', sampleSize: matches.length };
  }
  const account = await fetchAccount(puuid, regional);

  // Preserve the player's last known ladder_rank from the daily crawler —
  // the single-player refresh has no cheap way to recompute it, and
  // dropping it would collapse Top-50 Challenger base values onto the LP
  // fallback curve (€200k → €50k for rank 1).
  const ladderRankRow = await pool.query(
    'select ladder_rank from tft_player_marketvalue_snapshots where puuid = $1 and region = $2 and ladder_rank is not null order by snapshot_date desc limit 1',
    [puuid, region],
  );
  const ladderRank = ladderRankRow.rows[0]?.ladder_rank ?? null;

  // 5) Marketvalue compute
  const result = calculateTftMarketValue({
    ranked: {
      tier: ranked.tier, rank: ranked.rank, leaguePoints: ranked.leaguePoints,
      wins: ranked.wins, losses: ranked.losses,
    },
    playerRank: ranked.tier === 'CHALLENGER' && ladderRank ? ladderRank : undefined,
    matches,
    patchKnowledgeGraph: ctx.graph,
  });
  if (!result.rated) {
    return { ok: true, rated: false, reason: result.notRatedReason, sampleSize: matches.length };
  }

  // 6) Persist locally + remotely
  const today = new Date().toISOString().slice(0, 10);
  const snapshotRow = {
    puuid, region, snapshot_date: today,
    game_name: account?.gameName ?? null, tag_line: account?.tagLine ?? null,
    tier: ranked.tier, rank: ranked.rank, lp: ranked.leaguePoints,
    ladder_rank: ladderRank,
    base_value: result.baseValue, multiplier: Number(result.multiplier),
    final_value: result.finalValue, sample_size: result.sampleSize,
    damping: Number(result.damping), agents: result.agents,
  };
  await pool.query(
    `insert into tft_player_marketvalue_snapshots (
       puuid, region, snapshot_date, game_name, tag_line, tier, rank, lp, ladder_rank,
       base_value, multiplier, final_value, sample_size, damping, agents
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb)
     on conflict (puuid, region, snapshot_date) do update set
       game_name = excluded.game_name, tag_line = excluded.tag_line,
       tier = excluded.tier, rank = excluded.rank, lp = excluded.lp,
       base_value = excluded.base_value, multiplier = excluded.multiplier,
       final_value = excluded.final_value, sample_size = excluded.sample_size,
       damping = excluded.damping, agents = excluded.agents`,
    [
      snapshotRow.puuid, snapshotRow.region, snapshotRow.snapshot_date,
      snapshotRow.game_name, snapshotRow.tag_line, snapshotRow.tier,
      snapshotRow.rank, snapshotRow.lp, snapshotRow.ladder_rank,
      snapshotRow.base_value, snapshotRow.multiplier, snapshotRow.final_value,
      snapshotRow.sample_size, snapshotRow.damping, JSON.stringify(snapshotRow.agents),
    ],
  );

  // Reload the season row so we push the same shape to Supabase
  const seasonRowRes = await pool.query(
    `select puuid, region, set_number, sample_size,
            avg_placement::float8, top4_rate::float8, top1_rate::float8,
            bottom4_rate::float8, placement_stddev::float8, best_top4_streak,
            unique_comps, dominant_share::float8, meta_pick_share::float8,
            item_slam_score::float8, first_match_at, last_match_at, updated_at
       from tft_player_season_stats
      where puuid = $1 and region = $2 and set_number = $3`,
    [puuid, region, setNumber],
  );
  await pushToSupabase(snapshotRow, seasonRowRes.rows[0]);

  return {
    ok: true, rated: true,
    snapshotDate: today, finalValue: result.finalValue,
    multiplier: result.multiplier, sampleSize: result.sampleSize,
  };
}

// ─ Per-key in-flight + rate-limit map ──────────────────────────────────────
const recent = new Map();        // key → last completion timestamp
const inflight = new Map();      // key → Promise<result>  (dedupe concurrent calls)
const REFRESH_MIN_INTERVAL_MS = 60_000;

async function handleRefresh(body) {
  const { puuid, region } = body;
  if (!puuid || !region) throw Object.assign(new Error('puuid+region required'), { status: 400 });
  if (!REGIONAL[region]) throw Object.assign(new Error(`unknown region ${region}`), { status: 400 });

  const key = `${puuid}|${region}`;
  const now = Date.now();
  const last = recent.get(key);
  if (last && now - last < REFRESH_MIN_INTERVAL_MS) {
    const retryAfter = Math.ceil((REFRESH_MIN_INTERVAL_MS - (now - last)) / 1000);
    throw Object.assign(new Error(`rate_limited`), { status: 429, retryAfter });
  }
  if (inflight.has(key)) return inflight.get(key);

  const promise = (async () => {
    try {
      const result = await refreshOnePlayer(puuid, region);
      recent.set(key, Date.now());
      return result;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

// ─ HTTP server ─────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 8192) reject(new Error('body too large')); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  // Liveness
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, ts: Date.now() }));
  }

  if (req.method !== 'POST' || req.url !== '/refresh-player') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'not_found' }));
  }

  // Auth
  if (req.headers.authorization !== `Bearer ${AUTH_TOKEN}`) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'unauthorized' }));
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'invalid_json' }));
  }

  try {
    const result = await handleRefresh(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    const status = err.status || 500;
    const payload = { error: err.message || 'internal' };
    if (err.retryAfter) {
      payload.retryAfter = err.retryAfter;
      res.setHeader('Retry-After', String(err.retryAfter));
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  }
});

server.listen(PORT, () => console.log(`refresh-api listening on :${PORT}`));

// Graceful shutdown so systemd restart doesn't drop in-flight work mid-DB
['SIGTERM', 'SIGINT'].forEach(sig => process.on(sig, () => {
  console.log(`${sig} received, draining`);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}));

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
 *   POST /explore-matches — { units, region, buckets, days, limit } → aggregate stats + sample
 *                            match-level explorer over tft_player_match_cache (Set 17 only,
 *                            uses GIN index idx_match_cache_units_gin_s17 on units jsonb)
 *   POST /player-matches  — { puuids, set_number, queue_id?, limit_per_puuid? } → match rows
 *                            Generic per-player cache read. The Hetzner box is the only
 *                            source-of-truth for the Set-17 match cache (Supabase only has
 *                            the marketvalue + season snapshots replicated, not the full
 *                            per-match jsonb). All onetricks/coach/specialty/econ endpoints
 *                            route through here.
 *   POST /pros-by-comp    — { puuids, family_key | cluster_key, set_number?, min_games?, top_n?, since_ms? }
 *                            Reverse-lookup: welche Pro-Players spielen eine bestimmte Comp.
 *                            Cluster-Key Exact-Match ODER Family-Mode (<trait>__<carry>).
 *                            Voraussetzung: Cache muss mit unifizierter Klassifikations-Lib
 *                            re-klassifiziert sein (reference_tft_classification_bridge.md).
 *
 * Auth: Bearer token from $REFRESH_API_TOKEN (managed by /etc/metastats-crawler/env).
 * Rate limit: 60s per (puuid, region) — protects Riot quota from spam.
 */

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';

const execFileAsync = promisify(execFile);

// Liest systemd-Status für alle metastats-*.service Units. Dynamische Discovery
// via `systemctl list-units` — keine hardgecodete Service-Liste, damit der
// Aggregator bei neuem Service auf der Box automatisch aufnimmt.
async function collectServiceStatus() {
  // list-units --all liefert auch inactive Services; ohne --all würde
  // ein gestoppter Service einfach fehlen statt mit `inactive` zu erscheinen.
  const { stdout } = await execFileAsync('systemctl', [
    'list-units', '--type=service', '--all', '--no-pager', '--no-legend',
    '--plain', 'metastats-*',
  ]);
  const names = stdout
    .split('\n')
    .map(line => line.trim().split(/\s+/)[0])
    .filter(n => n && n.endsWith('.service') && n.startsWith('metastats-'));
  if (names.length === 0) return [];
  // Bulk `show` ist ein einzelner Roundtrip statt 1 pro Service.
  const props = [
    'Id', 'ActiveState', 'SubState', 'Result',
    'ActiveEnterTimestamp', 'ActiveExitTimestamp',
    'InactiveEnterTimestamp', 'InactiveExitTimestamp',
    'ExecMainStartTimestamp', 'ExecMainExitTimestamp',
    'Type',
  ];
  const { stdout: showOut } = await execFileAsync('systemctl', [
    'show', '--property=' + props.join(','), ...names,
  ]);
  const services = [];
  let current = {};
  for (const line of showOut.split('\n')) {
    if (line === '') {
      if (current.Id) services.push(normalizeServiceRecord(current));
      current = {};
      continue;
    }
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    current[line.slice(0, eq)] = line.slice(eq + 1);
  }
  if (current.Id) services.push(normalizeServiceRecord(current));
  return services;
}

function normalizeServiceRecord(raw) {
  // systemd-Timestamp ist locale-formatted, ISO-Konversion ist zuverlässiger.
  const ts = v => v && v !== 'n/a' && v !== '' ? new Date(v).toISOString() : null;
  return {
    name: raw.Id,
    type: raw.Type || null,
    activeState: raw.ActiveState || null,
    subState: raw.SubState || null,
    result: raw.Result || null,
    activeEnterTs: ts(raw.ActiveEnterTimestamp),
    activeExitTs: ts(raw.ActiveExitTimestamp),
    inactiveEnterTs: ts(raw.InactiveEnterTimestamp),
    inactiveExitTs: ts(raw.InactiveExitTimestamp),
    execMainStartTs: ts(raw.ExecMainStartTimestamp),
    execMainExitTs: ts(raw.ExecMainExitTimestamp),
  };
}
import { createRiotClient } from './lib/riot-client.mjs';
import { refreshPlayerMatchCache, listSeasonMatches, backfillPlayerCacheToSupabase } from './lib/tft-match-cache-pg.mjs';
import {
  upsertSeasonStats,
  buildHotCompKeys,
  buildRecommendedItems,
} from './lib/tft-season-aggregator.mjs';
import { computeBaseValue } from './lib/tft-marketvalue.mjs';
import { extractRawMetrics, scoreSkill } from './lib/tft-skill-score.mjs';

// Load the persisted region/set population so the single-player refresh can
// normalise this one player against the same cohort the batch computed.
// Returns null if the batch hasn't populated this region yet (→ neutral mult).
async function loadPopulation(pool, region, setNumber) {
  const r = await pool.query(
    'select medians, expected_dmg, comp_meta from tft_mv_population_stats where region = $1 and set_number = $2',
    [region, setNumber],
  );
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    pop: { medians: row.medians, expectedDmg: row.expected_dmg },
    compMeta: new Map(Object.entries(row.comp_meta || {})),
  };
}

import { REGIONAL_ROUTING as REGIONAL } from './lib/regional-routing.mjs';
import { CURRENT_SET, loadCurrentSet } from './lib/current-set.mjs';

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

// statement_timeout bounds every query so a Supabase/PG stall can't pin all 5
// connections forever and exhaust the pool — this is an always-on service, so
// pool exhaustion = total unresponsiveness until restart. Audit H2, 2026-06-28.
const pool = new pg.Pool({ connectionString: DB_URL, max: 5, statement_timeout: 30_000 });

// Single shared riot client — the rate-limiter is process-wide so a burst of
// refresh calls doesn't trip 429s. Capped at ~180/10s = 90% of Riot's
// match-detail 200/10s method limit (the external API limit). If a crawl
// overlaps this always-on server, riot-client's 429 Retry-After handling
// reconciles the shared bucket — no artificial sub-limit beyond Riot's own.
// Eigene, kleine Reserve im geteilten Key-Bucket (2026-08-02): 60 statt 180
// pro 10,5s. Dieser Dienst ist nutzerseitig und laeuft immer, die Batch-
// Prozesse laufen stundenlang — mit je 180 kamen beide zusammen auf das
// 1,8-Fache des Match-Detail-Limits. Ein einzelner Spieler-Refresh braucht
// ~30 Calls, mit 60/10,5s also ~5s Wartezeit im Limiter statt ~2s. Die Route
// hat 90s Timeout, das traegt. Budget-Herleitung siehe
// scripts/daily-marketvalue-snapshot.mjs.
const riot = createRiotClient({
  shortWindowRequests: 18,
  shortWindowMs: 1100,
  longWindowRequests: 60,
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
// loadCurrentSet lag hier als Zeile-fuer-Zeile-Kopie von
// scripts/lib/tft-marketvalue-pipeline.mjs — und 220 Zeilen weiter unten stand
// trotzdem `const SET_NUMBER = 17`. Beides ersetzt durch die geteilte Lib.

// ─ Supabase push of one snapshot + one season-stats row ────────────────────
async function pushToSupabase(snapshotRow, seasonRow) {
  const headers = {
    apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  await fetch(`${SUPA_URL}/rest/v1/tft_player_marketvalue_snapshots?on_conflict=puuid,region,snapshot_date`, {
    method: 'POST', headers, body: JSON.stringify([snapshotRow]), signal: AbortSignal.timeout(15_000),
  }).then(r => { if (!r.ok) throw new Error(`snapshot push ${r.status}`); });
  await fetch(`${SUPA_URL}/rest/v1/tft_player_season_stats?on_conflict=puuid,region,set_number`, {
    method: 'POST', headers, body: JSON.stringify([seasonRow]), signal: AbortSignal.timeout(15_000),
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

  // 5) Marketvalue compute — base × population-relative skill-score multiplier
  const base = computeBaseValue(
    { tier: ranked.tier, rank: ranked.rank, leaguePoints: ranked.leaguePoints, wins: ranked.wins, losses: ranked.losses },
    ranked.tier === 'CHALLENGER' && ladderRank ? ladderRank : undefined,
  );
  if (!base.rated) {
    return { ok: true, rated: false, reason: base.notRatedReason, sampleSize: matches.length };
  }
  // Normalise against the persisted population. If the batch hasn't populated
  // this region yet, fall back to a neutral 1.0 multiplier (base-only) so the
  // player still gets a rank-based value rather than nothing.
  const popData = await loadPopulation(pool, region, setNumber);
  let multiplier = 1, sampleSize = matches.length, damping = 1, signals = [];
  if (popData) {
    const raw = extractRawMetrics(matches, { wins: ranked.wins, losses: ranked.losses }, popData.compMeta);
    const sk = scoreSkill(raw, popData.pop);
    multiplier = sk.multiplier; sampleSize = sk.sampleSize; damping = sk.damping; signals = sk.signals;
  }
  const baseValue = Math.round(base.baseValue);
  const finalValue = Math.round(base.baseValue * multiplier);

  // 6) Persist locally + remotely
  const today = new Date().toISOString().slice(0, 10);
  const snapshotRow = {
    puuid, region, snapshot_date: today,
    game_name: account?.gameName ?? null, tag_line: account?.tagLine ?? null,
    tier: ranked.tier, rank: ranked.rank, lp: ranked.leaguePoints,
    ladder_rank: ladderRank,
    base_value: baseValue, multiplier,
    final_value: finalValue, sample_size: sampleSize,
    damping, agents: signals,
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
    snapshotDate: today, finalValue,
    multiplier, sampleSize,
  };
}

// ─ Per-key in-flight + rate-limit map ──────────────────────────────────────
const recent = new Map();        // key → last completion timestamp
const inflight = new Map();      // key → Promise<result>  (dedupe concurrent calls)
const REFRESH_MIN_INTERVAL_MS = 60_000;

// Prune stale throttle entries so `recent` doesn't grow unbounded on this
// long-lived server (an entry older than the interval can never throttle again).
setInterval(() => {
  const cutoff = Date.now() - REFRESH_MIN_INTERVAL_MS;
  for (const [k, ts] of recent) if (ts < cutoff) recent.delete(k);
}, 3_600_000).unref();

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
      return await refreshOnePlayer(puuid, region);
    } finally {
      // Stamp the cooldown on BOTH success and failure — a failing Riot endpoint
      // must not be hammered with zero backoff on every retry (retry-storm that
      // burns Riot quota + DB connections). Audit M1, 2026-06-28.
      recent.set(key, Date.now());
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

// ─ HTTP server ─────────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve, reject) => {
    // Bound slow-body clients so they can't pin a connection (and, with the
    // capped pool, contribute to exhaustion). Audit M2, 2026-06-28.
    req.setTimeout(10_000, () => req.destroy(new Error('request body timeout')));
    let buf = '';
    req.on('data', c => { buf += c; if (buf.length > 1_048_576) reject(new Error('body too large')); });
    req.on('end', () => resolve(buf));
    req.on('error', reject);
  });
}

// ─ Match-level explorer ────────────────────────────────────────────────────
// Returns aggregate stats + sample matches for a unit-filter combo over the
// Set-17 match cache. The units filter goes through the GIN index
// idx_match_cache_units_gin_s17; bucket/region/days post-filter via btree
// scan over the matching match-cache rows. Capped at 5000 matches to keep
// the query bounded on the Hetzner pool.
const SET_NUMBER = CURRENT_SET;
const QUEUE_RANKED = 1100;
const MAX_LIMIT = 5000;
const REGION_BUCKETS = {
  master_plus: { tiers: ['MASTER', 'GRANDMASTER', 'CHALLENGER'] },
  challenger:  { tiers: ['CHALLENGER'] },
  grandmaster: { tiers: ['GRANDMASTER'] },
  master:      { tiers: ['MASTER'] },
  diamond:     { tiers: ['DIAMOND'] },
};

async function handleExploreMatches(body) {
  const units = Array.isArray(body?.units) ? body.units.filter(u => typeof u === 'string' && u.length > 0).slice(0, 6) : [];
  const region = typeof body?.region === 'string' ? body.region : 'all';
  const days = Math.max(1, Math.min(30, Number(body?.days) || 3));
  const limit = Math.max(50, Math.min(MAX_LIMIT, Number(body?.limit) || 5000));
  // Star / items-count filters (Phase A2). Default = all tiers + all item-
  // counts to keep parity with aggregate stats. Empty array OR not provided
  // means "no filter". `1..4` for stars (TFT supports 4★ from Set 17), `0..3`
  // for items-count (each carrier slot holds 0-3 items).
  const starLevels = Array.isArray(body?.starLevels)
    ? body.starLevels.map(n => Number(n)).filter(n => n >= 1 && n <= 4)
    : [];
  const itemCounts = Array.isArray(body?.itemCounts)
    ? body.itemCounts.map(n => Number(n)).filter(n => n >= 0 && n <= 3)
    : [];

  const sinceMs = Date.now() - days * 86_400_000;

  // Build the units @> jsonb filter. Each requested character_id becomes its
  // own contains clause so the GIN(jsonb_ops) index can serve them via bitmap
  // AND. When star-levels are provided, we expand to one contains-clause per
  // (char × tier) and OR them per character — the index still does the pre-
  // filter via bitmap-OR/AND, then EXISTS post-filter validates items-count
  // (array_length isn't indexable on jsonb_ops anyway, so it'd be heap-filter
  // either way; doing it post-prefilter keeps the heap set small).
  const filters = ['set_number = $1', 'queue_id = $2', 'game_datetime >= $3'];
  const params = [SET_NUMBER, QUEUE_RANKED, sinceMs];
  let p = 4;
  for (const u of units) {
    if (starLevels.length > 0) {
      const orClauses = [];
      for (const t of starLevels) {
        orClauses.push(`units @> $${p}::jsonb`);
        params.push(JSON.stringify([{ characterId: u, tier: t }]));
        p++;
      }
      filters.push('(' + orClauses.join(' OR ') + ')');
    } else {
      filters.push(`units @> $${p}::jsonb`);
      params.push(JSON.stringify([{ characterId: u }]));
      p++;
    }
  }
  if (region !== 'all') {
    filters.push(`region = $${p}`);
    params.push(region);
    p++;
  }
  // EXISTS post-filter for items-count + per-unit star validation. Runs on
  // the already-shrunk heap set from the GIN prefilter above.
  if (itemCounts.length > 0 || (starLevels.length > 0 && units.length > 1)) {
    for (const u of units) {
      const checks = [`u->>'characterId' = $${p}`];
      params.push(u); p++;
      if (starLevels.length > 0) {
        checks.push(`(u->>'tier')::int = ANY($${p}::int[])`);
        params.push(starLevels); p++;
      }
      if (itemCounts.length > 0) {
        // itemNames is the modern jsonb key; fall back to items for older rows.
        checks.push(`jsonb_array_length(COALESCE(u->'itemNames', u->'items', '[]'::jsonb)) = ANY($${p}::int[])`);
        params.push(itemCounts); p++;
      }
      filters.push(`EXISTS (SELECT 1 FROM jsonb_array_elements(units) u WHERE ${checks.join(' AND ')})`);
    }
  }

  const where = filters.join(' AND ');
  // No ORDER BY: lets Postgres stop as soon as it hits LIMIT rows via the
  // (set_number, queue_id, game_datetime) btree scan. Sample is sorted by
  // recency in Node after the result-set is bounded.
  const sql = `
    SELECT puuid, match_id, region, placement, level, last_round,
           total_damage, comp_cluster_key, carry_unit, game_datetime,
           units
    FROM tft_player_match_cache
    WHERE ${where}
    LIMIT ${limit}
  `;

  const t0 = Date.now();
  const rows = (await pool.query(sql, params)).rows;
  const queryMs = Date.now() - t0;

  if (rows.length === 0) {
    return { matchCount: 0, queryMs, units, region, days, starLevels, itemCounts, sample: [], aggregate: null };
  }

  let sumPlacement = 0, top4 = 0, top1 = 0, sumLevel = 0, sumLastRound = 0, sumDamage = 0;
  const regionDist = new Map();
  for (const r of rows) {
    sumPlacement += r.placement;
    if (r.placement <= 4) top4++;
    if (r.placement === 1) top1++;
    sumLevel += r.level;
    sumLastRound += r.last_round;
    sumDamage += r.total_damage;
    regionDist.set(r.region, (regionDist.get(r.region) || 0) + 1);
  }

  // Sort sample by recency in JS — cheap for ≤5k rows, free if we already
  // pulled them; avoids the DB-side ORDER BY that doubles query time.
  const sortedForSample = [...rows].sort((a, b) => Number(b.game_datetime) - Number(a.game_datetime));
  const sample = sortedForSample.slice(0, 50).map(r => ({
    matchId: r.match_id,
    region: r.region,
    placement: r.placement,
    level: r.level,
    lastRound: r.last_round,
    totalDamage: r.total_damage,
    compClusterKey: r.comp_cluster_key,
    carryUnit: r.carry_unit,
    gameDatetime: Number(r.game_datetime),
    units: Array.isArray(r.units) ? r.units.map(u => ({
      characterId: u.characterId || u.character_id,
      tier: u.tier,
      items: Array.isArray(u.itemNames) ? u.itemNames : (Array.isArray(u.items) ? u.items : []),
    })) : [],
  }));

  return {
    matchCount: rows.length,
    queryMs,
    units,
    region,
    days,
    starLevels,
    itemCounts,
    aggregate: {
      avgPlacement: sumPlacement / rows.length,
      top4Rate: top4 / rows.length,
      top1Rate: top1 / rows.length,
      avgLevel: sumLevel / rows.length,
      avgLastRound: sumLastRound / rows.length,
      avgDamage: sumDamage / rows.length,
      regionDist: Object.fromEntries(regionDist),
    },
    sample,
  };
}

// ─ Marketvalue pool (Master+ players) ──────────────────────────────────────
// PostgREST caps the public RPC at 1000 rows, so Master tier never makes it
// out of get_tft_latest_marketvalues for big regions (Challenger + GM alone
// take all 1000 slots). This endpoint queries the snapshot table directly
// on Hetzner-PG (no PostgREST cap) and returns the full Master+ pool.
async function handleMarketvaluePool(body) {
  const region = typeof body?.region === 'string' ? body.region.toLowerCase() : null;
  if (!region) throw new Error('region_required');
  const tiers = Array.isArray(body?.tiers) && body.tiers.length > 0
    ? body.tiers.filter(t => typeof t === 'string').map(t => t.toUpperCase())
    : ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
  const limit = Math.max(50, Math.min(10000, Number(body?.limit) || 3000));

  const recencyDays = Math.max(1, Math.min(60, Number(body?.recency_days) || 14));
  const sql = `
    select distinct on (puuid)
      puuid, game_name, tag_line, tier, rank, lp, ladder_rank, final_value, snapshot_date
    from tft_player_marketvalue_snapshots
    where region = $1 and tier = ANY($2::text[])
      and snapshot_date >= current_date - $3::int
    order by puuid, snapshot_date desc
  `;
  const t0 = Date.now();
  const rows = (await pool.query(sql, [region, tiers, recencyDays])).rows;
  // Sort by final_value desc + cap to `limit`.
  rows.sort((a, b) => Number(b.final_value || 0) - Number(a.final_value || 0));
  const capped = rows.slice(0, limit);
  return {
    region, tiers, count: capped.length, queryMs: Date.now() - t0,
    players: capped.map(r => ({
      puuid: r.puuid,
      gameName: r.game_name,
      tagLine: r.tag_line,
      tier: r.tier,
      rank: r.rank,
      lp: r.lp,
      ladderRank: r.ladder_rank,
      finalValue: r.final_value,
      snapshotDate: r.snapshot_date,
    })),
  };
}

// ─ Peer gold-left baseline (econ-score) ────────────────────────────────────
// Global Set-17 mean gold_left for placement≥5 players. The legacy Supabase
// query .limit(2000) sampled an arbitrary slice; we hold the same semantic
// here but run it on Hetzner so it actually returns Set-17 data.
async function handlePeerBaseline(body) {
  const setNumber = Number.isFinite(Number(body?.set_number)) ? Number(body.set_number) : SET_NUMBER;
  const minPlacement = Math.max(1, Math.min(8, Number(body?.min_placement) || 5));
  const sampleLimit = Math.max(100, Math.min(10000, Number(body?.limit) || 2000));
  const sql = `
    SELECT AVG(gold_left)::float AS avg_gold_left, COUNT(*)::int AS sample
    FROM (
      SELECT gold_left FROM tft_player_match_cache
      WHERE set_number = $1 AND queue_id = $2 AND placement >= $3 AND gold_left IS NOT NULL
      LIMIT $4
    ) s
  `;
  const r = await pool.query(sql, [setNumber, QUEUE_RANKED, minPlacement, sampleLimit]);
  return { avgGoldLeft: r.rows[0]?.avg_gold_left ?? null, sample: r.rows[0]?.sample ?? 0 };
}

// ─ Per-player match-cache read ─────────────────────────────────────────────
// Generic read endpoint for the app's match-driven views (onetricks,
// coach, specialty, econ, positions/by-units). All of these used to read
// from Supabase directly, but the per-match jsonb cache only lives on
// Hetzner — Supabase only has the Set-15-era rows mirrored from way back.
// So everything routes through here now.
async function handlePlayerMatches(body) {
  const puuids = Array.isArray(body?.puuids)
    ? body.puuids.filter(p => typeof p === 'string' && p.length > 0).slice(0, 3000)
    : [];
  if (puuids.length === 0) {
    return { matches: [] };
  }
  const setNumber = Number.isFinite(Number(body?.set_number)) ? Number(body.set_number) : SET_NUMBER;
  const queueId = body?.queue_id == null ? null : Number(body.queue_id);
  const limitPerPuuid = Math.max(1, Math.min(500, Number(body?.limit_per_puuid) || 50));
  const totalLimit = Math.max(1, Math.min(200000, Number(body?.limit) || puuids.length * limitPerPuuid));

  // LATERAL JOIN to get up to limit_per_puuid most-recent matches PER puuid.
  // The previous ROW_NUMBER+OUTER-LIMIT combo had a planner pathology with
  // large puuid lists where the outer LIMIT clipped at ~20% of expected.
  // LATERAL is the canonical per-group-LIMIT pattern and uses the
  // (puuid, set_number, queue_id, game_datetime) btree directly.
  const params = [puuids, setNumber];
  let p = 3;
  const innerFilters = [`c.puuid = req.puuid`, 'c.set_number = $2'];
  if (queueId != null) {
    innerFilters.push(`c.queue_id = $${p}`);
    params.push(queueId);
    p++;
  }
  params.push(limitPerPuuid);
  const lpuuidPlaceholder = `$${p}`;
  const sql = `
    SELECT m.puuid, m.match_id, m.region, m.set_number, m.queue_id, m.game_datetime,
           m.placement, m.level, m.last_round, m.total_damage, m.gold_left,
           m.players_eliminated, m.comp_cluster_key, m.carry_unit,
           m.units, m.traits, m.augments, m.carry_items
    FROM unnest($1::text[]) WITH ORDINALITY AS req(puuid, ord)
    JOIN LATERAL (
      SELECT *
      FROM tft_player_match_cache c
      WHERE ${innerFilters.join(' AND ')}
      ORDER BY c.game_datetime DESC
      LIMIT ${lpuuidPlaceholder}
    ) m ON true
    ORDER BY req.ord, m.game_datetime DESC
    LIMIT ${totalLimit}
  `;

  const t0 = Date.now();
  const rows = (await pool.query(sql, params)).rows;
  return {
    matches: rows.map(r => ({
      puuid: r.puuid,
      matchId: r.match_id,
      region: r.region,
      setNumber: r.set_number,
      queueId: r.queue_id,
      gameDatetime: Number(r.game_datetime),
      placement: r.placement,
      level: r.level,
      lastRound: r.last_round,
      totalDamage: r.total_damage,
      goldLeft: r.gold_left,
      playersEliminated: r.players_eliminated,
      compClusterKey: r.comp_cluster_key,
      carryUnit: r.carry_unit,
      units: r.units,
      traits: r.traits,
      augments: r.augments,
      carryItems: r.carry_items,
    })),
    queryMs: Date.now() - t0,
    count: rows.length,
  };
}

// ─ Pros-by-Comp: welche Pros spielen eine bestimmte Comp? ──────────────────
// Cross-Lookup von Aggregator-Listing-Comp (cluster_key oder Family-Key) zu
// den Pro-Players die diese Comp am haeufigsten gespielt haben. Aggregat
// pro Pro: games, sumPlacement, top4, top1.
//
// Klassifikations-Bridge-Voraussetzung: tft_player_match_cache muss mit der
// unifizierten Lib (scripts/lib/tft-classify-comp.mjs) re-klassifiziert sein —
// sonst matchen die cluster_keys nicht. Siehe reference_tft_classification_bridge.md.
//
// Family-Mode (recommended): family_key = `<trait>__<carry>` — matched alle
// Cluster mit gleichem Trait+Carry, unabhaengig von Level/Star/Augment. JS-
// post-filter ueber substring-Parse von comp_cluster_key.
async function handleProsByComp(body) {
  const puuids = Array.isArray(body?.puuids)
    ? body.puuids.filter(p => typeof p === 'string' && p.length > 0).slice(0, 500)
    : [];
  if (puuids.length === 0) return { pros: [], totalGames: 0 };

  const setNumber = Number.isFinite(Number(body?.set_number)) ? Number(body.set_number) : SET_NUMBER;
  const familyKey = typeof body?.family_key === 'string' ? body.family_key : null;
  const clusterKey = typeof body?.cluster_key === 'string' ? body.cluster_key : null;
  const minGames = Math.max(1, Math.min(20, Number(body?.min_games) || 2));
  const topN = Math.max(1, Math.min(50, Number(body?.top_n) || 10));
  // Optional Time-Window (epoch ms, exclusive lower bound)
  const sinceMs = Number.isFinite(Number(body?.since_ms)) ? Number(body.since_ms) : null;

  if (!familyKey && !clusterKey) {
    const e = new Error('family_key or cluster_key required');
    e.status = 400;
    throw e;
  }

  // Pro-Cohort wurde 2026-06-21 via scripts/reclassify-match-cache.mjs mit der
  // unifizierten Klassifikations-Lib re-klassifiziert (~41k rows, ~81% delta).
  // Cache haelt jetzt korrekte cluster_keys, kein Live-Re-Classify mehr noetig.
  //
  // Cluster-Mode: exact match auf comp_cluster_key (Index-Hit).
  // Family-Mode: load (puuid, placement, comp_cluster_key) der Cohort + parse
  // family aus cluster_key in JS. Drei Spalten statt vier JSONB → ~10x
  // schneller als der Live-Re-Classify-Vorgaenger.
  const t0 = Date.now();
  let sql, params;
  if (clusterKey && !familyKey) {
    sql = `
      SELECT puuid, placement
        FROM tft_player_match_cache
       WHERE set_number = $1
         AND queue_id = $2
         AND puuid = ANY($3::text[])
         AND comp_cluster_key = $4
         ${sinceMs ? 'AND game_datetime > $5' : ''}
    `;
    params = [setNumber, QUEUE_RANKED, puuids, clusterKey];
    if (sinceMs) params.push(sinceMs);
  } else {
    sql = `
      SELECT puuid, placement, comp_cluster_key
        FROM tft_player_match_cache
       WHERE set_number = $1
         AND queue_id = $2
         AND puuid = ANY($3::text[])
         AND comp_cluster_key IS NOT NULL
         ${sinceMs ? 'AND game_datetime > $4' : ''}
    `;
    params = [setNumber, QUEUE_RANKED, puuids];
    if (sinceMs) params.push(sinceMs);
  }
  const r = await pool.query(sql, params);
  const queryMs = Date.now() - t0;

  // Family-Key parsen: `<trait>@<level>_<carry>[*~#suffix]` → `<trait>__<carry>`.
  const parseFamily = (key) => {
    const m = /^(.+)@\d+_([^*~#]+)/.exec(key || '');
    return m ? `${m[1]}__${m[2]}` : null;
  };

  const acc = new Map();
  let matchedCount = 0;
  for (const row of r.rows) {
    if (familyKey) {
      if (parseFamily(row.comp_cluster_key) !== familyKey) continue;
    }
    // Cluster-Mode wurde im SQL gefiltert, kein zusaetzlicher Check noetig.
    matchedCount++;
    const e = acc.get(row.puuid) || { games: 0, sumPlacement: 0, top4: 0, top1: 0 };
    const p = row.placement || 9;
    e.games++;
    e.sumPlacement += p;
    if (p <= 4) e.top4++;
    if (p === 1) e.top1++;
    acc.set(row.puuid, e);
  }

  const pros = [...acc.entries()]
    .map(([puuid, e]) => ({
      puuid,
      games: e.games,
      avgPlacement: e.games > 0 ? e.sumPlacement / e.games : null,
      top4Rate: e.games > 0 ? e.top4 / e.games : null,
      top1Rate: e.games > 0 ? e.top1 / e.games : null,
    }))
    .filter(p => p.games >= minGames)
    .sort((a, b) => b.games - a.games)
    .slice(0, topN);

  return { pros, totalGames: matchedCount, queryMs };
}

const server = http.createServer(async (req, res) => {
  // Liveness + optional service-detail für das Internal-Ops-Dashboard.
  // ?detail=services listet alle metastats-*.service Units mit ActiveState,
  // SubState, Result, ActiveEnterTimestamp und InactiveEnterTimestamp.
  // Dynamische Discovery via `systemctl list-units` — keine hardgecodete Liste.
  if (req.method === 'GET' && req.url?.startsWith('/healthz')) {
    const wantDetail = req.url.includes('detail=services');
    const base = { ok: true, ts: Date.now() };
    if (!wantDetail) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(base));
    }
    try {
      const services = await collectServiceStatus();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ...base, services }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ...base, ok: false, error: String(err?.message || err) }));
    }
  }

  const isRefresh = req.method === 'POST' && req.url === '/refresh-player';
  const isExplore = req.method === 'POST' && req.url === '/explore-matches';
  const isPlayerMatches = req.method === 'POST' && req.url === '/player-matches';
  const isPeerBaseline = req.method === 'POST' && req.url === '/peer-baseline';
  const isMvPool = req.method === 'POST' && req.url === '/marketvalue-pool';
  const isProsByComp = req.method === 'POST' && req.url === '/pros-by-comp';
  if (!isRefresh && !isExplore && !isPlayerMatches && !isPeerBaseline && !isMvPool && !isProsByComp) {
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
    const result = isExplore ? await handleExploreMatches(body)
                  : isPlayerMatches ? await handlePlayerMatches(body)
                  : isPeerBaseline ? await handlePeerBaseline(body)
                  : isMvPool ? await handleMarketvaluePool(body)
                  : isProsByComp ? await handleProsByComp(body)
                  : await handleRefresh(body);
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

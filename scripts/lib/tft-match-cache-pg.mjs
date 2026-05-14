// Per-player TFT match cache against the Hetzner Postgres instance.
//
// This is the Node/pg port of app/lib/tft-player-cache.ts — same idea
// (incremental + initial-fill walk of Riot's match-V1 ids endpoint with
// dedup against what we've already cached), but it writes a *lean* row
// shape: only the fields the marketvalue agents consume.
//
// The schema lives in /etc/metastats-crawler — see migration 0004 (Supabase)
// and the parallel CREATE TABLE on Hetzner. Both keep (puuid, match_id) as
// the PK so upserts are safe under concurrent crawls.

import { buildSnapshotForPlayer } from './tft-marketvalue.mjs';

// Match-V1 detail endpoint has a 200/10s method limit per routing cluster.
// We don't add our own concurrency here — riot-client.mjs already enforces
// a sliding window, so back-to-back `fetchJson` calls naturally land at the
// safe rate.

const STALE_AFTER_MINUTES_DEFAULT = 5;
const RIOT_HISTORY_PAGE = 200;
const RIOT_HISTORY_MAX = 1000;          // hard ceiling Riot returns
const TFT_RANKED_QUEUE = 1100;

/**
 * Bring a player's match cache up to date with Riot.
 *
 * @param {import('pg').PoolClient | import('pg').Pool} db
 * @param {string} puuid
 * @param {string} region          platform routing value (euw1, kr, …)
 * @param {string} regional        regional routing (europe/americas/asia/sea)
 * @param {{ fetchJson: (url: string, opts?: { safe?: boolean }) => Promise<any> }} riot
 * @param {{ force?: boolean, maxStaleMinutes?: number, log?: (s: string) => void }} [opts]
 * @returns {Promise<{ cached: number, newMatches: number, skippedFresh: boolean }>}
 */
export async function refreshPlayerMatchCache(db, puuid, region, regional, riot, opts = {}) {
  const log = opts.log || (() => {});
  const maxStale = opts.maxStaleMinutes ?? STALE_AFTER_MINUTES_DEFAULT;

  if (!opts.force) {
    const stateRow = await db.query(
      'select last_fetched_at, total_cached_matches, initial_backfill_done from tft_player_fetch_state where puuid = $1 and region = $2',
      [puuid, region],
    );
    const state = stateRow.rows[0];
    if (state && Date.now() - new Date(state.last_fetched_at).getTime() < maxStale * 60_000) {
      return { cached: state.total_cached_matches, newMatches: 0, skippedFresh: true };
    }
  }

  // Pull recent ids first — if everything is already cached we exit cheap.
  const recentIds = await fetchIds(regional, puuid, riot, 0, RIOT_HISTORY_PAGE);
  if (recentIds.length === 0) {
    await upsertFetchState(db, puuid, region, null, 0, false);
    return { cached: 0, newMatches: 0, skippedFresh: false };
  }
  const cachedRecent = await listCachedIds(db, puuid, recentIds);
  const cachedSet = new Set(cachedRecent);
  const missingRecent = recentIds.filter(id => !cachedSet.has(id));

  // Decide between "incremental top-up" (most days) vs. "first-time backfill".
  let allMissing;
  let initialBackfill = false;
  if (missingRecent.length === recentIds.length) {
    // Either truly first-time, or our cache is way out of sync. Walk up to
    // Riot's 1000-id cap.
    initialBackfill = true;
    const fullIds = [...recentIds];
    for (let start = RIOT_HISTORY_PAGE; start < RIOT_HISTORY_MAX; start += RIOT_HISTORY_PAGE) {
      const page = await fetchIds(regional, puuid, riot, start, RIOT_HISTORY_PAGE);
      if (page.length === 0) break;
      fullIds.push(...page);
      if (page.length < RIOT_HISTORY_PAGE) break;
    }
    const alreadyCached = await listCachedIds(db, puuid, fullIds);
    const acSet = new Set(alreadyCached);
    allMissing = fullIds.filter(id => !acSet.has(id));
    log(`[cache] first-time fill: ${fullIds.length} ids on Riot, ${allMissing.length} new`);
  } else {
    allMissing = missingRecent;
    log(`[cache] incremental: ${missingRecent.length} new since last visit`);
  }

  if (allMissing.length === 0) {
    const total = await countCachedTotal(db, puuid);
    await upsertFetchState(db, puuid, region, recentIds[0], total, true);
    return { cached: total, newMatches: 0, skippedFresh: false };
  }

  // Fetch details one-by-one — riot-client handles rate-limiting. We *could*
  // parallelize but the windowed limiter already gates us to the safe rate;
  // adding Promise.all here just makes error handling harder.
  const newRows = [];
  for (const id of allMissing) {
    const raw = await riot.fetchJson(
      `https://${regional}.api.riotgames.com/tft/match/v1/matches/${id}?api_key=${process.env.RIOT_API_KEY_TFT}`,
      { safe: true },
    );
    if (!raw || raw._status) continue;
    if ((raw.info?.queue_id ?? raw.info?.queueId) !== TFT_RANKED_QUEUE) continue;
    const row = buildCachedRow(raw, puuid, region);
    if (row) newRows.push(row);
  }

  if (newRows.length > 0) {
    await upsertMatchRows(db, newRows);
    // Mirror to Supabase so Vercel-side aggregations see the new matches.
    // Failure is non-fatal — Hetzner-PG is the source of truth, Supabase is
    // the read-replica.
    if (opts.syncSupabase !== false) {
      try {
        await syncPlayerCacheToSupabase(newRows, { log });
      } catch (e) {
        log(`[cache] supabase mirror failed: ${e.message}`);
      }
    }
  }

  const total = await countCachedTotal(db, puuid);
  await upsertFetchState(db, puuid, region, recentIds[0], total, initialBackfill || true);

  log(`[cache] +${newRows.length} new matches, ${total} cached total`);
  return { cached: total, newMatches: newRows.length, skippedFresh: false };
}

// ── Riot helpers ────────────────────────────────────────────────────────────

async function fetchIds(regional, puuid, riot, start, count) {
  const url = `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}&api_key=${process.env.RIOT_API_KEY_TFT}`;
  const ids = await riot.fetchJson(url, { safe: true });
  return Array.isArray(ids) ? ids : [];
}

// Convert a raw Match-V1 DTO + puuid into the row shape the schema expects.
// Reuses buildSnapshotForPlayer (which detects set, classifies comp, etc.)
// so the cache stays in lockstep with what the marketvalue pipeline reads.
function buildCachedRow(rawMatch, puuid, region) {
  const snap = buildSnapshotForPlayer(rawMatch, puuid);
  if (!snap) return null;
  const me = rawMatch.info.participants.find(p => p.puuid === puuid);
  if (!me) return null;
  return {
    puuid,
    match_id: snap.matchId,
    region,
    set_number: snap.setNumber ?? 0,
    queue_id: TFT_RANKED_QUEUE,
    game_datetime: rawMatch.info.game_datetime ?? rawMatch.info.gameDatetime ?? 0,
    placement: snap.placement,
    level: me.level ?? 0,
    last_round: me.last_round ?? 0,
    total_damage: me.total_damage_to_players ?? 0,
    // gold_left can legitimately be 0 (Top-1 player spent everything) — only
    // null it when Riot omitted the field entirely.
    gold_left: typeof me.gold_left === 'number' ? me.gold_left : null,
    players_eliminated: me.players_eliminated ?? 0,
    comp_cluster_key: snap.comp?.clusterKey ?? null,
    carry_unit: snap.comp?.carryUnit ?? null,
    carry_items: snap.comp?.carryItems ?? [],
    augments: snap.augments,
    units: snap.units,
    traits: (me.traits || []).map(t => ({
      name: t.name,
      style: t.style ?? 0,
      tier_current: t.tier_current ?? 0,
      num_units: t.num_units ?? 0,
    })),
  };
}

// ── DB wrappers ─────────────────────────────────────────────────────────────

async function listCachedIds(db, puuid, ids) {
  if (ids.length === 0) return [];
  const r = await db.query(
    'select match_id from tft_player_match_cache where puuid = $1 and match_id = any($2)',
    [puuid, ids],
  );
  return r.rows.map(row => row.match_id);
}

async function countCachedTotal(db, puuid) {
  const r = await db.query(
    'select count(*)::int as n from tft_player_match_cache where puuid = $1',
    [puuid],
  );
  return r.rows[0]?.n ?? 0;
}

async function upsertFetchState(db, puuid, region, latestId, total, initialDone) {
  await db.query(
    `insert into tft_player_fetch_state (puuid, region, last_fetched_at, latest_match_id, total_cached_matches, initial_backfill_done)
       values ($1, $2, now(), $3, $4, $5)
     on conflict (puuid, region) do update set
       last_fetched_at = excluded.last_fetched_at,
       latest_match_id = excluded.latest_match_id,
       total_cached_matches = excluded.total_cached_matches,
       initial_backfill_done = tft_player_fetch_state.initial_backfill_done or excluded.initial_backfill_done`,
    [puuid, region, latestId, total, initialDone],
  );
}

async function upsertMatchRows(db, rows) {
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    // Parameter-positional bulk insert — 16 columns × N rows.
    const values = [];
    const params = [];
    let p = 1;
    for (const row of batch) {
      values.push(
        `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb, $${p++}::jsonb, $${p++}::jsonb, $${p++}::jsonb)`,
      );
      params.push(
        row.puuid,
        row.match_id,
        row.region,
        row.set_number,
        row.queue_id,
        row.game_datetime,
        row.placement,
        row.level,
        row.last_round,
        row.total_damage,
        row.gold_left,
        row.players_eliminated,
        row.comp_cluster_key,
        row.carry_unit,
        JSON.stringify(row.carry_items),
        JSON.stringify(row.augments),
        JSON.stringify(row.units),
        JSON.stringify(row.traits),
      );
    }
    const sql = `insert into tft_player_match_cache
      (puuid, match_id, region, set_number, queue_id, game_datetime, placement,
       level, last_round, total_damage, gold_left, players_eliminated,
       comp_cluster_key, carry_unit, carry_items, augments, units, traits)
      values ${values.join(',')}
      on conflict (puuid, match_id) do nothing`;
    await db.query(sql, params);
  }
}

// Mirror a player's match-cache rows to Supabase so the Vercel-side
// /api/tft/player-stats endpoint can serve per-match detail (placement
// distribution, top units, averages) without us having to give Vercel
// direct access to the Hetzner Postgres. The Supabase schema doesn't
// have the comp/carry columns we use locally for the marketvalue
// aggregator — we strip those before pushing. Idempotent (PK on
// puuid+match_id), so this is safe to call after every refresh.
const SUPABASE_BATCH = 200;
export async function syncPlayerCacheToSupabase(rows, opts = {}) {
  const log = opts.log || (() => {});
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supaUrl || !supaKey) {
    log('  [supabase] missing env, skipping match-cache sync');
    return { pushed: 0, skipped: rows.length };
  }
  if (rows.length === 0) return { pushed: 0, skipped: 0 };

  // Reshape for the Supabase schema: drop Hetzner-only columns, ensure
  // every required field is present with a fallback default.
  const supaRows = rows.map(r => ({
    puuid: r.puuid,
    match_id: r.match_id,
    region: r.region,
    set_number: r.set_number,
    queue_id: r.queue_id,
    game_datetime: r.game_datetime,
    placement: r.placement,
    level: r.level ?? 0,
    gold_left: r.gold_left ?? 0,
    players_eliminated: r.players_eliminated ?? 0,
    total_damage: r.total_damage ?? 0,
    last_round: r.last_round ?? 0,
    units: r.units || [],
    augments: r.augments || [],
    traits: r.traits || [],
  }));

  for (let i = 0; i < supaRows.length; i += SUPABASE_BATCH) {
    const batch = supaRows.slice(i, i + SUPABASE_BATCH);
    const res = await fetch(`${supaUrl}/rest/v1/tft_player_match_cache?on_conflict=puuid,match_id`, {
      method: 'POST',
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase match_cache upsert failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }
  log(`  [supabase] mirrored ${supaRows.length} match-cache rows`);
  return { pushed: supaRows.length, skipped: 0 };
}

// One-time backfill: push every already-cached match for a player from
// Hetzner Postgres up to Supabase. Used by the refresh API on first
// touch — the Hetzner Postgres has the player's full cache from the
// daily crawler but Supabase only has whatever was opportunistically
// written by older Vercel-side code paths.
export async function backfillPlayerCacheToSupabase(db, puuid, opts = {}) {
  const log = opts.log || (() => {});
  const r = await db.query(
    `select puuid, match_id, region, set_number, queue_id, game_datetime,
            placement, level, last_round, total_damage, gold_left,
            players_eliminated, units, augments, traits
       from tft_player_match_cache
       where puuid = $1`,
    [puuid],
  );
  if (r.rows.length === 0) {
    log('[backfill] no cached matches yet for player');
    return { pushed: 0 };
  }
  return syncPlayerCacheToSupabase(r.rows, { log });
}

// Read all cached matches for a player in a given set. Used by the season
// aggregator + marketvalue calc; returns the TftMatchSnapshot shape the
// agents already consume.
export async function listSeasonMatches(db, puuid, setNumber) {
  const r = await db.query(
    `select match_id, set_number, placement, augments, units, traits,
            comp_cluster_key, carry_unit, carry_items, game_datetime,
            last_round, gold_left, level, total_damage
       from tft_player_match_cache
       where puuid = $1 and queue_id = $2 and set_number = $3
       order by game_datetime desc`,
    [puuid, TFT_RANKED_QUEUE, setNumber],
  );
  return r.rows.map(row => ({
    matchId: row.match_id,
    placement: row.placement,
    setNumber: row.set_number,
    augments: row.augments || [],
    comp: row.comp_cluster_key ? {
      clusterKey: row.comp_cluster_key,
      primaryTrait: row.comp_cluster_key.split('@')[0],
      primaryTraitLevel: Number(row.comp_cluster_key.split('@')[1]?.split('_')[0] || 0),
      carryUnit: row.carry_unit,
      carryItems: row.carry_items || [],
    } : undefined,
    units: row.units || [],
    gameDatetime: Number(row.game_datetime),
    lastRound: row.last_round,
    // gold_left: null for matches cached before migration 0012 — agents skip null
    goldLeft: row.gold_left,
    level: row.level,
    totalDamage: row.total_damage,
  }));
}

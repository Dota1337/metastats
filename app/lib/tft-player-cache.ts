// Server-side helper for the per-player match cache. Centralises the
// refresh logic so the /api/tft/player-stats route and the pre-warm
// crawler share the same code path — guaranteeing they cache matches in
// the same shape.

import { getRegionalRouting } from './regions';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Match-V1 detail endpoint has a 200/10s method limit. 20 in parallel per
// 1.05s wave = ~19 req/s sustained, well under the cap with room for 429
// retries that might bump us briefly.
const WAVE_CONCURRENCY = 20;
const WAVE_MS = 1050;

// 5 min = if we already refreshed for this player recently, skip the
// recent-ids check entirely and just aggregate from cache. Active players
// generate ~1 match every 30 min so 5 min is fresh enough.
const STALE_AFTER_MINUTES_DEFAULT = 5;

export interface CachedMatch {
  match_id: string;
  set_number: number;
  queue_id: number;
  game_datetime: number;
  placement: number;
  level: number;
  gold_left: number;
  players_eliminated: number;
  total_damage: number;
  last_round: number;
  units: any[];
  augments: any[];
  traits: any[];
}

interface RefreshOpts {
  riotApiKey: string;
  /** Force a refresh even if fetch_state says we checked recently. */
  force?: boolean;
  /** Override the staleness threshold (minutes). */
  maxStaleMinutes?: number;
  log?: (msg: string) => void;
}

interface RefreshResult {
  cached: number;
  newMatches: number;
  skippedFresh: boolean;
}

/**
 * Bring a player's match cache up to date with Riot. Returns the count of
 * newly-fetched matches + the total now cached. Idempotent and safe to
 * call from concurrent requests (the unique constraint on
 * (puuid, match_id) protects against double-inserts).
 */
export async function refreshPlayerCache(
  puuid: string,
  region: string,
  opts: RefreshOpts,
): Promise<RefreshResult> {
  const log = opts.log || (() => {});
  const regional = getRegionalRouting(region);
  const maxStale = opts.maxStaleMinutes ?? STALE_AFTER_MINUTES_DEFAULT;

  // 0) Skip if we refreshed this player recently and the caller didn't force.
  if (!opts.force) {
    const state = await fetchState(puuid, region);
    if (state && Date.now() - new Date(state.last_fetched_at).getTime() < maxStale * 60_000) {
      return { cached: state.total_cached_matches, newMatches: 0, skippedFresh: true };
    }
  }

  // 1) Pull the most recent 200 match-ids — we only need to diff against
  //    what's already cached, not the full history. If we find we're
  //    missing the whole list, we'll keep paginating below.
  const recentIds = await fetchIds(regional, puuid, opts.riotApiKey, 0, 200);
  if (recentIds.length === 0) {
    await upsertFetchState(puuid, region, null, 0);
    return { cached: 0, newMatches: 0, skippedFresh: false };
  }

  const cachedAlready = await listCachedIds(puuid, recentIds);
  const cachedSet = new Set(cachedAlready);
  const missingRecent = recentIds.filter(id => !cachedSet.has(id));

  // 2) If we're missing ALL the recent ones, this is a first-time fetch.
  //    Paginate up to 1000 ids total. If we're missing only some, those are
  //    just the new games since last visit — single call is enough.
  let allMissing: string[];
  if (missingRecent.length === recentIds.length) {
    // First-time fetch — get the full 1000.
    const fullIds = [...recentIds];
    for (let start = 200; start < 1000; start += 200) {
      const page = await fetchIds(regional, puuid, opts.riotApiKey, start, 200);
      if (page.length === 0) break;
      fullIds.push(...page);
      if (page.length < 200) break;
    }
    // Filter against cache one more time in case other concurrent visits
    // already populated the deeper history.
    const allCached = await listCachedIds(puuid, fullIds);
    const allCachedSet = new Set(allCached);
    allMissing = fullIds.filter(id => !allCachedSet.has(id));
    log(`[cache] first-time fill: ${fullIds.length} ids on Riot, ${allMissing.length} new`);
  } else {
    allMissing = missingRecent;
    log(`[cache] incremental: ${missingRecent.length} new since last visit`);
  }

  if (allMissing.length === 0) {
    const total = cachedSet.size + (await countCachedTotal(puuid));
    await upsertFetchState(puuid, region, recentIds[0], total);
    return { cached: total, newMatches: 0, skippedFresh: false };
  }

  // 3) Fetch + cache. Rate-limited waves so we don't trip Riot's
  //    200/10s method cap.
  const newRows: CachedMatch[] = [];
  for (let i = 0; i < allMissing.length; i += WAVE_CONCURRENCY) {
    const waveStart = Date.now();
    const wave = allMissing.slice(i, i + WAVE_CONCURRENCY);
    const results = await Promise.all(wave.map(id => fetchDetail(regional, id, opts.riotApiKey)));
    for (const m of results) {
      if (!m) continue;
      const row = extractParticipant(m, puuid);
      if (row) newRows.push(row);
    }
    const elapsed = Date.now() - waveStart;
    const remaining = WAVE_MS - elapsed;
    if (remaining > 0 && i + WAVE_CONCURRENCY < allMissing.length) {
      await new Promise(s => setTimeout(s, remaining));
    }
  }

  if (newRows.length > 0) {
    await upsertMatchRows(puuid, region, newRows);
  }

  const total = await countCachedTotal(puuid);
  await upsertFetchState(puuid, region, recentIds[0], total);

  log(`[cache] +${newRows.length} new matches, ${total} cached total`);
  return { cached: total, newMatches: newRows.length, skippedFresh: false };
}

// ── Supabase wrappers ──────────────────────────────────────────────────────

async function fetchState(puuid: string, region: string) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_fetch_state?puuid=eq.${encodeURIComponent(puuid)}&region=eq.${region}&select=*`,
    { headers: supaHeaders() },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  return rows[0] || null;
}

async function listCachedIds(puuid: string, idsToCheck: string[]): Promise<string[]> {
  if (idsToCheck.length === 0) return [];
  // PostgREST `in.(...)` filter — handles up to a few hundred values cleanly
  const inFilter = `(${idsToCheck.map(id => `"${id}"`).join(',')})`;
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_match_cache?puuid=eq.${encodeURIComponent(puuid)}&match_id=in.${encodeURIComponent(inFilter)}&select=match_id`,
    { headers: supaHeaders() },
  );
  if (!r.ok) return [];
  const rows = await r.json();
  return rows.map((row: any) => row.match_id);
}

async function countCachedTotal(puuid: string): Promise<number> {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_match_cache?puuid=eq.${encodeURIComponent(puuid)}&select=match_id`,
    { headers: { ...supaHeaders(), Prefer: 'count=exact' } },
  );
  if (!r.ok) return 0;
  const range = r.headers.get('content-range');
  if (range) {
    const m = range.match(/\/(\d+)$/);
    if (m) return parseInt(m[1], 10);
  }
  const rows = await r.json();
  return rows.length;
}

async function upsertMatchRows(puuid: string, region: string, rows: CachedMatch[]) {
  // Batch 200 per request — keeps payloads small + avoids any per-row latency
  // explosion. Conflict on (puuid, match_id) → merge to be safe under retries.
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH).map(r => ({ ...r, puuid, region }));
    const res = await fetch(
      `${SUPA_URL}/rest/v1/tft_player_match_cache?on_conflict=puuid,match_id`,
      {
        method: 'POST',
        headers: {
          ...supaHeaders(),
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      },
    );
    if (!res.ok) {
      throw new Error(`match cache upsert failed: HTTP ${res.status} ${await res.text()}`);
    }
  }
}

async function upsertFetchState(puuid: string, region: string, latestMatchId: string | null, total: number) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/tft_player_fetch_state?on_conflict=puuid,region`,
    {
      method: 'POST',
      headers: {
        ...supaHeaders(),
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify([{
        puuid, region,
        last_fetched_at: new Date().toISOString(),
        latest_match_id: latestMatchId,
        total_cached_matches: total,
      }]),
    },
  );
  if (!res.ok) {
    throw new Error(`fetch_state upsert failed: HTTP ${res.status} ${await res.text()}`);
  }
}

export async function loadCachedMatches(
  puuid: string,
  filter: { setNumber?: number | null; queueId?: number | null } = {},
): Promise<CachedMatch[]> {
  let url = `${SUPA_URL}/rest/v1/tft_player_match_cache?puuid=eq.${encodeURIComponent(puuid)}`;
  if (filter.setNumber != null) url += `&set_number=eq.${filter.setNumber}`;
  if (filter.queueId != null) url += `&queue_id=eq.${filter.queueId}`;
  url += '&select=*&order=game_datetime.desc';
  // Default PostgREST page-size is 1000; we cap higher with Range to be safe.
  const r = await fetch(url, {
    headers: { ...supaHeaders(), Range: '0-9999' },
  });
  if (!r.ok) return [];
  return r.json();
}

function supaHeaders() {
  return {
    apikey: SUPA_KEY,
    Authorization: `Bearer ${SUPA_KEY}`,
  };
}

// ── Riot wrappers ──────────────────────────────────────────────────────────

async function fetchIds(regional: string, puuid: string, apiKey: string, start: number, count: number): Promise<string[]> {
  const r = await fetch(
    `https://${regional}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}&start=${start}&api_key=${apiKey}`,
  );
  if (!r.ok) return [];
  const ids = await r.json();
  return Array.isArray(ids) ? ids : [];
}

async function fetchDetail(regional: string, matchId: string, apiKey: string, attempt = 0): Promise<any | null> {
  const r = await fetch(`https://${regional}.api.riotgames.com/tft/match/v1/matches/${matchId}?api_key=${apiKey}`);
  if (r.ok) return r.json();
  if (r.status === 429 && attempt < 2) {
    const retryAfter = parseInt(r.headers.get('retry-after') || '2', 10);
    await new Promise(s => setTimeout(s, retryAfter * 1000 + 200));
    return fetchDetail(regional, matchId, apiKey, attempt + 1);
  }
  return null;
}

// Extract the participant-level row we want to cache. Returns null if the
// puuid wasn't in the match (shouldn't happen, but defensive).
function extractParticipant(rawMatch: any, puuid: string): CachedMatch | null {
  const info = rawMatch?.info;
  if (!info?.participants) return null;
  const me = info.participants.find((p: any) => p.puuid === puuid);
  if (!me) return null;
  return {
    match_id: rawMatch.metadata?.match_id,
    set_number: info.tft_set_number ?? 0,
    queue_id: info.queue_id ?? info.queueId ?? 0,
    game_datetime: info.game_datetime ?? 0,
    placement: me.placement ?? 9,
    level: me.level ?? 0,
    gold_left: me.gold_left ?? 0,
    players_eliminated: me.players_eliminated ?? 0,
    total_damage: me.total_damage_to_players ?? 0,
    last_round: me.last_round ?? 0,
    units: (me.units || []).map((u: any) => ({
      character_id: u.character_id,
      tier: u.tier ?? 1,
      rarity: u.rarity ?? 0,
      items: u.itemNames || [],
    })),
    augments: Array.isArray(me.augments) ? me.augments : [],
    traits: (me.traits || []).filter((t: any) => (t.style ?? 0) > 0).map((t: any) => ({
      name: t.name,
      tier_current: t.tier_current ?? 0,
      style: t.style ?? 0,
    })),
  };
}

#!/usr/bin/env node
/**
 * Backfill placement + real Riot match-id into tft_position_observations
 * rows that were submitted by the Overwolf companion under a synthetic
 * `LIVE_<timestamp>_<handle>` match-id.
 *
 * Flow per pending observer:
 *   1. Pull all distinct LIVE_ match-ids for this observer.
 *   2. Resolve gameName#tagLine → PUUID via account-v1 (cache in memory).
 *   3. Pull last 20 TFT match-ids via tft/match/v1/matches/by-puuid.
 *   4. For each LIVE_ id, take the timestamp embedded in the id (5th
 *      slice element after splitting on '_'), match it against the
 *      Riot match-start times within ±3 minutes.
 *   5. Update tft_position_observations: SET match_id = <real>,
 *      observer_placement = <N> WHERE match_id = <LIVE_id>.
 *
 * Runs idempotent — already-resolved rows (where match_id no longer
 * starts with LIVE_) are skipped automatically.
 *
 * Designed for a 10-minute systemd timer on Hetzner.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RIOT_KEY = process.env.RIOT_API_KEY_TFT || process.env.RIOT_API_KEY;
if (!SUPA_URL || !SUPA_KEY || !RIOT_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RIOT_API_KEY_TFT');
  process.exit(1);
}

// Riot's game_datetime marks "all players loaded in", our LIVE seed is
// the moment the client first saw live_client_data — drift of several
// minutes is normal. 15 min window is wide enough to absorb it while
// still being narrow enough to avoid claiming the wrong match if a
// user plays back-to-back.
const TS_WINDOW_MS = 15 * 60 * 1000;
const REGION_TO_CLUSTER = { euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
                            na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
                            kr: 'asia', jp1: 'asia',
                            oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea' };

const sb = (path, init = {}) => fetch(`${SUPA_URL}${path}`, {
  ...init,
  headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, ...(init.headers || {}) },
});

async function riotFetch(url, label) {
  const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_KEY } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`riot ${label} ${res.status}: ${body.slice(0, 100)}`);
  }
  return res.json();
}

// Cache PUUID lookups for the run.
const puuidCache = new Map();
async function resolvePuuid(handle, cluster) {
  if (puuidCache.has(handle)) return puuidCache.get(handle);
  const [gameName, tagLine] = handle.split('#');
  if (!gameName || !tagLine) return null;
  const account = await riotFetch(
    `https://${cluster}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`,
    `account-v1 ${handle}`,
  );
  const puuid = account.puuid;
  puuidCache.set(handle, puuid);
  return puuid;
}

async function listRecentTftMatchIds(puuid, cluster, count = 20) {
  return riotFetch(
    `https://${cluster}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}`,
    `match-ids-by-puuid ${puuid.slice(0, 8)}`,
  );
}

async function getMatchDetail(matchId, cluster) {
  return riotFetch(
    `https://${cluster}.api.riotgames.com/tft/match/v1/matches/${matchId}`,
    `match-detail ${matchId}`,
  );
}

// Parse the timestamp embedded in our synth match-id.
//   LIVE_<seedMs>_<handlePrefix>
function liveIdToTimestampMs(liveId) {
  const m = /^LIVE_(\d+)_/.exec(liveId);
  return m ? Number(m[1]) : null;
}

async function getPendingObservers() {
  // Group: handle, region, distinct match_id list
  const res = await sb(
    '/rest/v1/tft_position_observations?select=match_id,observer_puuid,region&match_id=like.LIVE_*',
  );
  const rows = await res.json();
  const byObserver = new Map();
  for (const r of rows) {
    if (!r.observer_puuid || !r.region) continue;
    const key = r.observer_puuid + '||' + r.region;
    let e = byObserver.get(key);
    if (!e) { e = { handle: r.observer_puuid, region: r.region, ids: new Set() }; byObserver.set(key, e); }
    e.ids.add(r.match_id);
  }
  return [...byObserver.values()];
}

async function backfillObserver({ handle, region, ids }) {
  const cluster = REGION_TO_CLUSTER[region];
  if (!cluster) { console.warn(`skip ${handle}: unknown region ${region}`); return; }
  const puuid = await resolvePuuid(handle, cluster);
  if (!puuid) { console.warn(`skip ${handle}: cannot resolve PUUID`); return; }

  const matchIds = await listRecentTftMatchIds(puuid, cluster, 30);
  console.log(`${handle} (${region}) — ${ids.size} LIVE-ids vs ${matchIds.length} riot matches`);

  // Fetch detail for each candidate match (rate-limit friendly: serial).
  const matchDetails = [];
  for (const m of matchIds) {
    try {
      const detail = await getMatchDetail(m, cluster);
      matchDetails.push(detail);
    } catch (e) {
      console.warn(`  match ${m} detail failed: ${e.message}`);
    }
  }

  for (const liveId of ids) {
    const tsMs = liveIdToTimestampMs(liveId);
    if (tsMs == null) { console.warn(`  ${liveId}: cannot parse timestamp`); continue; }

    let best = null;
    for (const md of matchDetails) {
      const startMs = md.info && (md.info.game_datetime || md.info.gameStartTimestamp || md.info.game_start_time);
      if (!startMs) continue;
      const delta = Math.abs(startMs - tsMs);
      if (delta < TS_WINDOW_MS && (!best || delta < best.delta)) {
        best = { match: md, delta };
      }
    }

    if (!best) { console.log(`  ${liveId}: no riot match within ${TS_WINDOW_MS / 60000}min`); continue; }

    const md = best.match;
    const riotId = md.metadata.match_id;
    const participant = md.info.participants.find(p => p.puuid === puuid);
    const placement = participant ? participant.placement : null;

    console.log(`  ${liveId} → ${riotId} (placement=${placement}, delta=${Math.round(best.delta / 1000)}s)`);

    // Update rows. We can't change the unique-constrained match_id in a
    // single PATCH if it would collide — but the unique index is on
    // (match_id, observer_puuid, kind, cell, unit, round) so collisions
    // are extremely unlikely. PostgREST PATCH handles it.
    const upd = await sb(
      `/rest/v1/tft_position_observations?match_id=eq.${encodeURIComponent(liveId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ match_id: riotId, observer_placement: placement }),
      },
    );
    if (!upd.ok) {
      const errBody = await upd.text();
      console.warn(`    update failed: ${upd.status} ${errBody.slice(0, 120)}`);
    }
  }
}

async function main() {
  const observers = await getPendingObservers();
  if (observers.length === 0) {
    console.log('no pending LIVE_ rows to backfill — done.');
    return;
  }
  console.log(`backfilling for ${observers.length} observer(s)`);
  for (const o of observers) {
    try {
      await backfillObserver(o);
    } catch (e) {
      console.error(`observer ${o.handle} failed: ${e.message}`);
    }
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

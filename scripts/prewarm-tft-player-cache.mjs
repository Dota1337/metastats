#!/usr/bin/env node
// Pre-warms the tft_player_match_cache by walking every Master+ + Diamond-I
// player in a given region and pulling their match history into Supabase.
// First-time bootstrap of a player takes ~50s due to Riot's match-v1 200/10s
// detail-method limit; daily incremental updates take ~1-5s per player.
//
// Usage:
//   node scripts/prewarm-tft-player-cache.mjs --region euw1
//   node scripts/prewarm-tft-player-cache.mjs --region kr --scope apex
//   node scripts/prewarm-tft-player-cache.mjs --region euw1 --scope diamond_plus
//   node scripts/prewarm-tft-player-cache.mjs --region euw1 --top-diamond 1000
//
// Scopes:
//   apex          = Challenger + Grandmaster + Master (default ≈ 1500-3000/region)
//   diamond_plus  = apex + Diamond I (default ≈ 4000-8000/region, slow!)
//
// Run via the daily GHA workflow — does not write JSON files, only Supabase.

import { createRiotClient } from './lib/riot-client.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

const REGION = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const SCOPE = (arg('--scope', 'apex') || 'apex').toLowerCase();
const TOP_DIAMOND = Number(arg('--top-diamond', '1000'));
const SLEEP_BETWEEN_PLAYERS_MS = Number(arg('--sleep-ms', '50'));
const LIMIT = Number(arg('--limit', '0'));   // 0 = no cap (process every player)

const REGIONAL = ({
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
})[REGION] || 'europe';

const API_KEY = process.env.RIOT_API_KEY_TFT;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!API_KEY) { console.error('RIOT_API_KEY_TFT required'); process.exit(1); }
if (!SUPA_URL || !SUPA_KEY) { console.error('Supabase env vars required'); process.exit(1); }

// Production-key match-v1 method limit is 200/10s per regional routing.
// 18 in parallel per 1s wave = 18 req/s steady, leaves headroom for the
// occasional 429.
const riot = createRiotClient({
  shortWindowRequests: 180,
  shortWindowMs: 10_500,
  longWindowRequests: 28000,
  longWindowMs: 605_000,
});

async function fetchApex(tier) {
  const r = await riot.fetch(`https://${REGION}.api.riotgames.com/tft/league/v1/${tier}?api_key=${API_KEY}`);
  if (!r.ok) return [];
  const data = await r.json();
  return (data.entries || []).map(e => ({ puuid: e.puuid, lp: e.leaguePoints, tier: tier.toUpperCase() }));
}

async function fetchDiamondI(limit) {
  // Diamond is 4 divisions; Division I is the top of the tier. Riot returns
  // 200 entries per page; the first 5 pages cover the active players easily.
  const out = [];
  for (let page = 1; page <= 25 && out.length < limit; page++) {
    const r = await riot.fetch(
      `https://${REGION}.api.riotgames.com/tft/league/v1/entries/DIAMOND/I?page=${page}&api_key=${API_KEY}`,
    );
    if (!r.ok) break;
    const batch = await r.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    for (const e of batch) {
      if (e.puuid) out.push({ puuid: e.puuid, lp: e.leaguePoints, tier: 'DIAMOND_I' });
      if (out.length >= limit) break;
    }
    if (batch.length < 200) break;
  }
  return out;
}

async function discoverPlayers() {
  const all = [];
  console.log(`[discovery] ${REGION} scope=${SCOPE}`);
  for (const tier of ['challenger', 'grandmaster', 'master']) {
    const entries = await fetchApex(tier);
    console.log(`  ${tier}: ${entries.length}`);
    all.push(...entries);
  }
  if (SCOPE === 'diamond_plus') {
    const d1 = await fetchDiamondI(TOP_DIAMOND);
    console.log(`  diamond_i: ${d1.length} (top ${TOP_DIAMOND})`);
    all.push(...d1);
  }
  // Dedupe — a player can show up in both league + entries lists during
  // promotions / demotions across the snapshot boundaries.
  const seen = new Set();
  return all.filter(p => p.puuid && !seen.has(p.puuid) && seen.add(p.puuid));
}

// Inline the cache refresh logic — we'd `import` from the Next.js lib but
// the project mixes ESM + TS and that's a build-time pain. The shape is
// the same as app/lib/tft-player-cache.ts; if you change one, update the
// other (or extract to a shared package later).

const WAVE_CONCURRENCY = 20;
const WAVE_MS = 1050;

async function fetchIds(puuid, start, count) {
  const r = await riot.fetch(
    `https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/by-puuid/${puuid}/ids?count=${count}&start=${start}&api_key=${API_KEY}`,
  );
  if (!r.ok) return [];
  const ids = await r.json();
  return Array.isArray(ids) ? ids : [];
}

async function fetchDetail(matchId, attempt = 0) {
  const r = await riot.fetch(`https://${REGIONAL}.api.riotgames.com/tft/match/v1/matches/${matchId}?api_key=${API_KEY}`);
  if (r.ok) return r.json();
  if (r.status === 429 && attempt < 2) {
    const retryAfter = parseInt(r.headers.get('retry-after') || '2', 10);
    await sleep(retryAfter * 1000 + 200);
    return fetchDetail(matchId, attempt + 1);
  }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function supaSelect(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

async function supaUpsert(table, rows, conflict) {
  if (rows.length === 0) return;
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const r = await fetch(`${SUPA_URL}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`upsert ${table} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  }
}

function extractParticipant(rawMatch, puuid) {
  const info = rawMatch?.info;
  if (!info?.participants) return null;
  const me = info.participants.find(p => p.puuid === puuid);
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
    units: (me.units || []).map(u => ({
      character_id: u.character_id,
      tier: u.tier ?? 1,
      rarity: u.rarity ?? 0,
      items: u.itemNames || [],
    })),
    augments: Array.isArray(me.augments) ? me.augments : [],
    traits: (me.traits || []).filter(t => (t.style ?? 0) > 0).map(t => ({
      name: t.name,
      tier_current: t.tier_current ?? 0,
      style: t.style ?? 0,
    })),
  };
}

async function refreshPlayer(puuid) {
  // Recent 200 ids — diff against cache
  const recentIds = await fetchIds(puuid, 0, 200);
  if (recentIds.length === 0) return { newMatches: 0, total: 0 };

  const cachedRows = await supaSelect(
    `tft_player_match_cache?puuid=eq.${encodeURIComponent(puuid)}&match_id=in.(${recentIds.map(id => `"${id}"`).join(',')})&select=match_id`,
  );
  const cachedSet = new Set(cachedRows.map(r => r.match_id));
  const missingRecent = recentIds.filter(id => !cachedSet.has(id));

  // First-time: pull the full 1000 ids
  let missing;
  if (missingRecent.length === recentIds.length) {
    const fullIds = [...recentIds];
    for (let start = 200; start < 1000; start += 200) {
      const page = await fetchIds(puuid, start, 200);
      if (page.length === 0) break;
      fullIds.push(...page);
      if (page.length < 200) break;
    }
    const cachedAll = await supaSelect(
      `tft_player_match_cache?puuid=eq.${encodeURIComponent(puuid)}&match_id=in.(${fullIds.map(id => `"${id}"`).join(',')})&select=match_id`,
    );
    const cachedAllSet = new Set(cachedAll.map(r => r.match_id));
    missing = fullIds.filter(id => !cachedAllSet.has(id));
  } else {
    missing = missingRecent;
  }

  if (missing.length === 0) return { newMatches: 0, total: cachedRows.length };

  // Fetch + cache new matches
  const newRows = [];
  for (let i = 0; i < missing.length; i += WAVE_CONCURRENCY) {
    const waveStart = Date.now();
    const wave = missing.slice(i, i + WAVE_CONCURRENCY);
    const results = await Promise.all(wave.map(id => fetchDetail(id)));
    for (const m of results) {
      if (!m) continue;
      const row = extractParticipant(m, puuid);
      if (row) newRows.push({ ...row, puuid, region: REGION });
    }
    const elapsed = Date.now() - waveStart;
    const remaining = WAVE_MS - elapsed;
    if (remaining > 0 && i + WAVE_CONCURRENCY < missing.length) await sleep(remaining);
  }
  if (newRows.length > 0) await supaUpsert('tft_player_match_cache', newRows, 'puuid,match_id');

  await supaUpsert('tft_player_fetch_state', [{
    puuid, region: REGION,
    last_fetched_at: new Date().toISOString(),
    latest_match_id: recentIds[0],
    total_cached_matches: cachedRows.length + newRows.length,
  }], 'puuid,region');

  return { newMatches: newRows.length, total: cachedRows.length + newRows.length };
}

async function main() {
  const t0 = Date.now();
  console.log(`=== TFT Player Cache Pre-Warm ${REGION} (regional ${REGIONAL}) scope=${SCOPE} ===`);

  let players = await discoverPlayers();
  if (LIMIT > 0) players = players.slice(0, LIMIT);
  console.log(`\n${players.length} unique players to refresh${LIMIT > 0 ? ` (limited to top ${LIMIT})` : ''}\n`);

  let totalNew = 0;
  let totalCached = 0;
  let errors = 0;
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    try {
      const result = await refreshPlayer(p.puuid);
      totalNew += result.newMatches;
      totalCached += result.total;
      if ((i + 1) % 50 === 0 || i === players.length - 1) {
        const elapsed = Math.round((Date.now() - t0) / 1000);
        const rate = (i + 1) / elapsed;
        const eta = Math.round((players.length - i - 1) / rate);
        console.log(`  ${i + 1}/${players.length} players · +${totalNew} new matches · ${elapsed}s elapsed · ETA ${eta}s`);
      }
    } catch (e) {
      errors++;
      if (errors < 10) console.log(`  ERR ${p.puuid.slice(0, 12)}: ${e.message}`);
    }
    if (SLEEP_BETWEEN_PLAYERS_MS > 0) await sleep(SLEEP_BETWEEN_PLAYERS_MS);
  }

  const elapsed = Math.round((Date.now() - t0) / 1000);
  console.log(`\n=== Done: ${players.length} players, +${totalNew} new matches, ${errors} errors, ${elapsed}s ===`);
}

main().catch(err => { console.error('FAIL:', err); process.exit(1); });

#!/usr/bin/env node
/**
 * Lookup für jeden Pro den aktuellen TFT-Rank via Riot League-V1 API. Schreibt
 * active_rank_tier + active_rank_lp + active_rank_checked_at. Treibt zwei
 * Klassifikations-Signale:
 *
 *   1) streamer-Klassifikation braucht "Master+" als Threshold. Ohne Live-Rank
 *      ist jeder Streamer per Definition kein "Streamer-Pro".
 *   2) historic-vs-inactive: ein Pro der seit Set 10 nichts gespielt hat, hat
 *      auch keinen Rank — fällt automatisch in inactive.
 *
 * Per-Pro: 1 API-Call an /tft/league/v1/by-puuid/{puuid}. Rate-Limit
 * via riot-client (180 req / 10.5s). Bei ~400 Pros → ~24s Gesamtlauf.
 *
 * Usage:
 *   node scripts/validate-tft-pro-rank.mjs                 # full
 *   node scripts/validate-tft-pro-rank.mjs --limit 50      # smoke
 *   node scripts/validate-tft-pro-rank.mjs --no-supabase   # dry-run
 *   node scripts/validate-tft-pro-rank.mjs --stale-only    # nur Pros mit
 *                                                            active_rank_checked_at >24h
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const LIMIT = parseInt(arg('--limit', '0'), 10);
const SKIP_SUPABASE = hasFlag('--no-supabase');
const STALE_ONLY = hasFlag('--stale-only');
const VERBOSE = hasFlag('--verbose');

function loadEnv() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!line.includes('=') || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    const k = line.slice(0, i).trim();
    const v = line.slice(i + 1).trim();
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv();

const RIOT_KEY = process.env.RIOT_API_KEY_TFT;
if (!RIOT_KEY) { console.error('RIOT_API_KEY_TFT required'); process.exit(1); }

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Riot Production-Key TFT spec: 500/10s + 30000/600s app-wide. Per-method
// (League-V1 by-puuid) is ~270/10s — we cap below that to leave headroom
// for the Hetzner crawler which runs on the same key.
const REQUEST_DELAY_MS = 80;
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

const TIER_TO_BUCKET = {
  CHALLENGER: 'challenger',
  GRANDMASTER: 'grandmaster',
  MASTER: 'master',
  DIAMOND: 'diamond',
  EMERALD: 'sub_diamond',
  PLATINUM: 'sub_diamond',
  GOLD: 'sub_diamond',
  SILVER: 'sub_diamond',
  BRONZE: 'sub_diamond',
  IRON: 'sub_diamond',
};

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'POST' || init.method === 'PATCH' ? 'return=minimal' : '',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${path} HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : null;
}

// Riot uses platform routing for League-V1 (region-specific host, e.g. kr,
// euw1, na1 etc.). The pro's stored region is exactly that platform code.
async function fetchTftRank(region, puuid) {
  const url = `https://${region}.api.riotgames.com/tft/league/v1/by-puuid/${puuid}`;
  let backoff = 5_000;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'X-Riot-Token': RIOT_KEY } });
    if (res.ok) return res.json();
    if (res.status === 404) return [];   // pro has no ranked games this set
    if (res.status === 429 && attempt < 3) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 0;
      await sleep(Math.max(retryAfter * 1000, backoff));
      backoff *= 2; continue;
    }
    throw new Error(`Riot ${region}/${puuid.slice(0,8)} HTTP ${res.status}`);
  }
  throw new Error('Riot 429 after 4 attempts');
}

async function main() {
  const runId = randomUUID();
  console.log(`=== TFT Pro Rank Validator — run ${runId} ===`);

  let pros = await sb('tft_pro_players?select=puuid,pro_name,region,active_rank_checked_at,active_rank_tier');
  console.log(`Loaded ${pros.length} pros`);

  if (STALE_ONLY) {
    const cutoff = Date.now() - STALE_THRESHOLD_MS;
    pros = pros.filter(p => !p.active_rank_checked_at || new Date(p.active_rank_checked_at).getTime() < cutoff);
    console.log(`Stale-only filter: ${pros.length} pros need refresh`);
  }
  if (LIMIT > 0) pros = pros.slice(0, LIMIT);

  let updated = 0, skipped = 0, masterPlus = 0, ranked = 0;
  for (let i = 0; i < pros.length; i++) {
    const p = pros[i];
    if (!p.puuid || p.puuid === 'DRY-RUN') { skipped++; continue; }
    try {
      const entries = await fetchTftRank(p.region, p.puuid);
      // Riot returns an array of league entries per queue. We pick the
      // Ranked-TFT (RANKED_TFT) entry — Hyperroll/Doubleup are alternative
      // queues and don't reflect "competitive" rank for our purposes.
      const ranked_entry = (entries || []).find(e => e.queueType === 'RANKED_TFT');
      let tier = null, lp = null;
      if (ranked_entry) {
        tier = TIER_TO_BUCKET[ranked_entry.tier] || 'sub_diamond';
        lp = Number(ranked_entry.leaguePoints) || 0;
        ranked++;
        if (['master', 'grandmaster', 'challenger'].includes(tier)) masterPlus++;
      }
      if (VERBOSE) console.log(`  ${p.pro_name.padEnd(25)} ${p.region.padEnd(5)} ${tier || '—'}${lp != null ? ' ' + lp + 'LP' : ''}`);
      if (!SKIP_SUPABASE) {
        await sb(`tft_pro_players?puuid=eq.${encodeURIComponent(p.puuid)}`, {
          method: 'PATCH',
          body: JSON.stringify({
            active_rank_tier: tier,
            active_rank_lp: lp,
            active_rank_checked_at: new Date().toISOString(),
          }),
        });
      }
      updated++;
    } catch (e) {
      skipped++;
      if (VERBOSE) console.warn(`  [skip] ${p.pro_name}: ${e.message}`);
    }
    if ((i + 1) % 50 === 0) console.log(`  ${i+1}/${pros.length}  updated=${updated} ranked=${ranked} master+=${masterPlus} skipped=${skipped}`);
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`\nDone. updated=${updated} ranked=${ranked} master+=${masterPlus} skipped=${skipped}`);
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });

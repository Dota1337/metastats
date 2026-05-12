#!/usr/bin/env node
/**
 * Crawls TFT pro players from Liquipedia and upserts into Supabase.
 *
 * Pipeline:
 *   1) Liquipedia Category:Players  → list of pro page titles
 *   2) For each title: action=parse&prop=wikitext → parse Infobox player
 *      template, extract id / lolchess / team / country / socials
 *   3) Map lolchess region code ("na", "euw", "kr", …) to platform routing
 *   4) Resolve Riot ID → PUUID via account-v1
 *   5) Upsert into tft_pro_players
 *
 * The manual streamer allowlist (./tft-pro-streamers.json — created on
 * demand) supplements Liquipedia for content creators without wiki pages.
 *
 * Usage:
 *   node scripts/crawl-tft-pro-players.mjs                 # full run
 *   node scripts/crawl-tft-pro-players.mjs --limit 20      # smoke-test
 *   node scripts/crawl-tft-pro-players.mjs --no-supabase   # dry run
 *   node scripts/crawl-tft-pro-players.mjs --skip-liquipedia  # only streamers list
 *
 * Liquipedia rate limit: their ToU asks for 2s between requests. We honor
 * that strictly; the full run takes ~15-25 min for ~400 player pages.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const LIMIT = parseInt(arg('--limit', '0'), 10);
const SKIP_SUPABASE = hasFlag('--no-supabase');
const SKIP_LIQUIPEDIA = hasFlag('--skip-liquipedia');
const VERBOSE = hasFlag('--verbose');

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
// Liquipedia ToU: "wait 2 seconds between requests, identify yourself".
const LIQUIPEDIA_DELAY_MS = 2100;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

// lolchess.gg region codes → Riot platform routing values.
// Liquipedia stores `lolchess=na/setsuko1-NA1` and similar; only the prefix
// (before the first '/') is the region. NA1/EUW1 suffixes are part of the
// Riot-ID tagline which we keep separately.
const LOLCHESS_REGION_MAP = {
  na: 'na1', euw: 'euw1', eune: 'eun1', kr: 'kr', jp: 'jp1',
  br: 'br1', lan: 'la1', las: 'la2', oce: 'oc1', tr: 'tr1',
  ru: 'ru', vn: 'vn2', sg: 'sg2', tw: 'tw2', th: 'th2', ph: 'ph2',
  me: 'me1',
};
const REGIONAL = {
  euw1: 'europe', eun1: 'europe', tr1: 'europe', ru: 'europe', me1: 'europe',
  na1: 'americas', br1: 'americas', la1: 'americas', la2: 'americas',
  kr: 'asia', jp1: 'asia',
  oc1: 'sea', ph2: 'sea', sg2: 'sea', th2: 'sea', tw2: 'sea', vn2: 'sea',
};

// ─────────────────────────────────────────────────────────────────────────────
// env

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
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Liquipedia helpers

async function liquipediaJson(params) {
  const url = `${LIQUIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      // Liquipedia requires gzip on all API requests.
      'Accept-Encoding': 'gzip, deflate',
    },
  });
  if (!res.ok) throw new Error(`Liquipedia HTTP ${res.status}: ${url.slice(0, 200)}`);
  return res.json();
}

async function fetchAllPlayerTitles() {
  const out = [];
  let cmcontinue = null;
  do {
    const params = {
      action: 'query', list: 'categorymembers',
      cmtitle: 'Category:Players', cmlimit: '500',
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const j = await liquipediaJson(params);
    for (const m of j.query?.categorymembers || []) {
      if (m.ns === 0 && m.title) out.push(m.title);
    }
    cmcontinue = j.continue?.cmcontinue || null;
    if (cmcontinue) await sleep(LIQUIPEDIA_DELAY_MS);
  } while (cmcontinue);
  return out;
}

async function fetchPlayerWikitext(title) {
  const j = await liquipediaJson({
    action: 'parse', page: title, prop: 'wikitext',
  });
  return j.parse?.wikitext?.['*'] || '';
}

// Lazy-tolerant parser: walks the {{Infobox player |k=v |...}} template and
// returns a flat key/value map. Multi-line values are joined with spaces.
function parseInfobox(wikitext) {
  const startMarker = '{{Infobox player';
  const start = wikitext.indexOf(startMarker);
  if (start < 0) return null;
  // Find the matching closing braces — depth-tracked because nested
  // templates inside the infobox (history={{THA}}, etc.) would otherwise
  // confuse a naive regex.
  let depth = 0;
  let i = start;
  while (i < wikitext.length) {
    if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
    if (wikitext[i] === '}' && wikitext[i + 1] === '}') { depth--; i += 2; if (depth === 0) break; continue; }
    i++;
  }
  if (depth !== 0) return null;
  const body = wikitext.slice(start + startMarker.length, i - 2);
  // Split on top-level "|key=val" pairs. Depth-track nested templates so we
  // don't split inside them.
  const fields = {};
  depth = 0;
  let buf = '';
  for (let j = 0; j < body.length; j++) {
    const c = body[j], n = body[j + 1];
    if (c === '{' && n === '{') { depth++; buf += c; continue; }
    if (c === '}' && n === '}') { depth--; buf += c; continue; }
    if (c === '|' && depth === 0) {
      ingest(fields, buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  ingest(fields, buf);
  return fields;
}
function ingest(map, raw) {
  const eq = raw.indexOf('=');
  if (eq < 0) return;
  const k = raw.slice(0, eq).trim();
  const v = raw.slice(eq + 1).trim();
  if (k) map[k] = v;
}

// Parse `lolchess=na/setsuko1-NA1` style fields into { region, riotId }.
// Returns null if the field doesn't carry a recognizable region prefix.
function parseLolchess(field) {
  if (!field) return null;
  const m = /^([a-zA-Z]+)\/(.+)$/.exec(field.trim());
  if (!m) return null;
  const regionCode = m[1].toLowerCase();
  const region = LOLCHESS_REGION_MAP[regionCode];
  if (!region) return null;
  // Rest is the Riot-ID (game name + tagline). lolchess writes them as
  // "name-TAG"; we split on the LAST hyphen so names containing hyphens
  // (rare but real) don't get butchered.
  const rest = m[2];
  const hyphen = rest.lastIndexOf('-');
  if (hyphen < 0) {
    // Fall back to the canonical region suffix as tagline.
    return { region, gameName: rest, tagLine: regionCode.toUpperCase() };
  }
  return {
    region,
    gameName: rest.slice(0, hyphen),
    tagLine: rest.slice(hyphen + 1),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Riot validation

async function resolvePuuid(region, gameName, tagLine) {
  const regional = REGIONAL[region];
  if (!regional) return null;
  const url = `https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${RIOT_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const j = await res.json();
  return j.puuid || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase upsert

async function upsertPros(rows) {
  if (rows.length === 0) return;
  if (SKIP_SUPABASE) {
    console.log(`  [supabase] --no-supabase set, skipping ${rows.length} rows`);
    return;
  }
  const url = `${SUPA_URL}/rest/v1/tft_pro_players?on_conflict=puuid`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase upsert failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  console.log(`  [supabase] upserted ${rows.length} rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Streamer allowlist (manual)
// Plain JSON file at scripts/lib/tft-pro-streamers.json. Loaded if present.
// Format: [{ proName, region, riotId: "Name#TAG", role, country?, twitch?, twitter? }]

function loadStreamerAllowlist() {
  const p = resolve(process.cwd(), 'scripts', 'lib', 'tft-pro-streamers.json');
  if (!existsSync(p)) return [];
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (e) { console.warn('  [streamers] failed to parse allowlist:', e.message); return []; }
}

// ─────────────────────────────────────────────────────────────────────────────
// main

async function main() {
  const t0 = Date.now();
  console.log('=== TFT Pro Player Crawler ===\n');

  // 1) Discover titles
  let titles = [];
  if (!SKIP_LIQUIPEDIA) {
    console.log('[1/3] Fetching Liquipedia Category:Players …');
    titles = await fetchAllPlayerTitles();
    if (LIMIT > 0) titles = titles.slice(0, LIMIT);
    console.log(`       ${titles.length} player pages\n`);
  }

  // 2) Parse + resolve
  const rows = [];
  let parsed = 0, resolved = 0, skipped = 0;
  for (const title of titles) {
    await sleep(LIQUIPEDIA_DELAY_MS);
    let wikitext;
    try { wikitext = await fetchPlayerWikitext(title); }
    catch (e) { if (VERBOSE) console.warn(`  [skip] ${title}: ${e.message}`); skipped++; continue; }
    const info = parseInfobox(wikitext);
    if (!info) { skipped++; continue; }
    parsed++;
    const idField = info.id || info.ID || info.player;
    const accountSpec = parseLolchess(info.lolchess) || parseLolchess(info.lolchess2);
    if (!idField || !accountSpec) { skipped++; continue; }
    // Resolve via Riot
    const puuid = await resolvePuuid(accountSpec.region, accountSpec.gameName, accountSpec.tagLine);
    if (!puuid) { skipped++; continue; }
    resolved++;
    rows.push({
      puuid,
      pro_name: idField,
      real_name: info.name || null,
      region: accountSpec.region,
      riot_id: `${accountSpec.gameName}#${accountSpec.tagLine}`,
      team: info.team || null,
      role: info.role || 'Player',
      country: info.country || null,
      source: 'liquipedia',
      source_page: title,
      twitch_handle: info.twitch || null,
      twitter_handle: info.twitter || null,
      youtube_handle: info.youtube || null,
      instagram_handle: info.instagram || null,
      tournament_results: [],
      last_validated_at: new Date().toISOString(),
    });
    if (rows.length % 10 === 0) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`  ${rows.length}/${titles.length}  parsed=${parsed} resolved=${resolved} skipped=${skipped}  ${elapsed}s`);
    }
  }

  // 3) Manual streamer allowlist
  console.log('\n[2/3] Streamer allowlist …');
  const streamers = loadStreamerAllowlist();
  for (const s of streamers) {
    if (!s.region || !s.riotId) continue;
    const [gameName, tagLine] = s.riotId.split('#');
    if (!gameName) continue;
    const puuid = await resolvePuuid(s.region, gameName, tagLine || s.region.replace(/\d+$/, '').toUpperCase());
    if (!puuid) { console.warn(`  [streamers] could not resolve ${s.riotId}`); continue; }
    rows.push({
      puuid,
      pro_name: s.proName || gameName,
      real_name: s.realName || null,
      region: s.region,
      riot_id: s.riotId,
      team: s.team || null,
      role: s.role || 'Streamer',
      country: s.country || null,
      source: 'manual',
      source_page: null,
      twitch_handle: s.twitch || null,
      twitter_handle: s.twitter || null,
      youtube_handle: s.youtube || null,
      instagram_handle: s.instagram || null,
      tournament_results: [],
      last_validated_at: new Date().toISOString(),
    });
  }
  console.log(`       ${streamers.length} streamer entries, ${rows.length} total after merge`);

  // De-dup by puuid (Liquipedia + streamer list may overlap)
  const seen = new Set();
  const unique = [];
  for (const r of rows) {
    if (seen.has(r.puuid)) continue;
    seen.add(r.puuid);
    unique.push(r);
  }
  console.log(`       deduped: ${unique.length}`);

  // 4) Upsert
  console.log('\n[3/3] Writing to Supabase …');
  await upsertPros(unique);

  const total = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone. ${unique.length} pros in ${total}s.`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

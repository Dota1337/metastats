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
// Targeted mode (W2, 2026-07-04): crawl explicit page titles instead of
// Category:Players — the insert path for TPC-roster members that
// crawl-tft-tpc-roster.mjs logged as "not in tft_pro_players" (severity 3).
// Reuses the exact parse→lolchess→PUUID chain (no second implementation).
const PAGES_OVERRIDE = arg('--pages', '');
// Legacy mode: walk Category:Players + action=parse per page (~400 requests).
// Default is now Cargo (1-2 requests, ~400× less traffic, avoids IP bans).
const LEGACY = hasFlag('--legacy');

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
// Liquipedia ToU: "wait 2 seconds between requests, identify yourself".
const LIQUIPEDIA_DELAY_MS = 2100;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

// lolchess.gg region codes → Riot platform routing values.
// Liquipedia stores `lolchess=na/setsuko1-NA1` and similar; only the prefix
// (before the first '/') is the region. NA1/EUW1 suffixes are part of the
// Riot-ID tagline which we keep separately.
//
// `cn` is DELIBERATELY absent from this map (and from REGIONAL_ROUTING):
// Riot's public API does not cover the Chinese server, so CN pros can never
// resolve to a PUUID. Since migration 0050 (user decision 2026-07-04) they are
// ingested anyway — as rows with puuid/riot_id NULL and region='cn' (the
// non-Riot marker; invariant: region='cn' implies puuid IS NULL, so every
// Riot-API consumer stays protected by its existing puuid guard). The CN
// fallback hooks into the no-account skip paths below. Do NOT add a
// synthetic-PUUID hack: every Riot-API consumer would need a guard, a
// recurring-bug class.
const LOLCHESS_REGION_MAP = {
  na: 'na1', euw: 'euw1', eune: 'eun1', kr: 'kr', jp: 'jp1',
  br: 'br1', lan: 'la1', las: 'la2', oce: 'oc1', tr: 'tr1',
  ru: 'ru', vn: 'vn2', sg: 'sg2', tw: 'tw2', th: 'th2', ph: 'ph2',
  me: 'me1',
};
import { REGIONAL_ROUTING as REGIONAL } from './lib/regional-routing.mjs';

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

// Liquipedia API access — all calls go through the shared helper
// (scripts/lib/liquipedia-tft.mjs). That gives us a cross-process rate-limit
// lock (so subprocess boundaries don't burst-fire) + ETag-based HTTP cache
// (so repeated wikitext fetches in a daily/weekly cron are mostly free).
import {
  liquipediaJson,
  liquipediaCategoryMembers,
  liquipediaWikitextsBatch,
} from './lib/liquipedia-tft.mjs';

async function fetchAllPlayerTitles() {
  // Shared helper paginates Category:Players transparently + respects the
  // global rate-limit gate.
  const titles = await liquipediaCategoryMembers('Players');
  return titles.filter(Boolean);
}

async function fetchPlayerWikitext(title) {
  const j = await liquipediaJson({
    action: 'parse', page: title, prop: 'wikitext',
  });
  return j?.parse?.wikitext?.['*'] || '';
}

// Batched wikitext fetch via action=query&prop=revisions — supports up to 50
// titles per request. Reduces a 400-page crawl to ~8 requests, staying
// well within Liquipedia's rate limit. Returns Map<title, wikitext>.
async function fetchPlayerWikitextsBatch(titles) {
  // Shared helper batches + rate-limits.
  return liquipediaWikitextsBatch(titles);
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

// Strip Liquipedia template/wiki artifacts from a freeform field:
//   - HTML comments: `<!--Leave this blank-->`
//   - Wikilinks:     `[[Cloud9|Cloud9]]` → `Cloud9`, `[[Cloud9]]` → `Cloud9`
//   - Template noise: `{{TeamPart|Cloud9}}` → `Cloud9` (last segment)
//   - Trim and collapse whitespace; return null for empty
function cleanWikiField(raw) {
  if (!raw) return null;
  let s = String(raw);
  // Strip HTML comments
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  // Resolve [[Link|Display]] → Display, [[Link]] → Link
  s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1');
  // Drop {{Templates}} — keep last pipe-segment as a heuristic for org names
  s = s.replace(/\{\{[^}]*\|([^|}]+)\}\}/g, '$1').replace(/\{\{[^}]+\}\}/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s || null;
}

// Parse `lolchess=na/setsuko1-NA1` style fields into { region, riotId }.
// Returns null if the field doesn't carry a recognizable region prefix.
function parseLolchess(field) {
  if (!field) return null;
  let s = field.trim();
  // Robustness (W2, 2026-07-04): Liquipedia values can be URL-encoded
  // ("na/FNC%20Dishsoap-NA2") and may carry a "/setNN" deep-link suffix
  // ("…-NA2/set12") — both silently broke the parse before (skip without
  // insert). Decode + strip before splitting.
  try { s = decodeURIComponent(s); } catch { /* malformed escape → keep raw */ }
  s = s.replace(/\/set\d+.*$/i, '');
  const m = /^([a-zA-Z]+)\/(.+)$/.exec(s);
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

// One snapshot of the existing table, turned into the three lookup maps the
// run needs: name→puuid (targeted-mode ambiguity guard), source_page→puuid
// (CN anti-clobber: never degrade an already-resolved row), puuid→source_page
// (row routing: a puuid that exists under a different/NULL source_page must
// upsert on_conflict=puuid, or the batch dies on the unique(puuid) violation —
// the Liquipedia-page-rename / manual-row-fill cases, architect 2026-07-04).
async function fetchExistingPros() {
  const res = await fetch(`${SUPA_URL}/rest/v1/tft_pro_players?select=puuid,pro_name,source_page`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`fetchExistingPros failed: HTTP ${res.status}`);
  const rows = await res.json();
  const byName = new Map(), puuidBySourcePage = new Map(), sourcePageByPuuid = new Map();
  for (const r of rows || []) {
    if (r.pro_name && r.puuid) byName.set(r.pro_name.toLowerCase(), r.puuid);
    if (r.source_page) puuidBySourcePage.set(r.source_page, r.puuid ?? null);
    if (r.puuid) sourcePageByPuuid.set(r.puuid, r.source_page ?? null);
  }
  return { byName, puuidBySourcePage, sourcePageByPuuid };
}

// Team is enrichment-authoritative: the wikitext rarely carries `|team=`
// (rosters live in `|history={{THA}}` = LPDB-rendered, not parseable locally);
// enrich-tft-pro-history extracts the CURRENT team from the rendered infobox
// HTML. A null team from this crawler must therefore not clobber an
// enrich-written value — split each bulk upsert (PostgREST needs uniform keys
// per payload): rows WITH a parsed team update it, null-team rows omit the key.
async function upsertGrouped(rows, conflictKey) {
  const withTeam = rows.filter((r) => r.team != null);
  const withoutTeam = rows.filter((r) => r.team == null).map(({ team, ...rest }) => rest);
  await upsertPros(withTeam, conflictKey);
  await upsertPros(withoutTeam, conflictKey);
}

// Conflict-key rule (ONE function, parametrized — no drift): rows WITH a
// source_page upsert on_conflict=source_page (so a later puuid resolution for a
// CN row is a plain UPDATE); rows WITHOUT one (manual streamer path) and rows
// whose puuid already exists under a different source_page (page rename /
// manual-row-fill) go on_conflict=puuid. Routing happens in main().
async function upsertPros(rows, conflictKey) {
  if (rows.length === 0) return;
  if (SKIP_SUPABASE) {
    console.log(`  [supabase] --no-supabase set, skipping ${rows.length} rows`);
    return;
  }
  const url = `${SUPA_URL}/rest/v1/tft_pro_players?on_conflict=${conflictKey}`;
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
// CN ingestion (2026-07-04, user decision — see LOLCHESS_REGION_MAP comment)

// Filled from fetchExistingPros() at run start (empty in --no-supabase dry-runs).
let EXISTING = { byName: new Map(), puuidBySourcePage: new Map(), sourcePageByPuuid: new Map() };

// Build a puuid-less CN row for a player page that has no resolvable Riot
// account. Fires on ALL no-account skip paths (no lolchess field, unparseable
// lolchess, puuid failure) — 5/5 sampled CN pages carry no lolchess field at
// all, so hooking only the puuid-failure branch would catch almost nobody
// (data-skeptic 2026-07-04). Strict `country === 'China'`: Taiwan/Hong Kong
// players have Riot-covered servers and must keep going through the normal
// resolution path.
function maybeCnRow(info, title, idField) {
  // Liquipedia infoboxes carry BOTH forms: `country=China` and the ISO code
  // `country=cn` (verified live: BXSJ vs Bohetang). Normalize; stay strict —
  // Taiwan ('tw') and Hong Kong ('hk') have Riot-covered servers and must keep
  // going through the normal resolution path.
  const rawCountry = cleanWikiField(info.country) || cleanWikiField(info.nationality);
  if (!['china', 'cn', 'chn'].includes((rawCountry || '').trim().toLowerCase())) return null;
  // Anti-clobber: Chinese pros playing on Riot servers (BigBol/Flancy/J or C on
  // na1) already have a resolved row for this source_page — a transient Riot
  // failure must not degrade them to a puuid-less region='cn' row.
  if (EXISTING.puuidBySourcePage.get(title)) return null;
  return {
    pro_name: idField,
    real_name: cleanWikiField(info.name),
    region: 'cn',   // non-Riot marker; invariant: region='cn' ⇒ puuid IS NULL
    team: cleanWikiField(info.team) || cleanWikiField(info.team_history) || cleanWikiField(info.team1) || null,
    role: cleanWikiField(info.role) || 'Player',
    country: 'China',   // normalized (raw value may be the ISO code 'cn')
    source: 'liquipedia',
    source_page: title,
    twitch_handle: cleanWikiField(info.twitch),
    twitter_handle: cleanWikiField(info.twitter),
    youtube_handle: cleanWikiField(info.youtube),
    instagram_handle: cleanWikiField(info.instagram),
    // NO puuid / riot_id keys: they stay honest NULL via column default on
    // insert, and an omitted key can never clobber a later puuid upgrade.
    // Enrichment-owned fields omitted per the W3 contract.
    last_validated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// main

async function main() {
  const t0 = Date.now();
  console.log('=== TFT Pro Player Crawler ===\n');
  if (!SKIP_SUPABASE) EXISTING = await fetchExistingPros();

  // Batched wikitext fetch — 50 titles per request. ~8 Liquipedia requests
  // total instead of ~400. Cargo isn't available on the TFT wiki, so this
  // is the lightest supported path. --legacy switches back to per-page
  // action=parse only if the batched query starts misbehaving.
  const rows = [];
  let parsed = 0, resolved = 0, skipped = 0;

  // Coverage instrumentation (W2): the old single `skipped` counter hid WHY the
  // list is bounded (0 VN/TW/SEA pros despite mapped regions). Count per reason
  // — puuid failures per region — and print + persist a run summary.
  const skipReasons = {
    no_wikitext: 0, no_infobox: 0, no_id: 0,
    no_lolchess_field: 0, unparseable_lolchess: 0, puuid_fail_by_region: {},
    cn_ingested: 0,
  };
  // CN rows lack the puuid/riot_id keys → different JSON key signature than the
  // West rows (PostgREST bulk payloads need uniform keys) → own array + batch.
  const cnRows = [];

  if (!SKIP_LIQUIPEDIA) {
    let titles;
    if (PAGES_OVERRIDE) {
      titles = PAGES_OVERRIDE.split(',').map((t) => t.trim()).filter(Boolean);
      console.log(`[1/3] Targeted mode — ${titles.length} explicit page title(s)`);
    } else {
      console.log('[1/3] Fetching Liquipedia Category:Players …');
      titles = await fetchAllPlayerTitles();
    }
    if (LIMIT > 0) titles = titles.slice(0, LIMIT);
    const requestEstimate = LEGACY ? titles.length : Math.ceil(titles.length / 50);
    console.log(`       ${titles.length} player pages → ~${requestEstimate} Liquipedia request(s)\n`);

    // Build title→wikitext map. Batched path is the default.
    let wikitextByTitle;
    if (LEGACY) {
      console.log('       [legacy] per-page action=parse walk');
      wikitextByTitle = new Map();
      for (const title of titles) {
        // Rate-limit handled by the shared liquipediaJson gate.
        try { wikitextByTitle.set(title, await fetchPlayerWikitext(title)); }
        catch (e) { if (VERBOSE) console.warn(`  [skip] ${title}: ${e.message}`); }
      }
    } else {
      console.log('       [batched] action=query&prop=revisions (50 titles/request)');
      wikitextByTitle = await fetchPlayerWikitextsBatch(titles);
    }

    // Parse + Riot-resolve
    for (const title of titles) {
      const wikitext = wikitextByTitle.get(title) || '';
      if (!wikitext) { skipped++; skipReasons.no_wikitext++; continue; }
      const info = parseInfobox(wikitext);
      if (!info) { skipped++; skipReasons.no_infobox++; continue; }
      parsed++;
      const idField = info.id || info.ID || info.player;
      const accountSpec = parseLolchess(info.lolchess) || parseLolchess(info.lolchess2);
      if (!idField) { skipped++; skipReasons.no_id++; if (VERBOSE) console.warn(`  [skip] ${title}: no id field`); continue; }
      if (!accountSpec) {
        const cn = maybeCnRow(info, title, idField);
        if (cn) { cnRows.push(cn); skipReasons.cn_ingested++; continue; }
        skipped++;
        if (info.lolchess || info.lolchess2) { skipReasons.unparseable_lolchess++; if (VERBOSE) console.warn(`  [skip] ${title}: unparseable lolchess "${info.lolchess || info.lolchess2}"`); }
        else skipReasons.no_lolchess_field++;
        continue;
      }
      const puuid = await resolvePuuid(accountSpec.region, accountSpec.gameName, accountSpec.tagLine);
      if (!puuid) {
        const cn = maybeCnRow(info, title, idField);
        if (cn) { cnRows.push(cn); skipReasons.cn_ingested++; continue; }
        skipped++;
        skipReasons.puuid_fail_by_region[accountSpec.region] = (skipReasons.puuid_fail_by_region[accountSpec.region] || 0) + 1;
        if (VERBOSE) console.warn(`  [skip] ${title}: puuid resolution failed for ${accountSpec.gameName}#${accountSpec.tagLine} (${accountSpec.region})`);
        continue;
      }
      resolved++;
      // Clean team / role / country / socials: Liquipedia leaks HTML
      // comments ("<!--Leave blank-->") and [[Wikilinks]] into raw fields.
      // Fallback to team_history's most recent entry when `team=` is blank.
      const cleanedTeam = cleanWikiField(info.team)
        || cleanWikiField(info.team_history)
        || cleanWikiField(info.team1)
        || null;
      rows.push({
        puuid,
        pro_name: idField,
        real_name: cleanWikiField(info.name),
        region: accountSpec.region,
        riot_id: `${accountSpec.gameName}#${accountSpec.tagLine}`,
        team: cleanedTeam,
        role: cleanWikiField(info.role) || 'Player',
        country: cleanWikiField(info.country) || cleanWikiField(info.nationality),
        source: 'liquipedia',
        source_page: title,
        twitch_handle: cleanWikiField(info.twitch),
        twitter_handle: cleanWikiField(info.twitter),
        youtube_handle: cleanWikiField(info.youtube),
        instagram_handle: cleanWikiField(info.instagram),
        // tournament_results / total_earnings_usd / image_url are enrichment-owned
        // (enrich-tft-pro-history.mjs). They MUST NOT appear in this payload: the
        // merge-duplicates upsert would reset them on every weekly run — exactly
        // the wipe that kept 0/259 pros classified as tournament/historic
        // (classification-review 2026-07-04). Omitted keys survive the merge.
        last_validated_at: new Date().toISOString(),
      });
      if (rows.length % 25 === 0) {
        const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
        console.log(`  ${rows.length}/${titles.length}  parsed=${parsed} resolved=${resolved} skipped=${skipped}  ${elapsed}s`);
      }
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
      // No enrichment-owned keys here either (see the Liquipedia row above).
      last_validated_at: new Date().toISOString(),
    });
  }
  console.log(`       ${streamers.length} streamer entries, ${rows.length} total after merge`);

  // De-dup. NOT puuid-only: CN rows carry no puuid — the first would park
  // `undefined` in the set and swallow all 295 others (architect 2026-07-04).
  // source_page is the identity of Liquipedia rows, puuid of manual ones.
  const dedupKey = (r) => r.source_page ?? r.puuid;
  const seen = new Set();
  const unique = [];
  for (const r of rows) {
    const k = dedupKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(r);
  }
  const uniqueCn = [];
  for (const r of cnRows) {
    const k = dedupKey(r);
    if (seen.has(k)) continue;
    seen.add(k);
    uniqueCn.push(r);
  }
  console.log(`       deduped: ${unique.length} riot + ${uniqueCn.length} cn`);

  // Ambiguity guard (W2, data-skeptic): a name-based targeted feed can resolve
  // a page whose pro_name already exists under a DIFFERENT puuid — the
  // kurumx-dupe class that makes name joins nondeterministic. Skip + log loud;
  // the normal category run refreshes by identity keys and passes unchanged.
  // Riot rows only — CN identity is source_page, name collisions are legal.
  let toWrite = unique;
  if (PAGES_OVERRIDE && !SKIP_SUPABASE) {
    toWrite = unique.filter((r) => {
      const other = EXISTING.byName.get(r.pro_name.toLowerCase());
      if (other && other !== r.puuid) {
        console.warn(`  [ambiguous] "${r.pro_name}" already exists under a different puuid — skipped, resolve manually`);
        return false;
      }
      return true;
    });
  }

  // Row routing onto the two conflict keys (see upsertPros): rows without a
  // source_page (manual streamer path) and rows whose puuid already exists
  // under a DIFFERENT (or NULL) source_page — Liquipedia page rename or a
  // manual row gaining its page — must merge by puuid, or the INSERT trips the
  // unique(puuid) constraint and kills the whole batch.
  const puuidKeyRows = [];
  const pageKeyRows = [];
  for (const r of toWrite) {
    if (!r.source_page) { puuidKeyRows.push(r); continue; }
    const known = EXISTING.sourcePageByPuuid.has(r.puuid) ? EXISTING.sourcePageByPuuid.get(r.puuid) : undefined;
    if (known !== undefined && known !== r.source_page) { puuidKeyRows.push(r); continue; }
    pageKeyRows.push(r);
  }

  // 4) Upsert
  console.log('\n[3/3] Writing to Supabase …');
  await upsertGrouped(puuidKeyRows, 'puuid');
  await upsertGrouped(pageKeyRows, 'source_page');
  await upsertGrouped(uniqueCn, 'source_page');

  const total = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone. ${toWrite.length + uniqueCn.length} pros (${uniqueCn.length} cn) in ${total}s.`);
  console.log(`Coverage skip summary: ${JSON.stringify(skipReasons)}`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

#!/usr/bin/env node
/**
 * Crawls TFT tournaments from Liquipedia and upserts into Supabase.
 *
 * Pipeline (current — wikitext-parse path):
 *   1) Seed tournament page-titles from a hand-maintained list of the
 *      biggest events plus Category:S-Tier_Tournaments / A-Tier / B-Tier
 *      (Liquipedia tiers events by importance).
 *   2) For each title: action=parse&prop=wikitext → parse the
 *      {{Infobox league}} template for metadata + the {{Prize pool}} or
 *      {{TeamCard}} blocks for placements.
 *   3) Cross-join placements against tft_pro_players (by lowercase
 *      pro_name match) so verified pros get a puuid linked from their
 *      tournament rows.
 *   4) Upsert tournaments + replace results.
 *
 * Liquipedia ToU: 30-second delay between requests on the public wikitext
 * API. Roughly 50 tournament pages = ~25 minutes per run; we run weekly.
 *
 * When the Liquipedia REST API key arrives (open-source-tier registration),
 * swap `fetchTournamentWikitext()` for the API path and drop the 30s delay
 * to the API's documented per-second limit. The DB schema is already shaped
 * for that.
 *
 * Usage:
 *   node scripts/crawl-tft-tournaments.mjs                # full run
 *   node scripts/crawl-tft-tournaments.mjs --limit 5      # smoke-test
 *   node scripts/crawl-tft-tournaments.mjs --no-supabase  # dry run
 *   node scripts/crawl-tft-tournaments.mjs --pages "Foo,Bar"  # explicit list
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const LIMIT = parseInt(arg('--limit', '0'), 10);
const SKIP_SUPABASE = hasFlag('--no-supabase');
const PAGES_OVERRIDE = arg('--pages', '');
const VERBOSE = hasFlag('--verbose');

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
// Liquipedia ToU for public wikitext API: 30s between requests.
const LIQUIPEDIA_DELAY_MS = 30_500;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// Seed list — hand-curated for V1 because Liquipedia's
// Category:S-Tier_Tournaments listing is incomplete for TFT. Update this list
// when Liquipedia adds new big events; eventually we can derive it from the
// Portal:Statistics/<year> page which lists every event of the year.
// Tier mapping per Liquipedia: S/A/B/C.

const SEED_TOURNAMENTS = [
  // S-Tier — premier events
  { page: 'Esports_World_Cup/2026', tier: 'S', region: 'INT' },
  { page: 'Esports_World_Cup/2025', tier: 'S', region: 'INT' },
  { page: 'Into_the_Arcane/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 14 },
  { page: 'K.O._Coliseum/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 15 },
  { page: 'Space_Gods/Tacticians_Crown', tier: 'S', region: 'INT', setNumber: 16 },
  // A-Tier — regional finals + pro circuit majors
  { page: 'Space_Gods/AMER/Regional_Finals', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/EMEA/Regional_Finals', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/APAC/Regional_Finals', tier: 'A', region: 'APAC', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Anima_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Tactical_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/AMER/Crystal_Cup', tier: 'A', region: 'AMER', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Anima_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Tactical_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  { page: 'Space_Gods/TFT_Pro_Circuit/EMEA/Crystal_Cup', tier: 'A', region: 'EMEA', setNumber: 16 },
  // Set 15 + 14 reference events (so the patch-diff backfill has data)
  { page: 'K.O._Coliseum/AMER/Regional_Finals', tier: 'A', region: 'AMER', setNumber: 15 },
  { page: 'K.O._Coliseum/EMEA/Regional_Finals', tier: 'A', region: 'EMEA', setNumber: 15 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Liquipedia fetch

async function liquipediaJson(params) {
  const url = `${LIQUIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Encoding': 'gzip, deflate',
    },
  });
  if (!res.ok) throw new Error(`Liquipedia HTTP ${res.status}: ${url.slice(0, 200)}`);
  return res.json();
}

async function fetchTournamentWikitext(page) {
  const j = await liquipediaJson({
    action: 'parse', page, prop: 'wikitext|displaytitle',
  });
  return {
    wikitext: j.parse?.wikitext?.['*'] || '',
    displayTitle: j.parse?.displaytitle || page.replace(/_/g, ' '),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Template parsing — depth-tracked so nested templates don't fool the splitter

function findTemplate(wikitext, templateName) {
  const startMarker = `{{${templateName}`;
  let idx = 0;
  while (true) {
    const start = wikitext.indexOf(startMarker, idx);
    if (start < 0) return null;
    // Ensure it's a template boundary (next char is `|` or `}` after a space)
    const next = wikitext[start + startMarker.length];
    if (next !== '|' && next !== ' ' && next !== '\n' && next !== '}') {
      idx = start + 1;
      continue;
    }
    let depth = 0, i = start;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
      if (wikitext[i] === '}' && wikitext[i + 1] === '}') { depth--; i += 2; if (depth === 0) return { start, end: i, body: wikitext.slice(start + startMarker.length, i - 2) }; continue; }
      i++;
    }
    return null;
  }
}

function parseTemplateFields(body) {
  const fields = {};
  let depth = 0, buf = '';
  for (let j = 0; j < body.length; j++) {
    const c = body[j], n = body[j + 1];
    if (c === '{' && n === '{') { depth++; buf += c; continue; }
    if (c === '}' && n === '}') { depth--; buf += c; continue; }
    // Brackets for [[Link|Text]] — also depth-track so | inside them doesn't split
    if (c === '[' && n === '[') { depth++; buf += c; continue; }
    if (c === ']' && n === ']') { depth--; buf += c; continue; }
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

// Strip wiki-link syntax `[[X|Y]]` → `Y`, `[[X]]` → `X`.
function unwiki(s) {
  if (!s) return '';
  return s
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDate(s) {
  if (!s) return null;
  // Liquipedia uses "yyyy-mm-dd" most of the time, occasionally "MonthName d, yyyy".
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (ymd) return `${ymd[1]}-${ymd[2]}-${ymd[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function parsePrize(s) {
  if (!s) return null;
  // Strip currency + commas; keep numbers
  const num = s.replace(/[^0-9]/g, '');
  return num ? parseInt(num, 10) : null;
}

function deriveStatus(startDate, endDate) {
  const today = new Date().toISOString().slice(0, 10);
  if (!startDate) return 'upcoming';
  if (endDate && endDate < today) return 'past';
  if (startDate <= today && (!endDate || endDate >= today)) return 'live';
  return 'upcoming';
}

// Extract placements from {{Prize pool}} / {{prize pool start}} blocks.
// Liquipedia uses many variants; the most common in TFT pages is `prize-pool-slot`
// templates inside a wrapping table. We do a permissive scan: any line with
// `place=N|...|p1=Name|...|usdprize=X` (or similar).
function extractPlacements(wikitext) {
  const placements = [];
  // Match "place=1" / "place=2" entries
  const placeRegex = /\{\{prize\s*pool\s*slot[^}]*\}\}/gis;
  let m;
  while ((m = placeRegex.exec(wikitext)) != null) {
    const body = m[0];
    const fields = {};
    body.slice(2, -2).split('|').slice(1).forEach(part => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const k = part.slice(0, eq).trim();
      const v = part.slice(eq + 1).trim();
      fields[k] = v;
    });
    const place = parseInt(fields.place || '0', 10);
    if (!place) continue;
    const proName = unwiki(fields.p1 || fields.player || fields.team || '');
    if (!proName) continue;
    placements.push({
      placement: place,
      proName,
      team: unwiki(fields.team || fields.t1 || '') || null,
      country: fields.c1 || fields.flag || null,
      prizeUsd: parsePrize(fields.usdprize),
    });
  }
  return placements;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slug + supabase

function numericTierToLetter(t) {
  const n = parseInt(t, 10);
  if (n === 1) return 'S';
  if (n === 2) return 'A';
  if (n === 3) return 'B';
  if (n === 4) return 'C';
  return null;
}

function pageToSlug(page) {
  return page.toLowerCase().replace(/[\/_]/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-');
}

async function loadProPuuids() {
  if (!SUPA_KEY) return new Map();
  const url = `${SUPA_URL}/rest/v1/tft_pro_players?select=puuid,pro_name`;
  const r = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!r.ok) return new Map();
  const rows = await r.json();
  const m = new Map();
  for (const row of rows || []) if (row.pro_name && row.puuid) m.set(row.pro_name.toLowerCase(), row.puuid);
  return m;
}

async function upsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  if (SKIP_SUPABASE) {
    console.log(`  [supabase] dry-run, would write ${rows.length} to ${table}`);
    return;
  }
  const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
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
    throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${body.slice(0, 400)}`);
  }
}

async function deleteResultsFor(tournamentId) {
  if (SKIP_SUPABASE) return;
  await fetch(`${SUPA_URL}/rest/v1/tft_tournament_results?tournament_id=eq.${tournamentId}`, {
    method: 'DELETE',
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, Prefer: 'return=minimal' },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// main

async function main() {
  const t0 = Date.now();
  console.log('=== TFT Tournament Crawler ===\n');

  let seed = SEED_TOURNAMENTS;
  if (PAGES_OVERRIDE) {
    seed = PAGES_OVERRIDE.split(',').map(p => ({ page: p.trim(), tier: null, region: null }));
  }
  if (LIMIT > 0) seed = seed.slice(0, LIMIT);
  console.log(`[1/3] ${seed.length} tournament pages to crawl (${Math.ceil(seed.length * LIQUIPEDIA_DELAY_MS / 60000)} min @ 30s rate-limit)\n`);

  const proPuuidByName = await loadProPuuids();
  console.log(`  [pro-join] loaded ${proPuuidByName.size} pros for puuid back-fill\n`);

  console.log('[2/3] Fetching + parsing each page …');
  const tournaments = [];
  const allResults = [];
  let parsed = 0, skipped = 0;
  for (const s of seed) {
    if (parsed > 0) await sleep(LIQUIPEDIA_DELAY_MS);
    let wikitext, displayTitle;
    try { ({ wikitext, displayTitle } = await fetchTournamentWikitext(s.page)); }
    catch (e) { console.warn(`  [skip] ${s.page}: ${e.message}`); skipped++; continue; }
    if (!wikitext) { skipped++; continue; }

    const info = findTemplate(wikitext, 'Infobox league');
    if (!info) {
      if (VERBOSE) console.warn(`  [skip] ${s.page}: no Infobox league`);
      skipped++; continue;
    }
    const fields = parseTemplateFields(info.body);
    const id = pageToSlug(s.page);
    const name = unwiki(fields.name) || displayTitle;
    const startDate = parseDate(fields.sdate || fields.startdate);
    const endDate = parseDate(fields.edate || fields.enddate);
    const status = deriveStatus(startDate, endDate);
    tournaments.push({
      id,
      liquipedia_page: s.page,
      name,
      // Seed-tier wins over wiki-tier (the wiki stores numeric 1/2/3 but our
      // schema uses S/A/B/C — easier to enforce that in seed-list than to
      // parse-and-translate here).
      tier: s.tier || numericTierToLetter(fields.liquipediatier),
      region: s.region || null,
      set_number: s.setNumber || null,
      start_date: startDate,
      end_date: endDate,
      status,
      prize_pool_usd: parsePrize(fields.prizepool),
      twitch_channel: fields.twitch || null,
      format: unwiki(fields.format) || null,
      num_participants: parseInt(fields.team_number || fields.player_number || '0', 10) || null,
      logo_url: null,                   // logos need image-API resolution; later
      source: 'liquipedia',
      last_validated_at: new Date().toISOString(),
    });

    // Extract placements (best-effort; not all pages have them in a parseable form)
    const placements = extractPlacements(wikitext);
    for (const p of placements) {
      const puuid = proPuuidByName.get(p.proName.toLowerCase()) || null;
      allResults.push({
        tournament_id: id,
        placement: p.placement,
        pro_name: p.proName,
        pro_puuid: puuid,
        team: p.team,
        country: p.country,
        prize_usd: p.prizeUsd,
      });
    }
    parsed++;
    console.log(`  ${parsed}/${seed.length}  ${s.page}  placements=${placements.length}`);
  }

  console.log(`\n[3/3] Writing ${tournaments.length} tournaments + ${allResults.length} placements …`);
  await upsert('tft_tournaments', tournaments, 'id');
  // Replace strategy for results: delete + insert per tournament, since
  // placements can change as Liquipedia updates Standings.
  for (const t of tournaments) await deleteResultsFor(t.id);
  await upsert('tft_tournament_results', allResults, 'tournament_id,placement,pro_name');

  const total = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone. ${tournaments.length} tournaments, ${allResults.length} placements in ${total}s (skipped: ${skipped})`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

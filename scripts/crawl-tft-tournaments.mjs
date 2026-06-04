#!/usr/bin/env node
/**
 * Crawls TFT tournaments from Liquipedia and upserts into Supabase.
 *
 * Pipeline (current — wikitext-parse path):
 *   1) Seed tournament page-titles: a hand-maintained list of the biggest
 *      events (carries region/set_number overrides) MERGED with auto-discovery
 *      from Category:S-Tier_Tournaments + A-Tier (+ B-Tier via --include-b-tier),
 *      so new events are picked up without editing the seed list.
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
 *   node scripts/crawl-tft-tournaments.mjs                # full run (auto-discovers S+A tier)
 *   node scripts/crawl-tft-tournaments.mjs --limit 5      # smoke-test
 *   node scripts/crawl-tft-tournaments.mjs --no-supabase  # dry run
 *   node scripts/crawl-tft-tournaments.mjs --no-discover  # curated seed only (skip category scan)
 *   node scripts/crawl-tft-tournaments.mjs --include-b-tier  # also crawl B-tier events
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

// All page titles in a Liquipedia category (handles cmcontinue paging). Each
// API call still respects the 30s ToU delay.
async function fetchCategoryMembers(category) {
  const pages = [];
  let cmcontinue = null;
  do {
    const params = {
      action: 'query', list: 'categorymembers',
      cmtitle: `Category:${category}`, cmlimit: '500', cmtype: 'page',
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const j = await liquipediaJson(params);
    for (const m of j.query?.categorymembers || []) pages.push(m.title);
    cmcontinue = j.continue?.cmcontinue || null;
    if (cmcontinue) await sleep(LIQUIPEDIA_DELAY_MS);
  } while (cmcontinue);
  return pages;
}

// Auto-discover tournament pages from Liquipedia's tier categories so new
// events are picked up without editing SEED_TOURNAMENTS. The curated seed still
// wins (it carries region/set_number/tier overrides the categories don't have).
// S + A tiers by default (premier + regional majors); B-tier behind a flag
// because it's large and mostly minor weeklies.
async function discoverSeedFromCategories() {
  const cats = [
    { cat: 'S-Tier_Tournaments', tier: 'S' },
    { cat: 'A-Tier_Tournaments', tier: 'A' },
  ];
  if (hasFlag('--include-b-tier')) cats.push({ cat: 'B-Tier_Tournaments', tier: 'B' });
  const discovered = [];
  for (let i = 0; i < cats.length; i++) {
    if (i > 0) await sleep(LIQUIPEDIA_DELAY_MS);
    try {
      const titles = await fetchCategoryMembers(cats[i].cat);
      for (const title of titles) {
        discovered.push({ page: title.replace(/ /g, '_'), tier: cats[i].tier, region: null });
      }
      console.log(`  [discover] ${cats[i].cat}: ${titles.length} pages`);
    } catch (e) {
      console.warn(`  [discover] ${cats[i].cat} failed: ${e.message}`);
    }
  }
  return discovered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Template parsing — depth-tracked so nested templates don't fool the splitter

function findTemplate(wikitext, templateName, from = 0) {
  // MediaWiki template names are case-insensitive on the FIRST letter only
  // ("{{prize pool slot}}" === "{{Prize pool slot}}"), so match either casing.
  const lower = templateName.charAt(0).toLowerCase() + templateName.slice(1);
  const upper = templateName.charAt(0).toUpperCase() + templateName.slice(1);
  const markers = upper === lower ? [`{{${lower}`] : [`{{${lower}`, `{{${upper}`];
  let idx = from;
  while (true) {
    // Earliest occurrence of any marker casing at/after idx.
    let start = -1, marker = '';
    for (const mk of markers) {
      const p = wikitext.indexOf(mk, idx);
      if (p >= 0 && (start < 0 || p < start)) { start = p; marker = mk; }
    }
    if (start < 0) return null;
    // Ensure it's a template boundary (next char is `|` or `}` after a space)
    const next = wikitext[start + marker.length];
    if (next !== '|' && next !== ' ' && next !== '\n' && next !== '}') {
      idx = start + 1;
      continue;
    }
    let depth = 0, i = start;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i + 1] === '{') { depth++; i += 2; continue; }
      if (wikitext[i] === '}' && wikitext[i + 1] === '}') { depth--; i += 2; if (depth === 0) return { start, end: i, body: wikitext.slice(start + marker.length, i - 2) }; continue; }
      i++;
    }
    return null;
  }
}

// All depth-balanced occurrences of a template (by name), in document order.
function findAllTemplates(wikitext, templateName) {
  const out = [];
  let from = 0;
  while (true) {
    const t = findTemplate(wikitext, templateName, from);
    if (!t) break;
    out.push(t.body);
    from = t.end;
  }
  return out;
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

// Set names — mirror of scripts/detect-tft-set.mjs SET_NAMES. Keep in sync.
// Used to resolve the Liquipedia `{{SetName/N}}` template, which on the wiki
// renders to the marketing-facing set name (e.g. {{SetName/17}} → "Space Gods").
const TFT_SET_NAMES = {
  1: 'Beta',
  2: 'Rise of the Elements',
  3: 'Galaxies',
  4: 'Fates',
  5: 'Reckoning',
  6: 'Gizmos & Gadgets',
  7: 'Dragonlands',
  8: 'Monsters Attack',
  9: 'Runeterra Reforged',
  10: 'Remix Rumble',
  11: 'Inkborn Fables',
  12: "Magic n' Mayhem",
  13: 'Into the Arcane',
  14: 'Cyber City',
  15: 'Spatulor',
  16: 'K.O. Coliseum',
  17: 'Space Gods',
};

// Strip wiki-link syntax `[[X|Y]]` → `Y`, `[[X]]` → `X`, and resolve / strip
// `{{Template}}` references that MediaWiki would otherwise expand server-side.
// We do the SetName resolution explicitly so events whose `name` field is just
// `{{SetName/17}}: AMER Regional Finals` come out as "Space Gods: AMER Regional
// Finals" instead of bleeding raw template syntax into the UI. Anything else
// in `{{…}}` we can't safely resolve from wikitext alone — strip it.
function unwiki(s) {
  if (!s) return '';
  let out = s
    .replace(/\{\{\s*setname\s*\/\s*(\d+)\s*\}\}/gi, (_, n) => TFT_SET_NAMES[parseInt(n, 10)] || `Set ${n}`)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ');
  // Strip any remaining {{…}} templates. Iterate so nested templates collapse
  // ({{Foo|{{Bar}}}} → {{Foo|}} → '').
  let prev;
  do { prev = out; out = out.replace(/\{\{[^{}]*\}\}/g, ''); } while (out !== prev);
  return out
    .replace(/^[\s:,\-–—]+/, '')   // orphan punctuation left by a stripped leading template
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

// Set number straight from the page so it's right even for auto-discovered
// events (the seed list mislabels some). Prefer the set-esports navbox
// ({{tft_set_17_esports_navbox}}); else the most-frequent {{setname/NN}}.
function deriveSetNumber(wikitext) {
  const navbox = /tft[ _]set[ _](\d+)[ _]esports[ _]navbox/i.exec(wikitext);
  if (navbox) return parseInt(navbox[1], 10);
  const counts = {};
  const re = /\{\{\s*setname\/(\d+)/gi;
  let m;
  while ((m = re.exec(wikitext))) counts[m[1]] = (counts[m[1]] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return top ? parseInt(top[0], 10) : null;
}

// Distinct participant count from {{ParticipantTable}} / {{ParticipantSection}}
// blocks (each entrant is a {{SoloOpponent}}). Lets ongoing/upcoming events —
// which have no final {{Slot}} ranking yet — still show "N participants".
function countParticipants(wikitext) {
  const collect = (text, set) => {
    for (const opp of findAllTemplates(text, 'SoloOpponent')) {
      const { positional, keyed } = parseTemplateArgs(opp);
      const n = unwiki(positional[0] || keyed['1'] || '');
      if (n) set.add(n.toLowerCase());
    }
  };
  const names = new Set();
  // Prefer dedicated participant blocks…
  for (const tpl of ['ParticipantTable', 'ParticipantSection']) {
    for (const block of findAllTemplates(wikitext, tpl)) collect(block, names);
  }
  // …else fall back to distinct {{SoloOpponent}} page-wide (bracket/matches),
  // which approximates the roster size for ongoing events without a table.
  if (names.size === 0) collect(wikitext, names);
  return names.size || null;
}

// Extract placements from {{Prize pool}} / {{prize pool start}} blocks.
// Liquipedia uses many variants; the most common in TFT pages is `prize-pool-slot`
// templates inside a wrapping table. We do a permissive scan: any line with
// `place=N|...|p1=Name|...|usdprize=X` (or similar).
// Depth-aware split of a template body into positional + keyed args. The body
// starts with the leading `|` (everything after the template name), so the
// first (empty) segment is dropped from positionals.
function parseTemplateArgs(body) {
  const positional = [], keyed = {};
  let depth = 0, buf = '';
  const flush = () => {
    const eq = buf.indexOf('=');
    if (eq >= 0) {
      const k = buf.slice(0, eq).trim();
      // Real param keys are simple tokens; anything else (a link/template that
      // happens to contain `=`) is a positional value.
      if (/^[A-Za-z0-9_ -]+$/.test(k)) { keyed[k] = buf.slice(eq + 1).trim(); return; }
    }
    const v = buf.trim();
    if (v) positional.push(v);
  };
  for (let j = 0; j < body.length; j++) {
    const c = body[j], n = body[j + 1];
    if (c === '{' && n === '{') { depth++; buf += c; continue; }
    if (c === '}' && n === '}') { depth--; buf += c; continue; }
    if (c === '[' && n === '[') { depth++; buf += c; continue; }
    if (c === ']' && n === ']') { depth--; buf += c; continue; }
    if (c === '|' && depth === 0) { flush(); buf = ''; } else buf += c;
  }
  flush();
  return { positional, keyed };
}

// Modern TFT prize-pool format: {{Slot|place=N|usdprize=X|{{SoloOpponent|Name|flag=xx}}}}.
// Older pages used {{prize pool slot|place=N|p1=Name|usdprize=X}}. Handle both,
// depth-safely (nested SoloOpponent/flag templates must not truncate the slot).
function extractPlacements(wikitext) {
  const placements = [];
  const seen = new Set();
  const push = (place, proName, country, prizeUsd, team) => {
    if (!place || !proName) return;
    const key = `${place}::${proName.toLowerCase()}`;
    if (seen.has(key)) return;   // de-dupe nested per-day + overall blocks
    seen.add(key);
    placements.push({ placement: place, proName, team: team || null, country: country || null, prizeUsd: prizeUsd ?? null });
  };

  // Modern {{Slot}} + nested {{SoloOpponent}}. Slots are in rank order and
  // usually carry NO explicit place= — placement is the running position. A
  // slot may hold several SoloOpponents (tied range, e.g. 5th-8th): they share
  // the slot's base rank and the counter advances by the opponent count.
  let rank = 1;
  for (const body of findAllTemplates(wikitext, 'Slot')) {
    const f = parseTemplateFields(body);
    const base = f.place ? parseInt(f.place, 10) : rank;
    const prize = parsePrize(f.usdprize || f.localprize);
    const opps = findAllTemplates(body, 'SoloOpponent');
    let n = 0;
    for (const oppBody of opps) {
      const { positional, keyed } = parseTemplateArgs(oppBody);
      const proName = unwiki(positional[0] || keyed['1'] || keyed.p1 || '');
      if (!proName) continue;
      push(base, proName, keyed.flag || null, prize, null);
      n++;
    }
    rank = base + Math.max(1, n);
  }

  // Legacy {{prize pool slot}} format (older events) — only if Slot found nothing.
  if (placements.length === 0) {
    for (const body of findAllTemplates(wikitext, 'prize pool slot')) {
      const f = parseTemplateFields(body);
      const place = parseInt(f.place || '0', 10);
      const proName = unwiki(f.p1 || f.player || f['1'] || '');
      push(place, proName, f.c1 || f.p1flag || f.flag || null, parsePrize(f.usdprize), unwiki(f.team || '') || null);
    }
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
  } else if (!hasFlag('--no-discover')) {
    console.log('[0/3] Auto-discovering tournament pages from tier categories …');
    const discovered = await discoverSeedFromCategories();
    const seen = new Set(SEED_TOURNAMENTS.map(s => s.page.toLowerCase()));
    const merged = [...SEED_TOURNAMENTS];   // curated first — keeps their region/set/tier overrides
    for (const d of discovered) {
      const key = d.page.toLowerCase();
      if (!seen.has(key)) { merged.push(d); seen.add(key); }
    }
    console.log(`  [discover] ${SEED_TOURNAMENTS.length} curated + ${merged.length - SEED_TOURNAMENTS.length} new = ${merged.length} pages\n`);
    seed = merged;
  }
  if (LIMIT > 0) seed = seed.slice(0, LIMIT);
  console.log(`[1/3] ${seed.length} tournament pages to crawl (${Math.ceil(seed.length * LIQUIPEDIA_DELAY_MS / 60000)} min @ 30s rate-limit)\n`);

  const proPuuidByName = await loadProPuuids();
  console.log(`  [pro-join] loaded ${proPuuidByName.size} pros for puuid back-fill\n`);

  console.log('[2/3] Fetching + parsing + writing each page …');
  let totalTournaments = 0, totalResults = 0;
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

    // Placements (finished events). Participant count is a fallback so
    // ongoing/upcoming events — which have no final {{Slot}} ranking yet —
    // still show "N participants" instead of looking empty.
    const placements = extractPlacements(wikitext);
    const infoboxCount = parseInt(fields.team_number || fields.player_number || '0', 10) || null;
    const numParticipants = infoboxCount || placements.length || countParticipants(wikitext);

    const tour = {
      id,
      liquipedia_page: s.page,
      name,
      // Seed-tier wins over wiki-tier (wiki stores numeric 1/2/3; our schema uses S/A/B/C).
      tier: s.tier || numericTierToLetter(fields.liquipediatier),
      region: s.region || null,
      // Set number from the page itself; seed value only as a fallback.
      set_number: deriveSetNumber(wikitext) || s.setNumber || null,
      start_date: startDate,
      end_date: endDate,
      status,
      prize_pool_usd: parsePrize(fields.prizepool),
      twitch_channel: fields.twitch || null,
      format: unwiki(fields.format) || null,
      num_participants: numParticipants,
      logo_url: null,                   // logos need image-API resolution; later
      source: 'liquipedia',
      last_validated_at: new Date().toISOString(),
    };

    const results = placements.map(p => ({
      tournament_id: id,
      placement: p.placement,
      pro_name: p.proName,
      pro_puuid: proPuuidByName.get(p.proName.toLowerCase()) || null,
      team: p.team,
      country: p.country,
      prize_usd: p.prizeUsd,
    }));

    // Write incrementally: a 2.5h discovery run must persist partial progress
    // and never POST one huge results payload. Results are replaced per event.
    try {
      await upsert('tft_tournaments', [tour], 'id');
      await deleteResultsFor(id);
      await upsert('tft_tournament_results', results, 'tournament_id,placement,pro_name');
      totalTournaments++;
      totalResults += results.length;
    } catch (e) {
      console.warn(`  [write-fail] ${s.page}: ${e.message}`);
    }
    parsed++;
    console.log(`  ${parsed}/${seed.length}  ${s.page}  set=${tour.set_number ?? '—'}  placements=${placements.length}  participants=${numParticipants ?? '—'}`);
  }

  const total = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`\nDone. ${totalTournaments} tournaments, ${totalResults} placements in ${total}s (skipped: ${skipped})`);
}

main().catch(err => { console.error('FAIL:', err.message); console.error(err.stack); process.exit(1); });

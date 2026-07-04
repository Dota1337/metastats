#!/usr/bin/env node
/**
 * Crawls the current Set's TFT Pro Circuit rosters from Liquipedia and stamps
 * tpc_verified + tpc_region on the matching tft_pro_players rows.
 *
 * Why Liquipedia and not competetft.com?
 *   competetft.com renders the regional standings via RSC server-actions that
 *   require Riot SSO + opaque request encoding — fragile to reverse-engineer.
 *   Liquipedia has the exact same standings as plain wikitext per region per
 *   cup ({{Slot|usdprize=…|{{SoloOpponent|Name}}}}), publicly accessible,
 *   stable schema, and respects our existing 2.1s ToU rate-limit.
 *
 * Pipeline:
 *   1) Resolve current set name from public/tft-set.json → "Space Gods" etc.
 *   2) For each TPC region (AMER, APAC, EMEA, CN), enumerate cup pages via
 *      Liquipedia Category:S-Tier_Tournaments + name-filter ("<Set>/TPC/<Region>/").
 *      Falls back to a known cup-name list if Category lookup is too coarse.
 *   3) Fetch wikitext per cup, extract participant names from
 *      {{SoloOpponent|Name|…}} entries inside the prize-pool slots.
 *   4) Dedupe across cups per region → final TPC roster per region.
 *   5) Upsert into tft_pro_players: set tpc_verified=true + tpc_region.
 *      Pros not in the DB yet are flagged for the next regular pro-crawl
 *      (which resolves their Riot ID + PUUID).
 *   6) Write a tft_pro_validation_log run summarising what was found and which
 *      names couldn't be matched (potential identity drift).
 *
 * Usage:
 *   node scripts/crawl-tft-tpc-roster.mjs                 # full run
 *   node scripts/crawl-tft-tpc-roster.mjs --no-supabase   # dry-run, prints rosters
 *   node scripts/crawl-tft-tpc-roster.mjs --set "Space Gods"  # override set name
 *   node scripts/crawl-tft-tpc-roster.mjs --region AMER   # single region
 *   node scripts/crawl-tft-tpc-roster.mjs --verbose
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { proRowFilter } from './lib/pro-row-filter.mjs';
// Shared Liquipedia helper — cross-process rate-limit lock + ETag cache +
// template parser. Replaces the local copies of liquipediaJson +
// findAllTemplates we used to keep here so this script doesn't drift
// from the rest of the pipeline.
import {
  liquipediaJson as sharedLiquipediaJson,
  liquipediaCategoryMembers,
  findAllTemplates as sharedFindAllTemplates,
} from './lib/liquipedia-tft.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const SKIP_SUPABASE = hasFlag('--no-supabase');
const VERBOSE = hasFlag('--verbose');
const REGION_FILTER = arg('--region', null);   // AMER | APAC | EMEA | CN | null
const SET_OVERRIDE = arg('--set', null);

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
const LIQUIPEDIA_DELAY_MS = 2100;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';
const REGIONS = ['AMER', 'APAC', 'EMEA', 'CN'];

// ─── env ─────────────────────────────────────────────────────────────────
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

// Re-bind shared helpers under the names this script already uses internally,
// so the call-sites below stay readable without further renames.
const liquipediaJson = sharedLiquipediaJson;
const findAllTemplates = sharedFindAllTemplates;

// ─── Set + cup discovery ─────────────────────────────────────────────────
function resolveCurrentSetName() {
  if (SET_OVERRIDE) return SET_OVERRIDE;
  const setJson = resolve(process.cwd(), 'public/tft-set.json');
  if (!existsSync(setJson)) {
    console.error('public/tft-set.json missing — pass --set "Space Gods" explicitly');
    process.exit(1);
  }
  const j = JSON.parse(readFileSync(setJson, 'utf8'));
  return j.name || j.setName || null;
}

// The TPC follows a three-cup pattern per set per region. Names rotate per
// set (Set 17 = Dark Star / Anima / Stargazer; Set 16 was Bilgewater / Shurima /
// Demacia). We discover the actual cup names by enumerating Liquipedia's
// S-Tier category and filtering by "<set>/TFT_Pro_Circuit/<region>/" prefix.
async function discoverCupPagesForSet(setName) {
  const setPrefix = setName.replace(/ /g, '_');
  // Shared helper paginates cmcontinue + respects the global rate-limit gate.
  const raw = await liquipediaCategoryMembers('S-Tier_Tournaments');
  const titles = raw.map(t => t.replace(/ /g, '_'));
  const byRegion = { AMER: [], APAC: [], EMEA: [], CN: [] };
  for (const t of titles) {
    if (!t.startsWith(`${setPrefix}/`)) continue;
    if (!t.includes('TFT_Pro_Circuit/')) continue;
    for (const r of REGIONS) {
      if (t.includes(`/${r}/`)) { byRegion[r].push(t); break; }
    }
  }
  return byRegion;
}

// ─── Roster extraction from a single cup page ────────────────────────────
function extractRosterFromWikitext(wikitext) {
  // Strategy: pull every {{SoloOpponent|Name|…}} entry that sits inside a
  // {{Slot|…|{{SoloOpponent|…}}}} or {{SoloPrizePool|…}} block. Standings &
  // bracket rounds reuse the same template, so a unique-by-name dedupe per
  // page yields the cup's full participant list.
  const seen = new Set();
  const out = [];
  for (const opp of findAllTemplates(wikitext, 'SoloOpponent')) {
    // Body is "Name|flag=xx" or "Name|2=…". First positional arg = name.
    const firstPart = opp.body.split('|')[1] || opp.body.split('|')[0] || '';
    const name = firstPart.trim();
    if (!name) continue;
    // Skip placeholders ({{SoloOpponent|TBD}}, |1=Bye|…) without flagging them.
    if (/^(TBD|Bye|TBA)$/i.test(name)) continue;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
  }
  return out;
}

// ─── Supabase ────────────────────────────────────────────────────────────
async function sbFetch(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'POST' ? 'return=minimal' : '',
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

async function loadAllPros() {
  return sbFetch('tft_pro_players?select=id,puuid,pro_name,region,tpc_verified,tpc_region');
}

// Case-insensitive name → tft_pro_players match. Liquipedia stores e.g.
// "k3soju" while we may have "K3soju" (capitalized by Liquipedia auto-link).
// pro_name is the source-of-truth for matching; we don't try riot_id here
// because TPC standings don't include taglines.
function buildNameIndex(pros) {
  const m = new Map();
  for (const p of pros) m.set(p.pro_name.toLowerCase(), p);
  return m;
}

async function upsertTpcFlag(pro, region) {
  await sbFetch(`tft_pro_players?${proRowFilter(pro)}`, {
    method: 'PATCH',
    body: JSON.stringify({
      tpc_verified: true,
      tpc_region: region,
      // Drop a confidence floor so newly-TPC pros don't surface as 0-score
      // until the classifier runs. The classifier will recompute properly.
      confidence_score: 40,
      classification: 'tpc',
    }),
  });
}

async function logValidation(runId, status, source, proName, severity, detail) {
  if (SKIP_SUPABASE) return;
  await sbFetch('tft_pro_validation_log', {
    method: 'POST',
    body: JSON.stringify({
      validation_run_id: runId,
      pro_name: proName,
      source,
      status,
      severity,
      detail,
      field: 'identity',
    }),
  });
}

// Resume-cache lives outside the repo (don't risk committing it). Lets the
// script pick up where a previous 429-cut run left off without re-fetching
// pages we already have.
const CACHE_PATH = resolve(tmpdir(), 'metastats-tpc-roster-cache.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;   // 6h

function readCache() {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    const c = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    if (Date.now() - (c.ts || 0) > CACHE_TTL_MS) return null;
    return c;
  } catch { return null; }
}
function writeCache(payload) {
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify({ ts: Date.now(), ...payload }, null, 2));
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  const setName = resolveCurrentSetName();
  if (!setName) { console.error('Cannot resolve set name'); process.exit(1); }
  console.log(`=== TPC roster crawl — set: ${setName} ===`);

  const runId = randomUUID();
  const cache = readCache();
  const cacheValid = cache && cache.setName === setName;

  let cupsByRegion;
  if (cacheValid && cache.cupsByRegion) {
    console.log(`(using cached cup-discovery from ${new Date(cache.ts).toISOString()})`);
    cupsByRegion = cache.cupsByRegion;
  } else {
    cupsByRegion = await discoverCupPagesForSet(setName);
    writeCache({ setName, cupsByRegion, rostersByRegion: {} });
  }

  const rostersByRegion = (cacheValid && cache.rostersByRegion) || {};
  for (const region of REGIONS) {
    if (REGION_FILTER && region !== REGION_FILTER) continue;
    if (rostersByRegion[region]?.length > 0 && !hasFlag('--refresh')) {
      console.log(`[${region}] reusing cached roster (${rostersByRegion[region].length} pros)`);
      continue;
    }
    const cups = cupsByRegion[region];
    if (!cups || cups.length === 0) {
      console.log(`[${region}] no cup pages discovered`);
      continue;
    }
    const roster = new Set();
    console.log(`[${region}] ${cups.length} cup(s): ${cups.map(c => c.split('/').pop()).join(', ')}`);
    for (const cupPage of cups) {
      // Rate-limit handled inside the shared liquipediaJson gate.
      const j = await liquipediaJson({ action: 'parse', page: cupPage, prop: 'wikitext' });
      const wt = j?.parse?.wikitext?.['*'] || '';
      const names = extractRosterFromWikitext(wt);
      if (VERBOSE) console.log(`  [${cupPage.split('/').pop()}] ${names.length} participants`);
      for (const n of names) roster.add(n);
    }
    rostersByRegion[region] = [...roster];
    console.log(`[${region}] unique roster: ${roster.size} pros`);
    // Persist after each region — partial progress survives 429-cuts.
    writeCache({ setName, cupsByRegion, rostersByRegion });
  }

  if (SKIP_SUPABASE) {
    for (const region of Object.keys(rostersByRegion)) {
      console.log(`\n[${region}] ${rostersByRegion[region].length} pros:`);
      console.log('  ' + rostersByRegion[region].slice(0, 20).join(', ') + (rostersByRegion[region].length > 20 ? ' …' : ''));
    }
    return;
  }

  // Match against existing tft_pro_players + write tpc_verified flags.
  const existing = await loadAllPros();
  const byName = buildNameIndex(existing);

  let matched = 0, unmatched = 0;
  const unmatchedByRegion = {};
  for (const [region, names] of Object.entries(rostersByRegion)) {
    unmatchedByRegion[region] = [];
    for (const name of names) {
      const pro = byName.get(name.toLowerCase());
      if (!pro) {
        unmatched++;
        unmatchedByRegion[region].push(name);
        await logValidation(runId, 'missing', 'competetft_via_liquipedia', name, 3,
          `TPC ${region} roster member not in tft_pro_players — needs Riot-ID/PUUID resolution via the regular Liquipedia crawl`);
        continue;
      }
      await upsertTpcFlag(pro, region);
      matched++;
    }
  }
  console.log(`\nMatched: ${matched} | Unmatched: ${unmatched}`);
  for (const [region, names] of Object.entries(unmatchedByRegion)) {
    if (names.length === 0) continue;
    console.log(`  [${region}] missing from DB (${names.length}): ${names.slice(0, 8).join(', ')}${names.length > 8 ? ' …' : ''}`);
  }
  console.log(`\nValidation run-id: ${runId}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});

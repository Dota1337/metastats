#!/usr/bin/env node
/**
 * Discovery-Crawler — vergleicht die Liquipedia-Spielerseiten in MEHREREN
 * Country-Categories gegen unseren tft_pro_players-Stand und identifiziert
 * Pros die in Liquipedia existieren aber bei uns fehlen.
 *
 * Warum nicht nur Category:Players?
 *   Die Hauptkategorie ist in der TFT-Wiki nicht zwingend vollständig — manche
 *   Top-Pros aus CN/KR/JP sind nur in den jeweiligen Country-Sub-Categories
 *   verlinkt. Diese Lücke ist warum unser ursprünglicher Crawler 252 Pros
 *   fängt, Portal:Statistics 2026 aber Pros wie Huanmie/diaomei/LiShao listet
 *   die wir gar nicht kennen.
 *
 * Workflow:
 *   1. Enumeriert konfigurierbare Categories (Default: Korean / Chinese /
 *      Japanese / Vietnamese / North_American / European / Brazilian).
 *   2. Bildet die Vereinigung über alle Categories.
 *   3. Lädt tft_pro_players.source_page als bekannte Menge.
 *   4. Loggt für jede fehlende Page einen Validation-Event (severity 3,
 *      field=identity, status=missing) — die nächste Ausführung von
 *      `crawl-tft-pro-players.mjs --resolve-missing` (siehe TODO unten)
 *      würde sie dann auflösen.
 *
 * Hinweis: dieses Skript löst die fehlenden Pros NICHT direkt auf. Das
 * Riot-ID-Lookup (account-v1 + summoner-v1) sitzt im bestehenden Pro-Crawler
 * und wird hier nicht dupliziert — wir bauen nur die Discovery-Liste. Sobald
 * ein --resolve-missing-Flag in crawl-tft-pro-players landet, kann dieses
 * Skript dort vorher mit --feed laufen.
 *
 * Usage:
 *   node scripts/crawl-tft-pro-categories.mjs
 *   node scripts/crawl-tft-pro-categories.mjs --categories Korean,Chinese,Japanese
 *   node scripts/crawl-tft-pro-categories.mjs --no-supabase --verbose
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { liquipediaCategoryMembers } from './lib/liquipedia-tft.mjs';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

// Default category set — covers the regions where TPC volume is concentrated.
// Add new ones via --categories at runtime; the canonical Liquipedia names
// use underscores instead of spaces.
const DEFAULT_CATEGORIES = [
  'Players',                  // master list — always include
  'Korean_Players',
  'Chinese_Players',
  'Japanese_Players',
  'Vietnamese_Players',
  'North_American_Players',
  'European_Players',
  'German_Players',
  'French_Players',
  'British_Players',
  'Brazilian_Players',
  'Russian_Players',
  'Taiwanese_Players',
];

const SELECTED = arg('--categories', '')
  ? arg('--categories', '').split(',').map(s => s.trim()).filter(Boolean)
  : DEFAULT_CATEGORIES;

const SKIP_SUPABASE = hasFlag('--no-supabase');
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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
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

async function main() {
  const runId = randomUUID();
  console.log(`=== Liquipedia Category Discovery — run ${runId} ===`);
  console.log(`Categories: ${SELECTED.join(', ')}`);

  // 1. Build union over all categories.
  const seen = new Map();    // pageTitle → first category it appeared in
  for (const cat of SELECTED) {
    try {
      const pages = await liquipediaCategoryMembers(cat);
      console.log(`  ${cat}: ${pages.length} pages`);
      for (const p of pages) {
        if (!seen.has(p)) seen.set(p, cat);
      }
    } catch (e) {
      console.warn(`  [skip] ${cat}: ${e.message}`);
    }
  }
  console.log(`\nTotal unique pages across categories: ${seen.size}`);

  // 2. Compare to existing tft_pro_players.source_page.
  let knownPages = new Set();
  if (!SKIP_SUPABASE) {
    const pros = await sb('tft_pro_players?select=source_page');
    knownPages = new Set(
      pros.map(p => p.source_page).filter(Boolean).map(s => s.replace(/_/g, ' '))
    );
    console.log(`Known in DB: ${knownPages.size}`);
  }

  // 3. Diff: pages we don't have yet.
  const missing = [];
  for (const [page, cat] of seen.entries()) {
    if (knownPages.has(page)) continue;
    missing.push({ page, cat });
  }
  console.log(`\nMissing from DB: ${missing.length}`);
  if (VERBOSE || missing.length <= 30) {
    for (const m of missing.slice(0, 30)) {
      console.log(`  [${m.cat}] ${m.page}`);
    }
    if (missing.length > 30) console.log(`  …and ${missing.length - 30} more`);
  }

  if (SKIP_SUPABASE) return;

  // 4. Log each missing pro as a validation event so the watchdog dashboard
  // surfaces them for the next backfill. We chunk the inserts into batches
  // of 50 so a 400-row payload doesn't tip PostgREST's body cap.
  const events = missing.map(m => ({
    validation_run_id: runId,
    pro_name: m.page,
    source: 'liquipedia_category',
    status: 'missing',
    severity: 3,
    field: 'identity',
    actual: { page: m.page, category: m.cat },
    detail: `Liquipedia ${m.cat} lists "${m.page}" but tft_pro_players has no matching row — needs Riot-ID resolution`,
  }));
  for (let i = 0; i < events.length; i += 50) {
    await sb('tft_pro_validation_log', {
      method: 'POST',
      body: JSON.stringify(events.slice(i, i + 50)),
    });
  }
  console.log(`\n${events.length} validation events logged (run ${runId})`);
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });

#!/usr/bin/env node
/**
 * Sync today's marketvalue snapshots + per-set season stats from the
 * Hetzner Postgres to Supabase. Runs after collect-tft-marketvalues.mjs.
 *
 * Only the aggregated outputs are mirrored — the raw match cache stays on
 * Hetzner. Supabase keeps the same schema it already had so the Vercel API
 * doesn't need any changes.
 *
 * Usage:
 *   node scripts/sync-marketvalue-to-supabase.mjs
 *   node scripts/sync-marketvalue-to-supabase.mjs --date 2026-05-14
 *   node scripts/sync-marketvalue-to-supabase.mjs --region euw1
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { assertContracts } from './lib/contracts.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

// --date is the upper-bound day to sync; --window is how many days back to
// include from there. Default 7d catches large regions whose crawl spans
// >24h (euw1/na1/kr/vn2 all routinely take 18-30h, so a "today only" sync
// would silently drop everything from yesterday's pass). --since X is a
// shortcut for --window N where N = today - X.
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const WINDOW_DAYS = Math.max(1, parseInt(arg('--window', '7'), 10));
const SINCE = arg('--since', null);   // YYYY-MM-DD, sets effective window
const REGION_FILTER = arg('--region', null);
const VERBOSE = args.includes('--verbose');

// Effective sync range: [LOWER_BOUND, DATE]
const LOWER_BOUND = SINCE || new Date(Date.parse(DATE) - WINDOW_DAYS * 86_400_000)
  .toISOString().slice(0, 10);

function loadEnv() {
  const candidates = ['/etc/metastats-crawler/env', resolve(process.cwd(), '.env.local')];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.includes('=') || line.startsWith('#')) continue;
      const i = line.indexOf('=');
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!process.env[k]) process.env[k] = v;
    }
    break;
  }
}
loadEnv();

const DATABASE_URL = process.env.DATABASE_URL;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DATABASE_URL || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing DATABASE_URL / SUPABASE_* env vars');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3, statement_timeout: 60_000 });
const BATCH = 200;

async function supaUpsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const url = `${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(15_000),
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
  }
}

async function syncSnapshots() {
  // Range filter so cross-day cluster runs (euw1, na1, kr, vn2 all need
  // 18-30h) actually land in Supabase. Previous behaviour was `= $1` which
  // silently dropped yesterday's snapshots when the cluster sync ran the
  // next morning — that's how euw1 lost 7733 snapshots on 2026-06-06.
  const where = REGION_FILTER
    ? 'where snapshot_date >= $1::date and snapshot_date <= $2::date and region = $3'
    : 'where snapshot_date >= $1::date and snapshot_date <= $2::date';
  const params = REGION_FILTER ? [LOWER_BOUND, DATE, REGION_FILTER] : [LOWER_BOUND, DATE];
  const r = await pool.query(
    // set_number und games_played MUESSEN mit: PostgREST baut die
    // Spaltenliste des Upserts aus den Payload-Keys, eine hier ausgelassene
    // Spalte landet beim INSERT auf ihrem Default (NULL). Genau so sind ab
    // dem Set-18-Start 31.521 Supabase-Zeilen ohne set_number entstanden —
    // die Leser filtern auf CURRENT_SET und fielen deshalb auf die
    // Live-Rechnung mit 30 Spielen zurueck (gemessen 30.08.2026).
    `select puuid, region, snapshot_date, set_number, game_name, tag_line, tier, rank, lp,
            ladder_rank, base_value, multiplier::float8, final_value, sample_size,
            damping::float8, agents, games_played
       from tft_player_marketvalue_snapshots
       ${where}`,
    params,
  );
  console.log(`[snapshots] ${r.rows.length} rows for ${LOWER_BOUND}…${DATE}${REGION_FILTER ? ` / ${REGION_FILTER}` : ''}`);
  // Normalize snapshot_date to YYYY-MM-DD string (pg returns Date object)
  const rows = r.rows.map(row => ({
    ...row,
    snapshot_date: row.snapshot_date instanceof Date
      ? row.snapshot_date.toISOString().slice(0, 10)
      : row.snapshot_date,
  }));
  await supaUpsert('tft_player_marketvalue_snapshots', rows, 'puuid,region,snapshot_date');
  console.log(`[snapshots] pushed ${rows.length} → Supabase`);
}

async function syncSeasonStats() {
  // Same range expansion as snapshots — a cluster that finishes the next day
  // would otherwise skip yesterday's player rows.
  const where = REGION_FILTER
    ? "where updated_at >= $1::date and region = $2"
    : "where updated_at >= $1::date";
  const params = REGION_FILTER ? [LOWER_BOUND, REGION_FILTER] : [LOWER_BOUND];
  const r = await pool.query(
    `select puuid, region, set_number, sample_size,
            avg_placement::float8, top4_rate::float8, top1_rate::float8,
            bottom4_rate::float8, placement_stddev::float8, best_top4_streak,
            unique_comps, dominant_share::float8, meta_pick_share::float8,
            item_slam_score::float8, first_match_at, last_match_at, updated_at
       from tft_player_season_stats
       ${where}`,
    params,
  );
  console.log(`[season_stats] ${r.rows.length} rows updated since ${DATE}`);
  await supaUpsert('tft_player_season_stats', r.rows, 'puuid,region,set_number');
  console.log(`[season_stats] pushed ${r.rows.length} → Supabase`);
}

async function main() {
  console.log(`=== Hetzner → Supabase sync (range ${LOWER_BOUND} … ${DATE}) ===`);
  await syncSnapshots();
  if (VERBOSE) console.log('---');
  try {
    await syncSeasonStats();
  } catch (err) {
    // season_stats table might not exist on Supabase yet — non-fatal
    if (/relation .* does not exist/i.test(err.message)) {
      console.warn(`[season_stats] Supabase table missing — skipping (apply migration 0011 first)`);
    } else throw err;
  }
  await pool.end();

  // Laufzeit-Vertrag: ist der Spiegel wirklich angekommen? Genau dieser Check
  // hätte den toten Sync ab Ende Juli am ersten Tag sichtbar gemacht, statt
  // ihn zwei Wochen später zufällig aufzudecken.
  await assertContracts(['marketvalue/supabase-mirror', 'marketvalue/sync-parity', 'set-achse/marktwert-snapshots'])
    .catch(err => console.error('[contract] Prüfung fehlgeschlagen:', err.message));
}

main().catch(err => {
  console.error('FAIL:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});

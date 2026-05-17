#!/usr/bin/env node
/**
 * Incremental aggregator: reads new tft_position_observations from
 * Supabase, resolves the comp_cluster_key for each (match_id, observer
 * puuid) by joining against the local Hetzner match cache, and upserts
 * the comp-bound cell-count into tft_position_comp_cell.
 *
 * Runs on Hetzner via a systemd timer (separate from the marketvalue +
 * daily-crawl ones) at a low frequency — twice an hour is comfortably
 * fresh because the companion app submits at match-end, not in real
 * time.
 *
 * Idempotent via the primary key (cluster_key, unit, cell): re-running
 * the aggregator overlapping with the previous run produces no
 * duplicates; the high-water mark in tft_position_aggregator_state
 * just minimises the read window.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

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

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const HETZNER_DB = process.env.DATABASE_URL;
if (!SUPA_URL || !SUPA_KEY) { console.error('SUPABASE env vars required'); process.exit(1); }
if (!HETZNER_DB) { console.error('DATABASE_URL required'); process.exit(1); }

const BATCH_SIZE = 1000;
const SOURCE_KEY = 'tft_position_observations';

const pool = new pg.Pool({ connectionString: HETZNER_DB, max: 3 });

async function supaSelect(table, query) {
  const url = `${SUPA_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!res.ok) throw new Error(`Supabase ${table} GET: HTTP ${res.status}`);
  return res.json();
}

async function supaUpsert(table, rows, onConflict) {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const res = await fetch(`${SUPA_URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: SUPA_KEY,
        Authorization: `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table}: HTTP ${res.status} ${await res.text()}`);
  }
}

async function getHighWaterMark() {
  const j = await supaSelect('tft_position_aggregator_state',
    `source=eq.${SOURCE_KEY}&select=last_observed_at`);
  return j[0]?.last_observed_at || '1970-01-01T00:00:00Z';
}

async function setHighWaterMark(ts) {
  await supaUpsert('tft_position_aggregator_state',
    [{ source: SOURCE_KEY, last_observed_at: ts, last_run_at: new Date().toISOString() }],
    'source');
}

async function resolveClusterKey(matchId, puuid) {
  // tft_player_match_cache lives on the Hetzner Postgres. comp_cluster_key
  // is computed by the marketvalue crawler when it ingests a match.
  const r = await pool.query(
    `select comp_cluster_key
       from tft_player_match_cache
       where match_id = $1 and puuid = $2
       limit 1`,
    [matchId, puuid],
  );
  return r.rows[0]?.comp_cluster_key || null;
}

async function processBatch(batch) {
  const aggregates = new Map(); // key = `${cluster_key}|${unit}|${cell}` → { cluster_key, unit, cell, count, matches: Set }
  const seenMatchClusters = new Map(); // (match_id, puuid) → cluster_key

  for (const obs of batch) {
    if (obs.kind !== 'own') continue; // start with own boards; opponent positions need a different join
    const cacheKey = `${obs.match_id}|${obs.observer_puuid}`;
    let clusterKey = seenMatchClusters.get(cacheKey);
    if (clusterKey === undefined) {
      clusterKey = await resolveClusterKey(obs.match_id, obs.observer_puuid);
      seenMatchClusters.set(cacheKey, clusterKey);
    }
    if (!clusterKey) continue;

    const k = `${clusterKey}|${obs.unit}|${obs.cell}`;
    const e = aggregates.get(k) || { cluster_key: clusterKey, unit: obs.unit, cell: obs.cell, observations: 0, matches: new Set() };
    e.observations += 1;
    e.matches.add(obs.match_id);
    aggregates.set(k, e);
  }

  if (aggregates.size === 0) return 0;

  // Convert to upsert rows. distinct_matches counts unique match_ids in
  // THIS batch — Supabase's INSERT ON CONFLICT can't increment a count of
  // unique values, so we settle for additive observations + best-effort
  // distinct_matches that under-counts when matches span batches.
  // Acceptable trade for the MVP.
  const rows = [...aggregates.values()].map(e => ({
    cluster_key: e.cluster_key,
    unit: e.unit,
    cell: e.cell,
    observations: e.observations,
    distinct_matches: e.matches.size,
    last_observed_at: new Date().toISOString(),
  }));

  // The upsert merges by primary key but we want observations + distinct_matches
  // to be additive. Supabase REST doesn't expose ON CONFLICT DO UPDATE with
  // expressions like `observations = excluded.observations + tbl.observations`
  // from a single call, so we read-modify-write per batch.
  const keys = rows.map(r => `(${JSON.stringify(r.cluster_key)},${JSON.stringify(r.unit)},${r.cell})`);
  const existingRows = await supaSelect('tft_position_comp_cell',
    `select=cluster_key,unit,cell,observations,distinct_matches&` +
    `and=(cluster_key.in.(${[...new Set(rows.map(r => JSON.stringify(r.cluster_key)))].join(',')}),` +
    `unit.in.(${[...new Set(rows.map(r => JSON.stringify(r.unit)))].join(',')}),` +
    `cell.in.(${[...new Set(rows.map(r => r.cell))].join(',')}))`
  ).catch(() => []);
  const existing = new Map();
  for (const r of existingRows) {
    existing.set(`${r.cluster_key}|${r.unit}|${r.cell}`, r);
  }

  const merged = rows.map(r => {
    const prev = existing.get(`${r.cluster_key}|${r.unit}|${r.cell}`);
    return prev
      ? {
          ...r,
          observations: r.observations + Number(prev.observations || 0),
          distinct_matches: r.distinct_matches + Number(prev.distinct_matches || 0),
        }
      : r;
  });

  await supaUpsert('tft_position_comp_cell', merged, 'cluster_key,unit,cell');
  return merged.length;
}

async function main() {
  const since = await getHighWaterMark();
  console.log(`reading observations since ${since}`);
  const observations = await supaSelect('tft_position_observations',
    `observed_at=gt.${encodeURIComponent(since)}&order=observed_at.asc&limit=${BATCH_SIZE}`);
  console.log(`fetched ${observations.length} observations`);
  if (observations.length === 0) {
    await pool.end();
    return;
  }
  const written = await processBatch(observations);
  console.log(`upserted ${written} (cluster, unit, cell) aggregates`);
  await setHighWaterMark(observations[observations.length - 1].observed_at);
  await pool.end();
}

main().catch(err => {
  console.error('FAIL:', err.message);
  console.error(err.stack);
  pool.end().catch(() => {});
  process.exit(1);
});

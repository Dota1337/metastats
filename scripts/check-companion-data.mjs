#!/usr/bin/env node
/**
 * Quick live-status helper to verify the Overwolf Companion app is
 * submitting observations. Run from repo root:
 *   node scripts/check-companion-data.mjs
 * Optional flag --watch to refresh every 30 s.
 *
 * Reads tft_position_observations and prints:
 *   - total rows
 *   - rows in the last 24h
 *   - distinct match-IDs in the last 24h
 *   - the 5 most recent match-IDs with their observation counts
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error('SUPABASE env vars required (.env.local)');
  process.exit(1);
}

const headers = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

async function count(query) {
  const res = await fetch(`${SUPA_URL}/rest/v1/tft_position_observations?${query}`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = res.headers.get('content-range') || '0';
  return Number(range.split('/')[1] || 0);
}

async function recent(limit = 5) {
  const res = await fetch(
    `${SUPA_URL}/rest/v1/tft_position_observations?select=match_id,observed_at,region,observer_puuid&order=observed_at.desc&limit=200`,
    { headers },
  );
  if (!res.ok) return [];
  const rows = await res.json();
  const grouped = new Map();
  for (const r of rows) {
    const key = `${r.match_id}|${r.region || ''}|${(r.observer_puuid || '').slice(0, 8)}`;
    const e = grouped.get(key) || {
      matchId: r.match_id,
      region: r.region,
      observer: (r.observer_puuid || '').slice(0, 8),
      count: 0,
      latest: r.observed_at,
    };
    e.count += 1;
    if (r.observed_at > e.latest) e.latest = r.observed_at;
    grouped.set(key, e);
  }
  return [...grouped.values()].sort((a, b) => b.latest.localeCompare(a.latest)).slice(0, limit);
}

async function dashboard() {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const since1h = new Date(now.getTime() - 60 * 60 * 1000).toISOString();

  const [total, last24h, last1h] = await Promise.all([
    count('select=match_id'),
    count(`observed_at=gte.${encodeURIComponent(since24h)}`),
    count(`observed_at=gte.${encodeURIComponent(since1h)}`),
  ]);
  const top = await recent(5);

  console.clear?.();
  console.log(`=== metastats.gg Companion · live status @ ${now.toISOString()} ===`);
  console.log(`  total observations         : ${total.toLocaleString('de-DE')}`);
  console.log(`  last 24h                   : ${last24h.toLocaleString('de-DE')}`);
  console.log(`  last 1h                    : ${last1h.toLocaleString('de-DE')}`);
  console.log('');
  if (top.length === 0) {
    console.log('  no recent submissions — waiting for the companion app to send data.');
  } else {
    console.log('  most recent matches:');
    for (const m of top) {
      console.log(`   • ${m.matchId.padEnd(20)} ${(m.region || '???').padEnd(5)} obs=${String(m.count).padStart(4)} observer=${m.observer} @ ${m.latest}`);
    }
  }
  console.log('');
}

const watch = process.argv.includes('--watch');

async function main() {
  if (watch) {
    while (true) {
      try { await dashboard(); } catch (e) { console.error('error:', e.message); }
      await new Promise(r => setTimeout(r, 30_000));
    }
  } else {
    await dashboard();
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

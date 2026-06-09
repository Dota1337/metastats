#!/usr/bin/env node
/**
 * Klassifiziert jeden tft_pro_players-Row in eine der fünf Stufen:
 *   tpc        — in competetft.com TPC-Standings (höchstes Trust-Level)
 *   tournament — ≥1 tournament_result UND last_tournament_at ≥ NOW-365d
 *   streamer   — aktive Streamer (Twitch/Chzzk/Bilibili/YouTube) UND Master+ Rank
 *   historic   — ≥1 tournament_result aber älter als 365d, keine Aktivität
 *   inactive   — nichts davon zutreffend (Default ausgeblendet)
 *
 * Und berechnet einen Confidence-Score 0-100 als Summe gewichteter Signale.
 * Die Pros-Page sortiert nach (tpc_verified DESC, confidence_score DESC).
 *
 * Pure-Logic-Skript — kein externer Call. Läuft schnell (~1s pro 255 Pros),
 * kann nach jedem Enrich-Lauf neu durchrollen.
 *
 * Usage:
 *   node scripts/classify-tft-pros.mjs                # full reclassify
 *   node scripts/classify-tft-pros.mjs --dry          # print plan, no writes
 *   node scripts/classify-tft-pros.mjs --verbose
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const hasFlag = (k) => args.includes(k);
const DRY = hasFlag('--dry');
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
if (!SUPA_URL || !SUPA_KEY) { console.error('Supabase env required'); process.exit(1); }

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'PATCH' ? 'return=minimal' : '',
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

// Anchor for "active in the last 12 months". A pro with tournaments only
// older than this falls into "historic" (visible behind opt-in toggle).
const ACTIVE_WINDOW_DAYS = 365;

function lastTournamentDate(results) {
  if (!Array.isArray(results) || results.length === 0) return null;
  // tournament_results entries have { date: "2024-11-23", ... }. Parse all and
  // take the max — community-edited rows can be out-of-order.
  let max = null;
  for (const r of results) {
    if (!r.date) continue;
    const d = new Date(r.date);
    if (isNaN(d)) continue;
    if (!max || d > max) max = d;
  }
  return max;
}

function classifyAndScore(p, now = new Date()) {
  const tournamentResults = Array.isArray(p.tournament_results) ? p.tournament_results : [];
  const totalEarnings = Number(p.total_earnings_usd) || 0;
  const earningsSources = p.earnings_sources || {};
  const streams = p.stream_platforms || {};
  const hasStream = !!(p.twitch_handle || p.youtube_handle || p.twitter_handle
    || streams.twitch || streams.chzzk || streams.bilibili || streams.afreeca);

  const lastTourn = lastTournamentDate(tournamentResults);
  const daysSinceTourn = lastTourn ? (now - lastTourn) / 86_400_000 : Infinity;
  const recentTournament = daysSinceTourn <= ACTIVE_WINDOW_DAYS;

  const rank = (p.active_rank_tier || '').toLowerCase();
  const isMasterPlus = ['master', 'grandmaster', 'challenger'].includes(rank);

  // Classification cascade — first match wins.
  let classification;
  if (p.tpc_verified) classification = 'tpc';
  else if (tournamentResults.length >= 1 && recentTournament) classification = 'tournament';
  else if (hasStream && isMasterPlus) classification = 'streamer';
  else if (tournamentResults.length >= 1) classification = 'historic';
  else classification = 'inactive';

  // Confidence-Score 0-100, weighted by signal strength.
  let score = 0;
  if (p.tpc_verified) score += 40;
  if (tournamentResults.length >= 1) score += 10;
  if (recentTournament) score += 15;
  // Cross-source agreement: count distinct earning sources with non-zero value.
  const sourceCount = Object.values(earningsSources).filter(v => Number(v) > 0).length;
  if (sourceCount >= 2) score += 15;
  else if (sourceCount === 1) score += 5;
  if (isMasterPlus) score += 10;
  if (hasStream) score += 5;
  if (p.real_name && p.country) score += 5;
  // Total earnings as a mild tie-breaker — bands so the score stays
  // interpretable rather than scaling linearly with dollars.
  if (totalEarnings >= 50_000) score += 10;
  else if (totalEarnings >= 10_000) score += 5;
  else if (totalEarnings >= 1_000) score += 2;

  score = Math.min(100, Math.max(0, score));

  return { classification, score, lastTournamentAt: lastTourn };
}

async function main() {
  const pros = await sb('tft_pro_players?select=puuid,pro_name,tpc_verified,tournament_results,total_earnings_usd,earnings_sources,stream_platforms,twitch_handle,youtube_handle,twitter_handle,active_rank_tier,real_name,country');
  console.log(`Classifying ${pros.length} pros…`);

  const counts = {};
  let updates = 0;
  for (const p of pros) {
    const { classification, score, lastTournamentAt } = classifyAndScore(p);
    counts[classification] = (counts[classification] || 0) + 1;
    if (VERBOSE) console.log(`  ${p.pro_name.padEnd(25)} ${classification.padEnd(10)} score=${score}`);
    if (!DRY) {
      await sb(`tft_pro_players?puuid=eq.${encodeURIComponent(p.puuid)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          classification,
          confidence_score: score,
          last_tournament_at: lastTournamentAt ? lastTournamentAt.toISOString().slice(0, 10) : null,
          last_full_validation_at: new Date().toISOString(),
        }),
      });
      updates++;
    }
  }
  console.log(`\nResults:`);
  for (const k of ['tpc', 'tournament', 'streamer', 'historic', 'inactive']) {
    console.log(`  ${k.padEnd(11)} ${counts[k] || 0}`);
  }
  console.log(DRY ? '\n(dry — no writes)' : `\n${updates} pros updated`);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });

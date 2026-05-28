#!/usr/bin/env node
/**
 * Hetzner-side orchestrator for the LoL high-elo marketvalue refresh.
 *
 * Why this exists instead of a cron timer: the LoL key (RIOT_API_KEY) is a dev
 * key that expires every 24h. A standalone weekly timer almost always fires
 * with a stale key — that's exactly why the old GitHub "Market Value Refresh"
 * workflow failed most weeks (HTTP 401 in the pre-flight). So this service is
 * *kicked* by scripts/refresh-riot-key.mjs right after that script validates a
 * freshly rotated key against Riot (HTTP 200) — the one moment the key is
 * guaranteed valid.
 *
 * To keep the cadence ~weekly (key rotation happens ~daily), this wrapper
 * self-throttles: it no-ops unless the last successful full pass was
 * >= --min-days ago. The stamp lives in /etc/metastats-crawler/ (outside the
 * git-reset path, so `git clean -fd` on deploy can't wipe it — same reason the
 * marketvalue region cursor lives there).
 *
 * The heavy compute happens on Vercel via /api/summoner; this box only
 * enumerates the Challenger/GM leagues (needs the LoL key) and paces the calls.
 *
 * Usage (normally invoked by systemd / refresh-riot-key.mjs):
 *   node scripts/lol-marketvalue-weekly.mjs
 *   node scripts/lol-marketvalue-weekly.mjs --force                          # ignore throttle
 *   node scripts/lol-marketvalue-weekly.mjs --regions euw1,kr --min-days 6
 *   node scripts/lol-marketvalue-weekly.mjs --force --regions euw1 --limit 1 # smoke test (no stamp write)
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const getArg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };
const hasFlag = (k) => args.includes(k);

const REGIONS = getArg('--regions', 'euw1,kr').split(',').map(s => s.trim()).filter(Boolean);
const MIN_DAYS = Number(getArg('--min-days', '6'));
const BASE_URL = getArg('--url', 'https://metastats.gg');
const LIMIT = getArg('--limit', null);   // smoke-test cap; when set, the stamp is NOT written
const FORCE = hasFlag('--force');
const STAMP = process.env.LOL_MV_STAMP || '/etc/metastats-crawler/lol-mv-last-run';

const log = (msg) => console.log(`[lol-mv ${new Date().toISOString()}] ${msg}`);

function lastRunMs() {
  if (!existsSync(STAMP)) return 0;
  try { return Date.parse(readFileSync(STAMP, 'utf8').trim()) || 0; } catch { return 0; }
}

// Throttle gate — keeps the effective cadence weekly even though the kick
// arrives on every key rotation.
const last = lastRunMs();
if (!FORCE && last > 0) {
  const ageDays = (Date.now() - last) / 86_400_000;
  if (ageDays < MIN_DAYS) {
    log(`throttled: last pass ${ageDays.toFixed(2)}d ago (< ${MIN_DAYS}d) — skipping.`);
    process.exit(0);
  }
}

if (!process.env.RIOT_API_KEY) {
  log('RIOT_API_KEY not set in env — aborting.');
  process.exit(1);
}

log(`starting pass: regions=${REGIONS.join(',')} url=${BASE_URL}${LIMIT ? ` limit=${LIMIT}` : ''}`);

let failures = 0;
for (const region of REGIONS) {
  const a = ['scripts/refresh-highelo-marketvalues.mjs', '--gm', '--top-per-tier', '50', '--url', BASE_URL, '--region', region];
  if (LIMIT) a.push('--limit', String(LIMIT));
  log(`region ${region}: node ${a.join(' ')}`);
  const r = spawnSync('node', a, { stdio: 'inherit' });
  if (r.status !== 0) { failures++; log(`region ${region} FAILED (exit ${r.status})`); }
}

if (failures > 0) {
  log(`done with ${failures} region failure(s) — NOT updating throttle stamp (retries on next kick).`);
  process.exit(1);
}

// Persist the throttle stamp only on a clean full pass — never for a limited
// smoke test, so a test run can't suppress the next real pass.
if (!LIMIT) {
  try { writeFileSync(STAMP, new Date().toISOString() + '\n'); log(`pass complete — stamp written to ${STAMP}.`); }
  catch (e) { log(`pass complete but could not write stamp (${e.message}).`); }
} else {
  log('smoke test complete — stamp intentionally not written.');
}

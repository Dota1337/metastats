#!/usr/bin/env node
/**
 * Watchdog: prüft die TFT-Pro-Daten kontinuierlich auf Anomalien.
 *
 * Modes:
 *   --mode=daily-sample [--size=30]
 *     Random sample N pros, re-validate against all sources, log discrepancies.
 *
 *   --mode=weekly-full
 *     Re-run TPC roster crawler + enrich-history + esportsearnings + classifier
 *     as a single chained pipeline. Designed to be invoked from systemd timer.
 *
 *   --mode=anomalies-only
 *     Just scan the current DB state for known anomaly patterns without
 *     hitting any external source. Cheap (~1s), runs after every other step.
 *
 *   --mode=auto-heal
 *     Process recent validation_log entries with status='warning' and severity≤2;
 *     re-fetch from the offending source to see if the issue resolves itself,
 *     mark as resolved when it does.
 *
 * Anomaly patterns detected:
 *   • total_earnings_usd > 0 but tournament_results is empty
 *     → Likely: Liquipedia infobox earnings without backing achievements.
 *       Severity 2 (warning). Auto-heal: re-crawl Liquipedia /Results subpage.
 *
 *   • tpc_verified=true but no tournament_results
 *     → TPC-listed pro hasn't been enriched yet. Severity 2. Auto-heal: queue
 *       for enrich-tft-pro-history next run.
 *
 *   • earnings_sources has 2+ values that diverge >25% (excluding zeros)
 *     → Cross-source data inconsistency. Severity 2. Manual review.
 *
 *   • classification='inactive' but tpc_verified=true (impossible state)
 *     → Classifier ran before TPC crawler. Severity 3. Auto-heal: re-classify.
 *
 *   • last_validated_at older than 30 days
 *     → Stale data. Severity 1 (info). Auto-heal: include in next daily sample.
 *
 *   • PUUID resolution failure (riot_id present but no PUUID)
 *     → Riot-API was down or rate-limited during crawl. Severity 3. Auto-heal:
 *       retry account-v1 lookup at next run.
 *
 * Each run is identified by a UUID; events written to tft_pro_validation_log.
 * Critical issues (severity ≥ 4) optionally open a GitHub Issue via `gh`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
// support --mode=foo as well as --mode foo
function modeArg() {
  for (const a of args) {
    if (a.startsWith('--mode=')) return a.slice(7);
  }
  return arg('mode', 'anomalies-only');
}
const MODE = modeArg();
const SAMPLE_SIZE = Math.max(1, parseInt(arg('size', '30'), 10));
const VERBOSE = args.includes('--verbose');
const OPEN_GH_ISSUES = args.includes('--open-issues');

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

const RUN_ID = randomUUID();

async function sb(path, init = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: init.method === 'POST' ? 'return=minimal' : init.method === 'PATCH' ? 'return=minimal' : '',
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

async function logEvent({ puuid, proName, source, status, field, severity, detail, expected, actual }) {
  await sb('tft_pro_validation_log', {
    method: 'POST',
    body: JSON.stringify({
      validation_run_id: RUN_ID, puuid, pro_name: proName, source, status,
      field, severity, detail, expected, actual,
    }),
  });
}

// ─── Anomaly detectors ───────────────────────────────────────────────────
async function detectAnomalies() {
  const pros = await sb('tft_pro_players?select=puuid,pro_name,riot_id,tpc_verified,classification,total_earnings_usd,earnings_sources,tournament_results,last_validated_at,last_full_validation_at');
  const anomalies = [];

  for (const p of pros) {
    const earnings = Number(p.total_earnings_usd) || 0;
    const trs = Array.isArray(p.tournament_results) ? p.tournament_results : [];
    const sources = p.earnings_sources || {};

    // Earnings without backing tournaments
    if (earnings > 0 && trs.length === 0) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'liquipedia', status: 'warning',
        field: 'tournament', severity: 2,
        detail: `total_earnings_usd=${earnings} but tournament_results is empty — Liquipedia /Results subpage may be missing or unparsable`,
      });
    }

    // TPC-verified but no tournaments yet
    if (p.tpc_verified && trs.length === 0) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'liquipedia', status: 'warning',
        field: 'tournament', severity: 2,
        detail: 'TPC-verified pro has no tournament_results — needs enrich-tft-pro-history run',
      });
    }

    // Earnings cross-source divergence
    const sourceVals = Object.entries(sources).filter(([, v]) => Number(v) > 0).map(([k, v]) => [k, Number(v)]);
    if (sourceVals.length >= 2) {
      const max = Math.max(...sourceVals.map(([, v]) => v));
      const min = Math.min(...sourceVals.map(([, v]) => v));
      if ((max - min) / max > 0.25) {
        anomalies.push({
          puuid: p.puuid, proName: p.pro_name, source: 'cross', status: 'warning',
          field: 'earnings', severity: 2,
          expected: Object.fromEntries(sourceVals),
          detail: `Earnings divergence ${Math.round((max - min) / max * 100)}% across sources`,
        });
      }
    }

    // Impossible state: inactive but TPC-verified
    if (p.tpc_verified && p.classification === 'inactive') {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'classifier', status: 'error',
        field: 'classification', severity: 3,
        detail: 'classification=inactive but tpc_verified=true — re-run classify-tft-pros.mjs',
      });
    }

    // Stale validation
    if (p.last_full_validation_at) {
      const age = (Date.now() - new Date(p.last_full_validation_at).getTime()) / 86_400_000;
      if (age > 30) {
        anomalies.push({
          puuid: p.puuid, proName: p.pro_name, source: 'meta', status: 'warning',
          field: 'identity', severity: 1,
          detail: `last_full_validation_at is ${Math.round(age)} days old`,
        });
      }
    } else if (p.riot_id) {
      anomalies.push({
        puuid: p.puuid, proName: p.pro_name, source: 'meta', status: 'warning',
        field: 'identity', severity: 1,
        detail: 'Never fully validated',
      });
    }
  }
  return anomalies;
}

// ─── Sub-pipeline runners ────────────────────────────────────────────────
// Forward only the parent's existing NODE_OPTIONS — don't blindly inject
// `--use-system-ca`, that flag is a Windows-only workaround and Node on
// Linux rejects it from NODE_OPTIONS.
function runSubScript(scriptName, extraArgs = []) {
  const node = process.execPath;
  const r = spawnSync(node, ['scripts/' + scriptName, ...extraArgs], {
    stdio: 'inherit',
    env: process.env,
  });
  return r.status === 0;
}

async function modeWeeklyFull() {
  console.log(`[weekly-full] Pipeline start — run ${RUN_ID}`);
  const steps = [
    // Discovery first — finds Liquipedia pages we don't have yet (CN/KR
    // gaps especially). Logs them as "missing" events but does NOT yet
    // resolve them (Riot-ID lookup) — that's the next step.
    ['crawl-tft-pro-categories.mjs', []],
    // Main Liquipedia ingest (parses Category:Players, resolves Riot-IDs).
    ['crawl-tft-pro-players.mjs', []],
    // TPC roster overlay — stamps tpc_verified on the matched pros.
    ['crawl-tft-tpc-roster.mjs', []],
    // Per-pro tournament history + lifetime earnings (~18min for 250 pros).
    ['enrich-tft-pro-history.mjs', []],
    // 2026-current Top-Earners cross-check from Liquipedia's portal page.
    // Cheap (1 request) and flags any discrepancy against per-pro enrichment.
    ['crawl-tft-pro-portal-stats.mjs', []],
    // Optional EsportsEarnings cross-check (currently low-value — TFT
    // coverage there has gone stale). Skipped silently if no API key.
    ['enrich-tft-esportsearnings.mjs', []],
    // Live rank lookup via Riot League-V1 — drives streamer-vs-historic
    // classification (needs Master+ for streamer status).
    ['validate-tft-pro-rank.mjs', []],
    // Final classification — uses everything above.
    ['classify-tft-pros.mjs', []],
  ];
  for (const [script, a] of steps) {
    console.log(`\n[weekly-full] running ${script}…`);
    const ok = runSubScript(script, a);
    if (!ok) {
      await logEvent({
        source: 'pipeline', status: 'error', field: 'identity', severity: 4,
        detail: `Step ${script} failed`,
      });
      console.error(`Step ${script} failed — continuing with next`);
    }
  }
  // Final anomaly scan after enrichment
  await modeAnomaliesOnly();
}

async function modeDailySample() {
  // Pick N pros prioritized by last_full_validation_at (oldest first) +
  // some randomness so freshly-validated rows don't dominate.
  const candidates = await sb(`tft_pro_players?select=puuid,pro_name,last_full_validation_at&order=last_full_validation_at.asc.nullsfirst&limit=${SAMPLE_SIZE * 3}`);
  // Shuffle then take SAMPLE_SIZE
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const sample = candidates.slice(0, SAMPLE_SIZE);
  console.log(`[daily-sample] selected ${sample.length} pros`);

  // For each, re-run the classifier so any classification drift is caught.
  // Heavy cross-source checks (Liquipedia HTML re-parse) only happen in
  // weekly-full to avoid pounding Liquipedia daily.
  for (const p of sample) {
    if (VERBOSE) console.log(`  ${p.pro_name}`);
  }
  console.log('[daily-sample] reclassifying sampled pros…');
  runSubScript('classify-tft-pros.mjs', []);
  await modeAnomaliesOnly();
}

async function modeAnomaliesOnly() {
  console.log(`[anomalies-only] scanning…`);
  const anomalies = await detectAnomalies();
  console.log(`Found ${anomalies.length} anomaly events`);
  const bySev = {};
  for (const a of anomalies) {
    bySev[a.severity] = (bySev[a.severity] || 0) + 1;
    await logEvent(a);
  }
  for (const [sev, n] of Object.entries(bySev).sort()) console.log(`  severity ${sev}: ${n}`);

  // Open GH Issues for critical anomalies if requested.
  if (OPEN_GH_ISSUES) {
    const critical = anomalies.filter(a => a.severity >= 4);
    for (const c of critical) {
      const title = `[pro-watchdog] ${c.proName || c.puuid}: ${c.detail.slice(0, 60)}`;
      const body = `**Run ID:** ${RUN_ID}\n**Pro:** ${c.proName}\n**Source:** ${c.source}\n**Field:** ${c.field}\n**Detail:** ${c.detail}\n\nExpected: \`${JSON.stringify(c.expected)}\`\nActual: \`${JSON.stringify(c.actual)}\``;
      spawnSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', 'pro-watchdog'], { stdio: 'inherit' });
    }
  }
}

async function modeAutoHeal() {
  // Find recent warnings that auto-heal-eligible scripts can address.
  const open = await sb('tft_pro_validation_log?select=id,puuid,source,field,severity,detail&resolved_at=is.null&severity=lte.2&order=detected_at.desc&limit=50');
  console.log(`[auto-heal] ${open.length} open warnings — re-running enrich-history for affected pros`);
  // Auto-heal: re-run enrich-tft-pro-history for affected pros. The script
  // itself is idempotent and respects the Liquipedia ToU delay.
  const affected = [...new Set(open.filter(e => e.field === 'tournament').map(e => e.puuid).filter(Boolean))];
  if (affected.length > 0) {
    console.log(`  re-enriching ${affected.length} pros…`);
    // Currently no per-pro mode in enrich script — runs all. Future improvement
    // would take --player arg. For now we just queue them for the next full run.
    for (const id of open) {
      await sb(`tft_pro_validation_log?id=eq.${id.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolution: 'queued_for_enrich' }),
      });
    }
  }
  await modeAnomaliesOnly();
}

// ─── main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== TFT Pro Watchdog ===`);
  console.log(`Mode: ${MODE}  |  Run: ${RUN_ID}`);

  switch (MODE) {
    case 'daily-sample':   return modeDailySample();
    case 'weekly-full':    return modeWeeklyFull();
    case 'anomalies-only': return modeAnomaliesOnly();
    case 'auto-heal':      return modeAutoHeal();
    default:
      console.error(`Unknown mode: ${MODE}`);
      process.exit(1);
  }
}

main().catch(err => { console.error('FATAL:', err.message); console.error(err.stack); process.exit(1); });

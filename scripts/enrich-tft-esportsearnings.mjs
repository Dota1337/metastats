#!/usr/bin/env node
/**
 * Cross-validates TFT pro earnings against EsportsEarnings.com (Game ID 592).
 *
 * EsportsEarnings ranks lifetime prize-money per player. We use it as a
 * second source for the `earnings_sources.esportsearnings` field — independent
 * of Liquipedia's infobox earnings, which are community-edited and have known
 * gaps. When the two diverge by >20% (or one source is missing), the watchdog
 * (validate-tft-pros-loop.mjs) flags it for manual review.
 *
 * Usage:
 *   node scripts/enrich-tft-esportsearnings.mjs                # full run
 *   node scripts/enrich-tft-esportsearnings.mjs --pages 5      # top-500 only
 *   node scripts/enrich-tft-esportsearnings.mjs --no-supabase  # dry-run
 *
 * Setup:
 *   1. Register a free API key at https://www.esportsearnings.com/dev
 *   2. Add to .env.local: ESPORTSEARNINGS_API_KEY=<key>
 *   3. Run this script — it pulls 100 players per request, 1 req/s as per ToU.
 *
 * Without a key the script reports the setup gap to the validation log and
 * exits cleanly so the rest of the pipeline keeps running.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const hasFlag = (k) => args.includes(k);

const PAGES = Math.max(1, parseInt(arg('--pages', '10'), 10));   // 100 players × N pages
const SKIP_SUPABASE = hasFlag('--no-supabase');
const VERBOSE = hasFlag('--verbose');

const TFT_GAME_ID = 592;
const API_BASE = 'https://api.esportsearnings.com/v0';
const REQUEST_DELAY_MS = 1100;    // ESE ToU: 1 req/s + lokal cachen
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

const ESE_KEY = process.env.ESPORTSEARNINGS_API_KEY;
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://bwawxwgxxfafbruebixa.supabase.co';
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SKIP_SUPABASE && !SUPA_KEY) { console.error('SUPABASE_SERVICE_ROLE_KEY required'); process.exit(1); }

if (!ESE_KEY) {
  console.warn('⚠️  ESPORTSEARNINGS_API_KEY missing in .env.local');
  console.warn('   → register at https://www.esportsearnings.com/dev (free)');
  if (!SKIP_SUPABASE) {
    await sbInsert('tft_pro_validation_log', {
      validation_run_id: randomUUID(),
      source: 'esportsearnings',
      status: 'missing',
      severity: 3,
      field: 'identity',
      detail: 'ESPORTSEARNINGS_API_KEY not configured — earnings cross-check disabled',
    });
  }
  process.exit(0);
}

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

async function sbInsert(path, body) {
  return sbFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

async function eseFetch(method, params) {
  const sp = new URLSearchParams({ apikey: ESE_KEY, ...params });
  const res = await fetch(`${API_BASE}/${method}?${sp}`);
  if (!res.ok) throw new Error(`ESE ${method} HTTP ${res.status}`);
  return res.json();
}

async function main() {
  const runId = randomUUID();
  console.log(`=== EsportsEarnings cross-check — run ${runId} ===`);

  // 1. Load existing pros for name-matching (case-insensitive).
  const pros = await sbFetch('tft_pro_players?select=puuid,pro_name,real_name,total_earnings_usd,earnings_sources');
  const byHandle = new Map();
  const byRealName = new Map();
  for (const p of pros) {
    byHandle.set(p.pro_name.toLowerCase(), p);
    if (p.real_name) byRealName.set(p.real_name.toLowerCase(), p);
  }
  console.log(`Loaded ${pros.length} pros from DB`);

  // 2. Page through ESE top-earners for TFT (100 per page).
  let matched = 0, divergent = 0, missing = 0;
  for (let page = 0; page < PAGES; page++) {
    const offset = page * 100;
    const players = await eseFetch('LookupHighestEarningPlayersByGame', {
      gameid: TFT_GAME_ID, offset,
    });
    if (!Array.isArray(players) || players.length === 0) {
      console.log(`Page ${page}: empty — reached end of dataset`);
      break;
    }
    if (VERBOSE) console.log(`Page ${page}: ${players.length} players`);

    for (const ese of players) {
      const handle = (ese.CurrentHandle || '').toLowerCase();
      const realName = `${ese.NameFirst || ''} ${ese.NameLast || ''}`.trim().toLowerCase();
      const match = byHandle.get(handle) || (realName && byRealName.get(realName));
      if (!match) continue;   // unknown to us; we won't add them speculatively

      const eseEarnings = Number(ese.TotalUSDPrize) || 0;
      const liqEarnings = Number(match.total_earnings_usd) || 0;
      const sources = { ...(match.earnings_sources || {}), esportsearnings: eseEarnings };

      // Divergence-Check: if both sources have non-zero values and they
      // differ by >20%, log it for the watchdog.
      let divergent_pct = null;
      if (eseEarnings > 0 && liqEarnings > 0) {
        const max = Math.max(eseEarnings, liqEarnings);
        const diff = Math.abs(eseEarnings - liqEarnings) / max;
        if (diff > 0.2) {
          divergent_pct = diff;
          divergent++;
        }
      } else if (eseEarnings > 0 && liqEarnings === 0) {
        missing++;
      }

      if (!SKIP_SUPABASE) {
        await sbFetch(`tft_pro_players?puuid=eq.${encodeURIComponent(match.puuid)}`, {
          method: 'PATCH',
          body: JSON.stringify({ earnings_sources: sources }),
        });
        if (divergent_pct != null) {
          await sbInsert('tft_pro_validation_log', {
            validation_run_id: runId,
            puuid: match.puuid,
            pro_name: match.pro_name,
            source: 'esportsearnings',
            status: 'warning',
            severity: 2,
            field: 'earnings',
            expected: { liquipedia: liqEarnings },
            actual: { esportsearnings: eseEarnings },
            detail: `Earnings divergence ${Math.round(divergent_pct * 100)}% (liq ${liqEarnings} vs ese ${eseEarnings})`,
          });
        }
      }
      matched++;
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`Matched: ${matched} | Divergent (>20%): ${divergent} | Missing-in-Liquipedia: ${missing}`);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});

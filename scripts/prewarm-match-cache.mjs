#!/usr/bin/env node
// Pre-warm tft_player_match_cache by POSTing every top-N Master+ puuid in
// the specified regions to the Hetzner /refresh-player endpoint. Slow by
// design — Hetzner has 60s cooldown per (puuid, region).

import { readFileSync } from 'node:fs';

function readEnv() {
  const text = readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const env = readEnv();
const HETZNER = env.HETZNER_REFRESH_URL;
const TOKEN = env.REFRESH_API_TOKEN;
const SUPA_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!HETZNER || !TOKEN || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing env vars'); process.exit(1);
}

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const REGIONS = (arg('--regions', 'euw1,kr,na1') || 'euw1,kr,na1').split(',');
const PER_REGION = Number(arg('--per-region', '50'));
const SLEEP_MS = Number(arg('--sleep', '300'));

async function topPuuidsFor(region) {
  const r = await fetch(
    `${SUPA_URL}/rest/v1/rpc/get_tft_latest_marketvalues`,
    {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_region: region, p_limit: PER_REGION }),
    },
  );
  if (!r.ok) throw new Error(`top fetch ${region}: ${r.status}`);
  return r.json();
}

async function refreshOne(puuid, region) {
  const r = await fetch(`${HETZNER}/refresh-player`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ puuid, region }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  for (const region of REGIONS) {
    const players = await topPuuidsFor(region);
    console.log(`\n=== ${region} — ${players.length} top players ===`);
    let ok = 0, skipped = 0, failed = 0;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      try {
        const { status, body } = await refreshOne(p.puuid, region);
        if (status === 200) ok++;
        else if (status === 429 || status === 503) skipped++;
        else failed++;
        if ((i + 1) % 10 === 0 || i === players.length - 1) {
          console.log(`  [${i+1}/${players.length}] ok=${ok} skip=${skipped} fail=${failed} last=${p.game_name || '—'} (${body.tier || ''})`);
        }
      } catch (e) {
        failed++;
      }
      await new Promise(r => setTimeout(r, SLEEP_MS));
    }
    console.log(`  done ${region}: ok=${ok} skipped=${skipped} failed=${failed}`);
  }
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

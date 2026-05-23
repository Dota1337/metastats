#!/usr/bin/env node
// Walk every pro in tft_pro_players and POST /refresh-player to the Hetzner
// box. Each successful call writes a fresh snapshot to Supabase, populating
// the Team-Marktwert tab + the players' MarketValueHero block.

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
  console.error('Missing HETZNER_REFRESH_URL / REFRESH_API_TOKEN / Supabase env vars');
  process.exit(1);
}

async function fetchPros() {
  const r = await fetch(`${SUPA_URL}/rest/v1/tft_pro_players?select=puuid,pro_name,region&order=pro_name`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) throw new Error(`Pros fetch failed: ${r.status}`);
  return r.json();
}

async function refreshOne(puuid, region) {
  const r = await fetch(`${HETZNER}/refresh-player`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ puuid, region }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

async function main() {
  const pros = await fetchPros();
  console.log(`Found ${pros.length} pros`);

  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : pros.length;
  const subset = pros.slice(0, limit);

  let ok = 0, skipped = 0, failed = 0;
  for (let i = 0; i < subset.length; i++) {
    const p = subset[i];
    if (!p.puuid || !p.region) { skipped++; continue; }
    try {
      const { status, body } = await refreshOne(p.puuid, p.region.toLowerCase());
      if (status === 200) {
        ok++;
        console.log(`  [${i+1}/${subset.length}] ${p.pro_name} (${p.region}) → ${body.tier || 'snapshot'} ${body.finalValue ?? ''}`);
      } else if (status === 429 || status === 503) {
        skipped++;
        console.log(`  [${i+1}/${subset.length}] ${p.pro_name} → ${status} ${body.error || ''}`);
      } else {
        failed++;
        console.log(`  [${i+1}/${subset.length}] ${p.pro_name} → FAIL ${status} ${JSON.stringify(body)}`);
      }
    } catch (e) {
      failed++;
      console.log(`  [${i+1}/${subset.length}] ${p.pro_name} → ERR ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\nDone. ok=${ok} skipped=${skipped} failed=${failed}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

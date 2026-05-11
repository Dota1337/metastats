#!/usr/bin/env node
// Mirrors selected secrets from .env.local to the GitHub Actions repo secret
// store. Used to onboard new secrets the daily workflows need (Supabase URL,
// service role key, etc.) without making the user click through the Settings
// UI for each one. Re-runnable — overwrites existing secrets in place.
//
// Reads GH_TOKEN + the listed env vars from .env.local. PAT requirements:
// fine-grained PAT on Dota1337/metastats with Repository → Secrets: write.

import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';

// Secrets to mirror. Add more here when a new workflow needs an env var.
const SECRETS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

// IPv4 lookup workaround (same as refresh-riot-key.mjs — undici hangs on
// Cloudflare IPv6 in this environment).
function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => (err ? reject(err) : resolve(addr)));
  });
}

async function fetchIPv4(url, init = {}) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: ip,
        servername: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: init.method || 'GET',
        headers: { Host: u.hostname, ...(init.headers || {}) },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, text: () => Promise.resolve(body), json: () => Promise.resolve(JSON.parse(body)) });
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Request timeout')));
    if (init.body) req.write(init.body);
    req.end();
  });
}

function readEnv() {
  const text = readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function setSecret(ghToken, name, value) {
  const api = (path, init = {}) => fetchIPv4(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'metastats-sync-secrets',
      ...(init.headers || {}),
    },
  });
  const pk = await api('/actions/secrets/public-key').then(r => r.json());
  await sodium.ready;
  const encBytes = sodium.crypto_box_seal(
    sodium.from_string(value),
    sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL),
  );
  const body = JSON.stringify({
    encrypted_value: sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL),
    key_id: pk.key_id,
  });
  const r = await api(`/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (r.status >= 300) {
    throw new Error(`PUT ${name} failed: HTTP ${r.status} ${await r.text()}`);
  }
}

async function main() {
  const env = readEnv();
  const ghToken = env.GH_TOKEN;
  if (!ghToken) throw new Error('GH_TOKEN missing in .env.local');

  for (const name of SECRETS) {
    if (!env[name]) {
      console.log(`  ✗ ${name}  (not set in .env.local, skipping)`);
      continue;
    }
    await setSecret(ghToken, name, env[name]);
    console.log(`  ✓ ${name}  → GitHub secret`);
  }
  console.log('\nDone.');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

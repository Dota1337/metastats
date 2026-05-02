#!/usr/bin/env node
// Rotates the Riot API key across every place we use it.
// Reads RIOT_API_KEY and GH_TOKEN from .env.local, then updates:
//   - Vercel Production + Development env
//   - GitHub Actions repo secret (Dota1337/metastats)
// Finally triggers a Vercel redeploy via empty commit + push.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const RIOT_STATUS_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';

// Node's global fetch (undici) hangs on Cloudflare IPv6 in this env and the
// `family` hint on https.request is unreliable; pre-resolve to an IPv4 and
// connect directly with SNI = original hostname.
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

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.status}`);
}

function runCapture(cmd, args, input) {
  return spawnSync(cmd, args, { input, shell: true, encoding: 'utf8' });
}

async function validateRiotKey(key) {
  const r = await fetchIPv4(RIOT_STATUS_URL, { headers: { 'X-Riot-Token': key } });
  if (r.status !== 200) throw new Error(`Riot API rejected key: HTTP ${r.status}`);
}

async function updateVercelEnv(targets, key) {
  for (const target of targets) {
    spawnSync('vercel', ['env', 'rm', 'RIOT_API_KEY', target, '--yes'], { stdio: 'inherit', shell: true });
    const add = runCapture('vercel', ['env', 'add', 'RIOT_API_KEY', target], key);
    if (add.status !== 0) throw new Error(`vercel env add ${target} failed`);
    process.stdout.write(add.stdout || '');
  }
}

async function updateGithubSecret(ghToken, key) {
  const api = (path, init = {}) => fetchIPv4(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'metastats-refresh-riot-key',
      ...(init.headers || {}),
    },
  });
  const pk = await api('/actions/secrets/public-key').then(r => r.json());
  await sodium.ready;
  const encBytes = sodium.crypto_box_seal(
    sodium.from_string(key),
    sodium.from_base64(pk.key, sodium.base64_variants.ORIGINAL),
  );
  const body = JSON.stringify({
    encrypted_value: sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL),
    key_id: pk.key_id,
  });
  const r = await api('/actions/secrets/RIOT_API_KEY', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (r.status >= 300) throw new Error(`GitHub secret PUT failed: HTTP ${r.status} ${await r.text()}`);
}

function triggerRedeploy() {
  run('git', ['commit', '--allow-empty', '-m', '"chore: refresh Riot API key"']);
  run('git', ['push']);
}

async function main() {
  const env = readEnv();
  const key = env.RIOT_API_KEY;
  const ghToken = env.GH_TOKEN;
  if (!key || !key.startsWith('RGAPI-')) throw new Error('RIOT_API_KEY missing or malformed in .env.local');
  if (!ghToken || !ghToken.startsWith('github_pat_')) throw new Error('GH_TOKEN missing in .env.local');

  console.log('[1/5] Validating Riot key against Riot API...');
  await validateRiotKey(key);
  console.log('      OK (HTTP 200)');

  console.log('[2/5] Updating Vercel production + development env...');
  await updateVercelEnv(['production', 'development'], key);

  console.log('[3/5] Updating GitHub Actions repo secret...');
  await updateGithubSecret(ghToken, key);
  console.log('      OK');

  console.log('[4/5] Triggering Vercel redeploy via empty commit...');
  triggerRedeploy();

  console.log('[5/5] Done. Key rotated across Vercel (prod+dev) and GitHub Actions.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

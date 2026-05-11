#!/usr/bin/env node
// Syncs Riot API keys across every place we use them.
// Reads .env.local for:
//   - RIOT_API_KEY      (LoL — currently a dev key, expires every 24h)
//   - RIOT_API_KEY_TFT  (TFT — production key, doesn't expire)
//   - GH_TOKEN          (PAT with repo:secrets write on Dota1337/metastats)
// Updates Vercel Production + Development env + GitHub Actions repo secret
// for every key that's present, then triggers a redeploy.
//
// Usage:
//   node scripts/refresh-riot-key.mjs              # syncs whichever keys are set
//   node scripts/refresh-riot-key.mjs --skip-deploy # don't push the empty commit

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const LOL_STATUS_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';
const TFT_VALIDATE_URL = 'https://euw1.api.riotgames.com/tft/league/v1/challenger';

const SKIP_DEPLOY = process.argv.includes('--skip-deploy');

// Each key has an env-var name (in .env.local), the Vercel/GitHub secret name,
// and a validation URL (TFT endpoints reject LoL-only keys with 403 and vice versa,
// so we validate each key against its actual game).
const KEYS = [
  { envName: 'RIOT_API_KEY',     secretName: 'RIOT_API_KEY',     validateUrl: LOL_STATUS_URL,  label: 'LoL' },
  { envName: 'RIOT_API_KEY_TFT', secretName: 'RIOT_API_KEY_TFT', validateUrl: TFT_VALIDATE_URL, label: 'TFT' },
];

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

async function validateRiotKey(key, url, label) {
  const r = await fetchIPv4(url, { headers: { 'X-Riot-Token': key } });
  if (r.status !== 200) throw new Error(`Riot API rejected ${label} key: HTTP ${r.status}`);
}

async function updateVercelEnv(targets, secretName, key) {
  for (const target of targets) {
    spawnSync('vercel', ['env', 'rm', secretName, target, '--yes'], { stdio: 'inherit', shell: true });
    const add = runCapture('vercel', ['env', 'add', secretName, target], key);
    if (add.status !== 0) throw new Error(`vercel env add ${secretName} ${target} failed`);
    process.stdout.write(add.stdout || '');
  }
}

async function updateGithubSecret(ghToken, secretName, key) {
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
  const r = await api(`/actions/secrets/${secretName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
  });
  if (r.status >= 300) throw new Error(`GitHub secret PUT failed: HTTP ${r.status} ${await r.text()}`);
}

function triggerRedeploy() {
  run('git', ['commit', '--allow-empty', '-m', '"chore: refresh Riot API keys"']);
  run('git', ['push']);
}

async function main() {
  const env = readEnv();
  const ghToken = env.GH_TOKEN;
  if (!ghToken || !ghToken.startsWith('github_pat_')) throw new Error('GH_TOKEN missing in .env.local');

  const present = KEYS.filter(k => env[k.envName] && env[k.envName].startsWith('RGAPI-'));
  if (present.length === 0) throw new Error('No RIOT_API_KEY* found in .env.local');

  const step = (n, total, msg) => console.log(`[${n}/${total}] ${msg}`);
  const totalSteps = present.length * 3 + (SKIP_DEPLOY ? 0 : 1);
  let n = 0;

  // Phase 1: validate each key against its respective game endpoint
  for (const k of present) {
    step(++n, totalSteps, `Validating ${k.label} key against Riot API...`);
    await validateRiotKey(env[k.envName], k.validateUrl, k.label);
    console.log(`      OK (HTTP 200)`);
  }

  // Phase 2: update Vercel prod + dev for each key
  for (const k of present) {
    step(++n, totalSteps, `Updating Vercel prod+dev env for ${k.secretName}...`);
    await updateVercelEnv(['production', 'development'], k.secretName, env[k.envName]);
  }

  // Phase 3: update GitHub Actions repo secret for each key
  for (const k of present) {
    step(++n, totalSteps, `Updating GitHub Actions repo secret ${k.secretName}...`);
    await updateGithubSecret(ghToken, k.secretName, env[k.envName]);
    console.log('      OK');
  }

  if (!SKIP_DEPLOY) {
    step(++n, totalSteps, 'Triggering Vercel redeploy via empty commit...');
    triggerRedeploy();
  }

  console.log(`\nDone. Synced ${present.length} key(s): ${present.map(k => k.label).join(', ')}`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

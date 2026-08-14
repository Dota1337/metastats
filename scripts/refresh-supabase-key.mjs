#!/usr/bin/env node
// Syncs SUPABASE_SERVICE_ROLE_KEY across every place we use it.
// Reads .env.local for:
//   - SUPABASE_SERVICE_ROLE_KEY (rotated upfront in Supabase Dashboard)
//   - NEXT_PUBLIC_SUPABASE_URL   (target host for validation)
//   - GH_TOKEN                   (PAT with repo:secrets write on Dota1337/metastats)
//   - HETZNER_REFRESH_URL        (used to derive the crawler-box host; HETZNER_HOST overrides)
// Updates Vercel Production + Development env + GitHub Actions repo secret,
// pushes the key to the Hetzner crawler box, and RESTARTS the always-on
// metastats-refresh-api.service (mandatory: it caches the env at start —
// without restart the old key stays in RAM and /refresh-player keeps
// failing on writes; see reference_hetzner_box_services memory).
//
// NEXT_PUBLIC_SUPABASE_ANON_KEY (publishable key) is intentionally not
// rotated here — it's exposed in the browser bundle and has a separate
// lifecycle. Add it to KEYS below when you do want to rotate it.
//
// Usage:
//   node scripts/refresh-supabase-key.mjs              # full rotation
//   node scripts/refresh-supabase-key.mjs --skip-deploy # no empty commit
//   node scripts/refresh-supabase-key.mjs --skip-box    # don't touch Hetzner
//   node scripts/refresh-supabase-key.mjs --dry-run     # show plan, change nothing
//
// On Windows, prepend `NODE_OPTIONS=--use-system-ca` so GitHub's TLS chain
// resolves through Schannel.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_DEPLOY = process.argv.includes('--skip-deploy');
const SKIP_BOX = process.argv.includes('--skip-box');

const KEYS = [
  { envName: 'SUPABASE_SERVICE_ROLE_KEY', secretName: 'SUPABASE_SERVICE_ROLE_KEY', prefix: 'sb_secret_', label: 'Supabase Service-Role' },
];

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

async function validateSupabaseKey(key, supabaseUrl, label) {
  // PostgREST returns 200 with a Swagger-style OpenAPI doc when called with a
  // valid service-role key; 401 when the key is bad. We don't care about the
  // body, just the status.
  const r = await fetchIPv4(`${supabaseUrl}/rest/v1/`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (r.status !== 200) throw new Error(`Supabase REST rejected ${label} key: HTTP ${r.status}`);
}

async function updateVercelEnv(targets, secretName, key) {
  for (const target of targets) {
    // Kein NODE_TLS_REJECT_UNAUTHORIZED=0: hier geht der Service-Role-Key raus.
    // Ohne Zertifikatspruefung liest ihn jede Zwischenstation mit. Bei
    // TLS-Inspektion NODE_EXTRA_CA_CERTS setzen, nicht die Pruefung abschalten.
    spawnSync('vercel', ['env', 'rm', secretName, target, '--yes'], { stdio: 'inherit', shell: true });
    const add = spawnSync('vercel', ['env', 'add', secretName, target], {
      input: key,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    });
    if (add.status !== 0) throw new Error(`vercel env add ${secretName} ${target} failed`);
  }
}

async function updateGithubSecret(ghToken, secretName, key) {
  const api = (path, init = {}) => fetchIPv4(`https://api.github.com/repos/${REPO}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'metastats-refresh-supabase-key',
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
  run('git', ['commit', '--allow-empty', '-m', '"chore: refresh Supabase service-role key"']);
  run('git', ['push']);
}

// Mandatory: refresh-api is always-on and caches env in RAM. Without restart
// the old key keeps being used until the next service restart — silent
// failure mode for the /refresh-player endpoint.
function syncKeyToHetzner(env, secretName, key) {
  const host = env.HETZNER_HOST
    || (env.HETZNER_REFRESH_URL ? new URL(env.HETZNER_REFRESH_URL).hostname : null);
  if (!host) {
    console.log('      (no HETZNER_HOST / HETZNER_REFRESH_URL in .env.local — skipping box sync)');
    return;
  }
  // Supabase keys use [A-Za-z0-9_-] only (sb_secret_… base62). Safe in sed `|`.
  const remote = [
    'set -e',
    'f=/etc/metastats-crawler/env',
    'touch "$f"',
    `if grep -q '^${secretName}=' "$f"; then sed -i.bak 's|^${secretName}=.*|${secretName}=${key}|' "$f"; else printf '${secretName}=%s\\n' '${key}' >> "$f"; fi`,
    'systemctl restart metastats-refresh-api.service',
    'sleep 2',
    'systemctl is-active metastats-refresh-api.service',
    'echo "      box keyed + refresh-api restarted"',
  ].join('; ');
  const r = spawnSync('ssh',
    ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, remote],
    { stdio: 'inherit' });
  if (r.status !== 0) {
    throw new Error(`Hetzner sync FAILED (ssh exit ${r.status ?? r.error?.message ?? '?'}) — Vercel/GitHub keys updated but box still holds old key in RAM.`);
  }
}

function verifyHealthz(env) {
  return new Promise((resolve) => {
    const url = env.HETZNER_REFRESH_URL;
    if (!url) return resolve(null);
    const u = new URL(url);
    const req = httpRequest({ host: u.hostname, port: u.port || 4100, path: '/healthz', method: 'GET', timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', () => resolve(null));
    req.end();
  });
}

async function main() {
  const env = readEnv();
  const ghToken = env.GH_TOKEN;
  if (!ghToken || !ghToken.startsWith('github_pat_')) throw new Error('GH_TOKEN missing in .env.local');
  if (!env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('NEXT_PUBLIC_SUPABASE_URL missing in .env.local');

  const present = KEYS.filter(k => env[k.envName] && env[k.envName].startsWith(k.prefix));
  if (present.length === 0) throw new Error(`No Supabase key found in .env.local with expected prefix(es): ${KEYS.map(k => k.prefix).join(', ')}`);

  const boxSteps = SKIP_BOX ? 0 : present.length;
  const step = (n, total, msg) => console.log(`[${n}/${total}] ${msg}`);
  const totalSteps = present.length * 3 + boxSteps + (SKIP_DEPLOY ? 0 : 1);
  let n = 0;

  if (DRY_RUN) {
    console.log('DRY RUN — would rotate:', present.map(k => k.label).join(', '));
    console.log('  Vercel targets: production, development');
    console.log('  GitHub Secret(s):', present.map(k => k.secretName).join(', '));
    console.log('  Hetzner sync:', SKIP_BOX ? 'skipped' : 'YES (+ restart metastats-refresh-api.service)');
    console.log('  Redeploy:', SKIP_DEPLOY ? 'skipped' : 'empty commit + push');
    return;
  }

  // Phase 1: validate
  for (const k of present) {
    step(++n, totalSteps, `Validating ${k.label} key against Supabase REST...`);
    await validateSupabaseKey(env[k.envName], env.NEXT_PUBLIC_SUPABASE_URL, k.label);
    console.log('      OK (HTTP 200)');
  }

  // Phase 2: Vercel
  for (const k of present) {
    step(++n, totalSteps, `Updating Vercel prod+dev env for ${k.secretName}...`);
    await updateVercelEnv(['production', 'development'], k.secretName, env[k.envName]);
  }

  // Phase 3: GitHub
  for (const k of present) {
    step(++n, totalSteps, `Updating GitHub Actions repo secret ${k.secretName}...`);
    await updateGithubSecret(ghToken, k.secretName, env[k.envName]);
    console.log('      OK');
  }

  // Phase 4: Hetzner (MANDATORY restart of refresh-api)
  if (!SKIP_BOX) {
    for (const k of present) {
      step(++n, totalSteps, `Syncing ${k.secretName} to Hetzner box + restarting refresh-api...`);
      syncKeyToHetzner(env, k.secretName, env[k.envName]);
    }
    // Quick /healthz sanity check
    const hz = await verifyHealthz(env);
    if (hz) console.log(`      /healthz: HTTP ${hz.status} ${hz.body.trim()}`);
  }

  if (!SKIP_DEPLOY) {
    step(++n, totalSteps, 'Triggering Vercel redeploy via empty commit...');
    triggerRedeploy();
  }

  console.log(`\nDone. Synced ${present.length} Supabase key(s): ${present.map(k => k.label).join(', ')}`);
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

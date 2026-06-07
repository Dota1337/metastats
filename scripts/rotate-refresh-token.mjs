#!/usr/bin/env node
// Rotiert das REFRESH_API_TOKEN — der Bearer-Token, der zwischen Vercel
// (Caller) und dem Hetzner refresh-api-server (auf :4100) geteilt wird.
//
// Was passiert:
//   1. Generiert einen neuen 32-byte URL-safe Random-Token.
//   2. Updated Vercel Production + Development env.
//   3. Updated GitHub Actions repo secret (für CI-Jobs).
//   4. SSH zur Hetzner-Box, sed-replace in /etc/metastats-crawler/env,
//      systemctl restart metastats-refresh-api.service (PFLICHT — der
//      Server hält den Token im RAM, sonst antwortet er weiter mit dem
//      alten Wert).
//   5. Verifiziert per /healthz dass der neue Server hochgekommen ist.
//   6. Optional: schreibt den neuen Token in .env.local (lokales Testen).
//
// Voraussetzungen (identisch zu refresh-riot-key.mjs):
//   - .env.local mit GH_TOKEN (Fine-grained PAT, Repo→Secrets write)
//   - HETZNER_REFRESH_URL gesetzt (für die Box-IP)
//   - vercel CLI authentifiziert
//
// Usage:
//   node scripts/rotate-refresh-token.mjs              # full rotation
//   node scripts/rotate-refresh-token.mjs --dry-run    # show plan, nichts ändern
//   node scripts/rotate-refresh-token.mjs --skip-box   # skip Hetzner step
//   node scripts/rotate-refresh-token.mjs --skip-vercel # skip Vercel step
//
// Ausgabe: der neue Token wird am Ende stdout-printed; bewahre ihn auf
// falls weitere manuelle Ziele befüllt werden müssen.

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const SECRET_NAME = 'REFRESH_API_TOKEN';

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BOX = process.argv.includes('--skip-box');
const SKIP_VERCEL = process.argv.includes('--skip-vercel');
const SKIP_GITHUB = process.argv.includes('--skip-github');

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    const detail = `${r.stdout || ''}${r.stderr || ''}`.slice(0, 500);
    throw new Error(`${cmd} ${args.join(' ')} → exit ${r.status}\n${detail}`);
  }
  return r.stdout.trim();
}

function generateToken() {
  // 32 random bytes → 43-char URL-safe base64 (no padding). Same format
  // the existing token in .env.local uses ("XPZjOa0Sg-X8wfMA…").
  return randomBytes(32).toString('base64url');
}

function updateVercelEnv(token) {
  for (const target of ['production', 'development']) {
    try {
      run('vercel', ['env', 'rm', SECRET_NAME, target, '--yes'], { env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' } });
    } catch {
      // Token might not exist yet — first rotation. Ignore.
    }
    const echo = spawnSync('printf', ['%s', token], { encoding: 'utf8' });
    const add = spawnSync('vercel', ['env', 'add', SECRET_NAME, target], {
      input: echo.stdout,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    });
    if (add.status !== 0) throw new Error(`vercel env add ${SECRET_NAME} ${target} failed`);
  }
}

async function updateGitHubSecret(token, ghToken) {
  await sodium.ready;
  // Get repo public-key
  const pubKey = await ghApi('GET', `/repos/${REPO}/actions/secrets/public-key`, ghToken);
  const pubKeyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(token);
  const encrypted = sodium.crypto_box_seal(messageBytes, pubKeyBytes);
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
  await ghApi('PUT', `/repos/${REPO}/actions/secrets/${SECRET_NAME}`, ghToken, {
    encrypted_value: encryptedB64,
    key_id: pubKey.key_id,
  });
}

function ghApi(method, path, ghToken, body) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'metastats-rotate-token',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data ? JSON.parse(data) : null);
        } else reject(new Error(`GH API ${method} ${path} → ${res.statusCode} ${data.slice(0, 300)}`));
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function rotateOnHetzner(host, token) {
  // sed in-place auf /etc/metastats-crawler/env mit Backup, dann Service-Restart.
  // PFLICHT laut Memory `reference_hetzner_box_services.md`: refresh-api liest
  // Env beim Start in den RAM, ohne Restart bleibt alter Token aktiv.
  const sshArgs = (cmd) => ['-o', 'StrictHostKeyChecking=no', `root@${host}`, cmd];
  const cmd = `sed -i.bak "s|^${SECRET_NAME}=.*|${SECRET_NAME}=${token}|" /etc/metastats-crawler/env && systemctl restart metastats-refresh-api.service && sleep 2 && systemctl is-active metastats-refresh-api.service`;
  return run('ssh', sshArgs(cmd));
}

function verifyHetzner(host, token) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      host,
      port: 4100,
      path: '/healthz',
      method: 'GET',
      timeout: 5000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) resolve(JSON.parse(data));
        else reject(new Error(`healthz HTTP ${res.statusCode}`));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('healthz timeout')); });
    req.end();
  });
}

async function main() {
  const env = loadDotEnv('.env.local');
  const ghToken = env.GH_TOKEN || process.env.GH_TOKEN;
  if (!SKIP_GITHUB && !ghToken) {
    throw new Error('GH_TOKEN missing in .env.local — set or use --skip-github');
  }
  const hetznerUrl = env.HETZNER_REFRESH_URL || process.env.HETZNER_REFRESH_URL;
  const hetznerHost = hetznerUrl ? new URL(hetznerUrl).hostname : null;
  if (!SKIP_BOX && !hetznerHost) {
    throw new Error('HETZNER_REFRESH_URL missing — set or use --skip-box');
  }

  const newToken = generateToken();
  console.log(`[1/5] Generated new token (${newToken.length} chars)`);
  if (DRY_RUN) {
    console.log('     DRY RUN — would rotate to:', newToken);
    console.log('     would touch:');
    if (!SKIP_VERCEL) console.log('       Vercel: production + development env');
    if (!SKIP_GITHUB) console.log(`       GitHub: ${REPO} secret ${SECRET_NAME}`);
    if (!SKIP_BOX) console.log(`       Hetzner: root@${hetznerHost} /etc/metastats-crawler/env + restart`);
    return;
  }

  if (!SKIP_VERCEL) {
    console.log('[2/5] Updating Vercel env (production + development)…');
    updateVercelEnv(newToken);
    console.log('      OK');
  } else console.log('[2/5] Vercel skipped');

  if (!SKIP_GITHUB) {
    console.log('[3/5] Updating GitHub Actions secret…');
    await updateGitHubSecret(newToken, ghToken);
    console.log('      OK');
  } else console.log('[3/5] GitHub skipped');

  if (!SKIP_BOX) {
    console.log(`[4/5] Rotating on Hetzner-Box (${hetznerHost})…`);
    const out = rotateOnHetzner(hetznerHost, newToken);
    console.log('      systemctl is-active →', out);

    console.log('[5/5] Verifying /healthz on Hetzner…');
    const health = await verifyHetzner(hetznerHost, newToken);
    console.log('      OK', health);
  } else console.log('[4/5] Hetzner skipped');

  // Update .env.local too, so the developer's local environment matches.
  if (existsSync('.env.local')) {
    const txt = readFileSync('.env.local', 'utf8');
    const replaced = txt.replace(new RegExp(`^${SECRET_NAME}=.*$`, 'm'), `${SECRET_NAME}=${newToken}`);
    if (replaced !== txt) {
      writeFileSync('.env.local', replaced);
      console.log('      Updated local .env.local');
    }
  }

  console.log('\nDone. New token:');
  console.log(newToken);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

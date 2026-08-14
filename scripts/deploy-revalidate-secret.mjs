#!/usr/bin/env node
// Generiert + deployed das REVALIDATE_SECRET, das der Hetzner-Crawler nutzt,
// um nach Crawl-Fertig den Vercel-Edge-Cache zu invalidieren
// (POST /api/internal/revalidate). Pattern entspricht rotate-refresh-token.mjs:
// derselbe Wert muss in Vercel-Env (für die Next.js-API-Route-Verify) und auf
// Hetzner (für die Crawler-Signatur) liegen.
//
// Anders als REFRESH_API_TOKEN gibt es KEINEN always-on-Service der den Wert
// im RAM hält — die Crawler-Scripts (crawl-allranks-all-regions, crawl-all-
// regions) lesen die Env beim Spawn frisch. Heißt: KEIN systemctl restart
// nötig, alle künftigen Crawl-Runs nehmen den neuen Wert automatisch.
//
// Usage:
//   node scripts/deploy-revalidate-secret.mjs              # full deploy
//   node scripts/deploy-revalidate-secret.mjs --dry-run    # nur Plan zeigen
//   node scripts/deploy-revalidate-secret.mjs --skip-box   # Hetzner skip
//   node scripts/deploy-revalidate-secret.mjs --skip-vercel
//   node scripts/deploy-revalidate-secret.mjs --skip-github
//
// Voraussetzungen (wie bei rotate-refresh-token.mjs):
//   - .env.local mit GH_TOKEN (Fine-grained PAT, Repo→Secrets write)
//   - HETZNER_REFRESH_URL gesetzt (für die Box-IP)
//   - vercel CLI authentifiziert
//   - libsodium-wrappers als dev-dep

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const SECRET_NAME = 'REVALIDATE_SECRET';

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

function generateSecret() {
  // 32 random bytes → 64-char hex. Same Format wie OVERWOLF_APP_SECRET. Hex
  // weil HMAC-Signature im Header eh hex ist — vereinfacht Debug.
  return randomBytes(32).toString('hex');
}

function updateVercelEnv(secret) {
  for (const target of ['production', 'development']) {
    try {
      // Kein NODE_TLS_REJECT_UNAUTHORIZED=0: hier wandert ein frisches Secret
      // ueber die Leitung. Bei TLS-Inspektion NODE_EXTRA_CA_CERTS setzen,
      // nicht die Zertifikatspruefung abschalten.
      run('vercel', ['env', 'rm', SECRET_NAME, target, '--yes'], { shell: true });
    } catch {
      // Existiert noch nicht — erste Initialisierung. Ignore.
    }
    const add = spawnSync('vercel', ['env', 'add', SECRET_NAME, target], {
      input: secret,
      stdio: ['pipe', 'inherit', 'inherit'],
      shell: true,
    });
    if (add.status !== 0) throw new Error(`vercel env add ${SECRET_NAME} ${target} failed`);
  }
}

async function updateGitHubSecret(secret, ghToken) {
  await sodium.ready;
  const pubKey = await ghApi('GET', `/repos/${REPO}/actions/secrets/public-key`, ghToken);
  const pubKeyBytes = sodium.from_base64(pubKey.key, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secret);
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
        'User-Agent': 'metastats-deploy-secret',
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

function deployToHetzner(host, secret) {
  // Append-or-replace pattern. Anders als bei refresh-token rotation wo das
  // env immer schon eine REFRESH_API_TOKEN-Zeile hat, ist dies möglicherweise
  // die Erst-Initialisierung — also grep-then-set statt sed-replace.
  const sshArgs = (cmd) => ['-o', 'StrictHostKeyChecking=no', `root@${host}`, cmd];
  // Bash-Snippet auf der Box: wenn Key existiert, sed-replace mit Backup,
  // sonst echo append. Quoting für SSH ist einfaches Bash-Compatible.
  const cmd = `if grep -q "^${SECRET_NAME}=" /etc/metastats-crawler/env; then `
    + `sed -i.bak "s|^${SECRET_NAME}=.*|${SECRET_NAME}=${secret}|" /etc/metastats-crawler/env; `
    + `else `
    + `echo "${SECRET_NAME}=${secret}" >> /etc/metastats-crawler/env; `
    + `fi && grep "^${SECRET_NAME}=" /etc/metastats-crawler/env | head -c 80`;
  return run('ssh', sshArgs(cmd));
}

function updateLocalEnv(secret) {
  const path = '.env.local';
  if (!existsSync(path)) {
    console.log('      .env.local nicht vorhanden — übersprungen.');
    return;
  }
  const txt = readFileSync(path, 'utf8');
  if (new RegExp(`^${SECRET_NAME}=`, 'm').test(txt)) {
    const replaced = txt.replace(new RegExp(`^${SECRET_NAME}=.*$`, 'm'), `${SECRET_NAME}=${secret}`);
    writeFileSync(path, replaced);
    console.log('      .env.local: in-place ersetzt.');
  } else {
    // Append mit korrektem Newline-Handling
    const sep = txt.endsWith('\n') ? '' : '\n';
    appendFileSync(path, `${sep}${SECRET_NAME}=${secret}\n`);
    console.log('      .env.local: angehängt.');
  }
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

  const secret = generateSecret();
  console.log(`[1/5] Generated REVALIDATE_SECRET (${secret.length} chars hex)`);

  if (DRY_RUN) {
    console.log('      DRY RUN — would deploy:', secret);
    if (!SKIP_VERCEL) console.log('       Vercel: production + development env');
    if (!SKIP_GITHUB) console.log(`       GitHub: ${REPO} secret ${SECRET_NAME}`);
    if (!SKIP_BOX) console.log(`       Hetzner: root@${hetznerHost} /etc/metastats-crawler/env`);
    console.log('       Local: .env.local');
    return;
  }

  if (!SKIP_VERCEL) {
    console.log('[2/5] Updating Vercel env (production + development)…');
    updateVercelEnv(secret);
    console.log('      OK');
  } else console.log('[2/5] Vercel skipped');

  if (!SKIP_GITHUB) {
    console.log('[3/5] Updating GitHub Actions secret…');
    await updateGitHubSecret(secret, ghToken);
    console.log('      OK');
  } else console.log('[3/5] GitHub skipped');

  if (!SKIP_BOX) {
    console.log(`[4/5] Deploying to Hetzner-Box (${hetznerHost})…`);
    const out = deployToHetzner(hetznerHost, secret);
    console.log('      Box bestätigt:', out);
  } else console.log('[4/5] Hetzner skipped');

  console.log('[5/5] Updating local .env.local…');
  updateLocalEnv(secret);

  console.log('\nDone. REVALIDATE_SECRET deployed.');
  console.log('Key:', secret);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

#!/usr/bin/env node
// Syncs the two Vercel-Blob related env vars (BLOB_READ_WRITE_TOKEN +
// SNAPSHOT_MANIFEST_URL) from .env.local to:
//   - Vercel-Env (production + development)
//   - GitHub-Repo-Secrets
//   - Hetzner crawler box /etc/metastats-crawler/env (die Box-Dienste lesen
//     die Datei bei jedem Start; refresh-api liest keinen der beiden Namen,
//     ein Neustart bewirkt nichts — Positivliste in
//     infra/hetzner/metastats-refresh-api-env.sh, Stand 24.10.2026)
//
// Vercel liest zur Laufzeit nur SNAPSHOT_MANIFEST_URL (BLOB_READ_WRITE_TOKEN
// kommt in app/ nicht vor). Aendert sich die Manifest-Adresse, erst einen
// Publisher-Lauf in den neuen Speicher abwarten, dann mit --deploy neu
// ausrollen — sonst liest die Seite ein leeres Manifest.
//
// Run once after creating the Vercel-Blob store in the Dashboard:
//   Storage → Create → Blob → "Connect to project metastats"
// That auto-injects BLOB_READ_WRITE_TOKEN into Vercel-Env. Pull it locally and
// add SNAPSHOT_MANIFEST_URL (printed by the first publisher run), then run
// this script.
//
// Env required in .env.local:
//   BLOB_READ_WRITE_TOKEN
//   SNAPSHOT_MANIFEST_URL
//   GH_TOKEN (fine-grained PAT mit Repo-Secrets-Write)
//   HETZNER_REFRESH_URL (zur Host-Lokalisierung)

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createVercelDeploy, acquireLock } from './lib/vercel-deploy.mjs';

const require_ = createRequire(import.meta.url);
const DEPLOY = process.argv.includes('--deploy');
const dep = createVercelDeploy();

function parseDotenv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const env = parseDotenv('.env.local');
const REQUIRED = ['BLOB_READ_WRITE_TOKEN', 'SNAPSHOT_MANIFEST_URL', 'GH_TOKEN'];
const missing = REQUIRED.filter(k => !env[k]);
if (missing.length) {
  console.error(`Missing required env vars in .env.local: ${missing.join(', ')}`);
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', shell: true, ...opts });
  return { code: r.status ?? 1, out: r.stdout || '', err: r.stderr || '' };
}

function pushVercel(name, value) {
  console.log(`  vercel production + development: ${name}`);
  try {
    dep.setEnv(name, value);
    return true;
  } catch (err) {
    console.error(`    failed: ${err.message}`);
    return false;
  }
}

async function pushGithub(name, value) {
  console.log(`  github secret: ${name}`);
  let sodium;
  try {
    sodium = require_('libsodium-wrappers');
    await sodium.ready;
  } catch (e) {
    console.error(`    libsodium-wrappers not installed: ${e.message}`);
    return false;
  }

  const ghHeaders = {
    Authorization: `Bearer ${env.GH_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const repo = 'Dota1337/metastats';
  const keyRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/public-key`, { headers: ghHeaders });
  if (!keyRes.ok) {
    console.error(`    public-key fetch failed: HTTP ${keyRes.status}`);
    return false;
  }
  const { key, key_id } = await keyRes.json();
  const keyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const valueBytes = sodium.from_string(value);
  const encrypted = sodium.crypto_box_seal(valueBytes, keyBytes);
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);
  const putRes = await fetch(`https://api.github.com/repos/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    headers: { ...ghHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ encrypted_value: encryptedB64, key_id }),
  });
  if (!putRes.ok) {
    console.error(`    PUT failed: HTTP ${putRes.status} ${(await putRes.text()).slice(0, 200)}`);
    return false;
  }
  return true;
}

async function pushHetzner(updates) {
  const host = env.HETZNER_REFRESH_URL
    ? new URL(env.HETZNER_REFRESH_URL).hostname
    : '37.27.219.140';
  console.log(`  hetzner ${host}: updating /etc/metastats-crawler/env`);
  // sed -i in-place mit Backup; add key wenn nicht vorhanden.
  const lines = Object.entries(updates).map(([k, v]) => {
    const escaped = v.replace(/[\\&|]/g, '\\$&');
    return `if grep -q '^${k}=' /etc/metastats-crawler/env; then sed -i.bak 's|^${k}=.*|${k}=${escaped}|' /etc/metastats-crawler/env; else echo '${k}=${v}' >> /etc/metastats-crawler/env; fi`;
  }).join('; ');
  const r = run('ssh', ['-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, `"${lines}; echo done"`]);
  if (r.code !== 0) {
    console.error(`    ssh failed: ${r.err.slice(0, 200)}`);
    return false;
  }
  console.log(`    ${r.out.trim()}`);
  return true;
}

async function main() {
  const targets = ['BLOB_READ_WRITE_TOKEN', 'SNAPSHOT_MANIFEST_URL'];
  console.log('=== Vercel ===');
  const envChangedAt = Date.now();
  for (const name of targets) pushVercel(name, env[name]);
  console.log('\n=== GitHub Secrets ===');
  for (const name of targets) await pushGithub(name, env[name]);
  console.log('\n=== Hetzner ===');
  await pushHetzner(Object.fromEntries(targets.map(k => [k, env[k]])));
  if (DEPLOY) {
    console.log('\n=== Deploy ===');
    console.log(`  live: ${await dep.redeployProduction({ since: envChangedAt, gitMessage: 'chore: sync Vercel-Blob env' })}`);
  } else {
    console.log('\nDONE — ohne --deploy liest die Live-Seite die neue Manifest-Adresse erst nach dem naechsten Deploy.');
  }
}

let releaseLock = () => {};
try {
  releaseLock = acquireLock('sync-vercel-blob-env');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
main()
  .then(() => releaseLock())
  .catch(e => { releaseLock(); console.error(e); process.exit(1); });

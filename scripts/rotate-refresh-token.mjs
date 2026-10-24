#!/usr/bin/env node
// Rotiert das REFRESH_API_TOKEN — der Bearer-Token, der zwischen Vercel
// (Caller) und dem Hetzner refresh-api-server geteilt wird.
//
// Reihenfolge (seit 24.10.2026, Pruefer-Befund): erst Vercel, dann die Box.
// Bis dahin wurde die Box rotiert und Vercel nie neu ausgerollt — die
// Live-Seite schickte das alte Token, die Box verlangte das neue, und der
// Profil-Aktualisieren-Knopf antwortete 401 bis zum naechsten Push.
//
//   1. Neues Token erzeugen.
//   2. Vercel Production + Development setzen.
//   3. Produktion neu ausrollen und warten, bis die Domain ein Deployment mit
//      dem neuen Wert ausliefert (scripts/lib/vercel-deploy.mjs).
//      Scheitert das: alten Wert nach Vercel zurueck, Box bleibt unberuehrt —
//      sonst braechte der naechste Bot-Push das neue Token ohne die Box live.
//   4. .env.local schreiben (ab hier ist das neue Token die Wahrheit).
//   5. Box: sed in /etc/metastats-crawler/env + Neustart von refresh-api
//      (haelt das Token im Speicher), bis zu 3 Versuche. Zwischen 3 und 5
//      liegen nur Sekunden — in diesem Fenster antwortet der Knopf 401.
//   6. Pruefen: /healthz?detail=services mit dem NEUEN Token muss 200 liefern.
//   7. GitHub-Secret (kein Workflow liest es, gemessen 24.10.2026 — es bleibt
//      nur als Ablage).
//
// Das Token erscheint in keiner Ausgabe; es steht danach in .env.local.
//
// Usage:
//   node scripts/rotate-refresh-token.mjs              # volle Rotation
//   node scripts/rotate-refresh-token.mjs --dry-run    # nur Plan zeigen
//   node scripts/rotate-refresh-token.mjs --box-only   # Schritt 5-6 nachholen (Token aus .env.local)
//   node scripts/rotate-refresh-token.mjs --skip-github

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import sodium from 'libsodium-wrappers';
import { createVercelDeploy, acquireLock } from './lib/vercel-deploy.mjs';

const REPO = 'Dota1337/metastats';
const SECRET_NAME = 'REFRESH_API_TOKEN';

const DRY_RUN = process.argv.includes('--dry-run');
const BOX_ONLY = process.argv.includes('--box-only');
const SKIP_GITHUB = process.argv.includes('--skip-github');

// 2-s-Takt: das 401-Fenster reicht vom Umhaengen der Domain bis zum Neustart
// auf der Box, jeder Takt verlaengert es.
const dep = createVercelDeploy({ timeouts: { pollMs: 2_000 } });

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function generateToken() {
  // 32 random bytes → 43-char URL-safe base64 (no padding).
  return randomBytes(32).toString('base64url');
}

async function updateGitHubSecret(token, ghToken) {
  await sodium.ready;
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

// Token per stdin, nicht in der Befehlszeile: so steht es weder im ssh-Aufruf
// noch in der Prozessliste der Box.
function rotateOnHetzner(host, token) {
  const script = [
    'set -e',
    'read -r T',
    `sed -i.bak "s|^${SECRET_NAME}=.*|${SECRET_NAME}=$T|" /etc/metastats-crawler/env`,
    `grep -q "^${SECRET_NAME}=$T\\$" /etc/metastats-crawler/env`,
    'systemctl restart metastats-refresh-api.service',
    'sleep 2',
    'systemctl is-active metastats-refresh-api.service',
  ].join('\n');
  const r = spawnSync('ssh',
    ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, `bash -c '${script.replace(/'/g, "'\\''")}'`],
    { input: `${token}\n`, encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`ssh exit ${r.status ?? r.error?.code}: ${String(r.stderr || '').slice(0, 300)}`);
  return String(r.stdout || '').trim();
}

// Ueber die volle Adresse aus HETZNER_REFRESH_URL und MIT dem neuen Token: die
// Dienstliste verlangt ihn, ein 200 beweist also, dass die Box ihn kennt.
async function verifyHetzner(baseUrl, token) {
  const url = new URL('/healthz?detail=services', baseUrl);
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const j = await res.json();
        return { ok: j.ok, services: j.services?.length ?? 0 };
      }
      last = new Error(`healthz HTTP ${res.status}`);
    } catch (err) {
      last = err;
    }
    await new Promise(r => setTimeout(r, 2000));   // Dienst startet gerade neu
  }
  throw last;
}

function writeLocal(token) {
  if (!existsSync('.env.local')) return;
  const txt = readFileSync('.env.local', 'utf8');
  const replaced = txt.replace(new RegExp(`^${SECRET_NAME}=.*$`, 'm'), `${SECRET_NAME}=${token}`);
  if (replaced !== txt) writeFileSync('.env.local', replaced);
}

async function boxStep(host, url, token) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`      Box (${host}), Versuch ${attempt}: ${rotateOnHetzner(host, token)}`);
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      console.log(`      Box-Versuch ${attempt} gescheitert: ${err.message}`);
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  if (lastErr) {
    throw new Error('Box nicht rotiert — die Live-Seite hat schon das neue Token, der Knopf antwortet 401.\n'
      + '  Nachholen: node scripts/rotate-refresh-token.mjs --box-only');
  }
  console.log('      Pruefe die Box mit dem neuen Token (/healthz?detail=services)…');
  const health = await verifyHetzner(url, token);
  console.log('      OK', health);
}

async function main() {
  const env = loadDotEnv('.env.local');
  const ghToken = env.GH_TOKEN || process.env.GH_TOKEN;
  const hetznerUrl = env.HETZNER_REFRESH_URL || process.env.HETZNER_REFRESH_URL;
  const hetznerHost = env.HETZNER_HOST || (hetznerUrl ? new URL(hetznerUrl).hostname : null);
  if (!hetznerHost) throw new Error('HETZNER_REFRESH_URL fehlt in .env.local');
  if (!SKIP_GITHUB && !BOX_ONLY && !ghToken) throw new Error('GH_TOKEN fehlt in .env.local — setzen oder --skip-github');

  if (BOX_ONLY) {
    const token = env[SECRET_NAME];
    if (!token) throw new Error(`${SECRET_NAME} fehlt in .env.local`);
    console.log('[box-only] Token aus .env.local auf die Box…');
    await boxStep(hetznerHost, hetznerUrl, token);
    return;
  }

  const oldToken = env[SECRET_NAME];
  if (!oldToken) throw new Error(`${SECRET_NAME} fehlt in .env.local — ohne alten Wert gaebe es bei einem Deploy-Fehler keinen Rueckweg.`);
  const newToken = generateToken();
  console.log(`[1/6] Neues Token erzeugt (${newToken.length} Zeichen)`);
  if (DRY_RUN) {
    console.log('      DRY RUN — wuerde: Vercel setzen → neu ausrollen → .env.local → Box + Neustart → pruefen → GitHub');
    return;
  }

  console.log('[2/6] Vercel (production + development)…');
  const envChangedAt = Date.now();
  dep.setEnv(SECRET_NAME, newToken);
  console.log('      OK');

  console.log('[3/6] Produktion neu ausrollen…');
  try {
    await dep.redeployProduction({ since: envChangedAt, gitMessage: 'chore: rotate refresh-api token' });
  } catch (err) {
    console.log(`      Deploy gescheitert (${err.deployPhase || 'unknown'}): ${err.message}`);
    console.log('      Setze den alten Wert in Vercel zurueck — Box und .env.local bleiben unveraendert…');
    dep.setEnv(SECRET_NAME, oldToken);
    throw new Error('Rotation abgebrochen, alter Zustand wiederhergestellt (Vercel = alter Wert, Box = alter Wert).');
  }

  console.log('[4/6] .env.local…');
  writeLocal(newToken);

  console.log('[5/6] Box rotieren + pruefen…');
  await boxStep(hetznerHost, hetznerUrl, newToken);

  if (!SKIP_GITHUB) {
    console.log('[6/6] GitHub-Secret…');
    await updateGitHubSecret(newToken, ghToken);
    console.log('      OK');
  } else console.log('[6/6] GitHub uebersprungen');

  console.log('\nFertig. Das neue Token steht in .env.local.');
}

let releaseLock = () => {};
try {
  releaseLock = acquireLock('rotate-refresh-token');
} catch (err) {
  console.error('FAILED:', err.message);
  process.exit(1);
}
main()
  .then(() => releaseLock())
  .catch(e => { releaseLock(); console.error('FAILED:', e.message); process.exit(1); });

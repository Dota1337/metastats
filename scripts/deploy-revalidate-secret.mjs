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
// Seit 24.10.2026 auch fuer SNAPSHOT_PUBLISHER_TOKEN (Publisher-Vorrecht der
// Box, app/lib/snapshot-publisher.mjs) — gleicher Weg, ein Skript statt einer
// weiteren Kopie: --name=SNAPSHOT_PUBLISHER_TOKEN --skip-github. Das Geheimnis
// erscheint in keiner Ausgabe (stand bis dahin im Protokoll).
//
// Usage:
//   node scripts/deploy-revalidate-secret.mjs              # full deploy
//   node scripts/deploy-revalidate-secret.mjs --name=SNAPSHOT_PUBLISHER_TOKEN --skip-github
//   node scripts/deploy-revalidate-secret.mjs --dry-run    # nur Plan zeigen
//   node scripts/deploy-revalidate-secret.mjs --skip-box   # Hetzner skip
//   node scripts/deploy-revalidate-secret.mjs --skip-vercel
//   node scripts/deploy-revalidate-secret.mjs --skip-github
//
// Voraussetzungen (wie bei rotate-refresh-token.mjs):
//   - .env.local mit GH_TOKEN (Fine-grained PAT, Repo→Secrets write)
//   - HETZNER_HOST oder HETZNER_REFRESH_URL gesetzt (für die Box-IP)
//   - vercel CLI authentifiziert
//   - libsodium-wrappers als dev-dep

import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import sodium from 'libsodium-wrappers';
import { createVercelDeploy, acquireLock } from './lib/vercel-deploy.mjs';

const REPO = 'Dota1337/metastats';
// Nur diese Namen: der Wert landet per sed in der Box-env, ein Tippfehler
// legte sonst eine Variable an, die niemand liest.
const NAMES = ['REVALIDATE_SECRET', 'SNAPSHOT_PUBLISHER_TOKEN'];
const SECRET_NAME = (process.argv.find(a => a.startsWith('--name=')) || '--name=REVALIDATE_SECRET').slice(7);
if (!NAMES.includes(SECRET_NAME)) {
  console.error(`--name muss einer von ${NAMES.join(', ')} sein`);
  process.exit(2);
}

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_BOX = process.argv.includes('--skip-box');
const SKIP_VERCEL = process.argv.includes('--skip-vercel');
const SKIP_GITHUB = process.argv.includes('--skip-github');
const INIT = process.argv.includes('--init');
const FORCE = process.argv.includes('--force');

// Wer den Wert auf der Box liest (Grep 24.10.2026). Laeuft einer davon, haelt er
// den alten Wert im Speicher: der Publisher prueft sein Vorrecht nur beim Start
// (publish-snapshot-bundle.mjs, assertPublisherAccepted) und verliert danach
// jeden Abruf mit 403 — ein ~2-h-Lauf waere umsonst.
const READERS = {
  SNAPSHOT_PUBLISHER_TOKEN: ['metastats-snapshot-publisher.service', 'metastats-lol-builds-publish.service',
    'metastats-mirror-leaderboard.service', 'metastats-mirror-ligen.service',
    'metastats-mirror-regions.service', 'metastats-mirror-rising.service',
    'metastats-mirror-mv-pages.service', 'metastats-mirror-slow-pages.service',
    'metastats-mirror-lol-leaderboard.service'],
  // Die Crawler revalidieren nur am Ende, ein Fehlschlag dort laesst den
  // Edge-Speicher bis zum Ablauf stehen — kein Abbruch, nur ein Hinweis.
  REVALIDATE_SECRET: [],
};
const REVALIDATE_SOFT = ['metastats-daily-crawl.service', 'metastats-daily-crawl-resume.service'];

const dep = createVercelDeploy();

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
    + `fi && grep -c "^${SECRET_NAME}=" /etc/metastats-crawler/env`;
  return run('ssh', sshArgs(cmd));
}

function activeOnBox(host, units) {
  if (!units.length) return [];
  const cmd = units.map(u => `printf '%s %s\\n' ${u} "$(systemctl show -p ActiveState --value ${u})"`).join('; ');
  const r = spawnSync('ssh', ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', `root@${host}`, cmd],
    { encoding: 'utf8', timeout: 30_000, killSignal: 'SIGKILL' });
  if (r.status !== 0) throw new Error(`Box nicht erreichbar (ssh exit ${r.status ?? r.error?.code})`);
  return String(r.stdout).trim().split('\n').map(l => l.split(' '))
    .filter(([, st]) => st === 'active' || st === 'activating' || st === 'reloading').map(([u]) => u);
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
  const hetznerHost = env.HETZNER_HOST || process.env.HETZNER_HOST || (hetznerUrl ? new URL(hetznerUrl).hostname : null);
  if (!SKIP_BOX && !hetznerHost) {
    throw new Error('HETZNER_REFRESH_URL missing — set or use --skip-box');
  }

  const secret = generateSecret();
  console.log(`[1/5] Generated ${SECRET_NAME} (${secret.length} chars hex)`);

  if (DRY_RUN) {
    console.log('      DRY RUN — wuerde: laufende Leser pruefen → Vercel → neu ausrollen → Box → GitHub → .env.local');
    return;
  }

  // Ohne alten Wert gibt es bei einem Deploy-Fehler keinen Rueckweg.
  const oldSecret = env[SECRET_NAME];
  if (!oldSecret && !INIT && !SKIP_VERCEL) {
    throw new Error(`${SECRET_NAME} fehlt in .env.local — bei Erst-Einrichtung --init angeben.`);
  }

  if (!SKIP_BOX) {
    const busy = activeOnBox(hetznerHost, READERS[SECRET_NAME]);
    if (busy.length && !FORCE) {
      throw new Error(`Auf der Box laeuft gerade: ${busy.join(', ')} — er haelt den alten Wert und wuerde mitten im Lauf scheitern. Spaeter erneut versuchen (oder --force).`);
    }
    if (SECRET_NAME === 'REVALIDATE_SECRET') {
      const soft = activeOnBox(hetznerHost, REVALIDATE_SOFT);
      if (soft.length) console.log(`      Hinweis: ${soft.join(', ')} laeuft — sein Revalidieren am Ende scheitert, der Edge-Speicher laeuft dann normal ab.`);
    }
  }

  if (!SKIP_VERCEL) {
    console.log('[2/6] Vercel (production + development)…');
    const envChangedAt = Date.now();
    dep.setEnv(SECRET_NAME, secret);
    console.log('[3/6] Produktion neu ausrollen…');
    try {
      await dep.redeployProduction({ since: envChangedAt, gitMessage: `chore: rotate ${SECRET_NAME}` });
    } catch (err) {
      console.log(`      Deploy gescheitert (${err.deployPhase || 'unknown'}): ${err.message}`);
      if (oldSecret) {
        console.log('      Setze den alten Wert in Vercel zurueck — Box und .env.local bleiben unveraendert…');
        dep.setEnv(SECRET_NAME, oldSecret);
      }
      throw new Error(`Abgebrochen, ${oldSecret ? 'alter Zustand wiederhergestellt' : 'Vercel traegt den neuen Wert, die Box noch nicht'}.`);
    }
  } else console.log('[2-3/6] Vercel uebersprungen');

  if (!SKIP_BOX) {
    console.log(`[4/6] Hetzner-Box (${hetznerHost})…`);
    const out = deployToHetzner(hetznerHost, secret);
    console.log('      Box bestaetigt, Zeilen mit dem Namen:', out);
  } else console.log('[4/6] Hetzner uebersprungen');

  if (!SKIP_GITHUB) {
    console.log('[5/6] GitHub-Secret…');
    await updateGitHubSecret(secret, ghToken);
    console.log('      OK');
  } else console.log('[5/6] GitHub uebersprungen');

  console.log('[6/6] .env.local…');
  updateLocalEnv(secret);

  console.log(`\nFertig. ${SECRET_NAME} ist ueberall neu.`);
}

let releaseLock = () => {};
try {
  releaseLock = acquireLock(`deploy-revalidate-secret ${SECRET_NAME}`);
} catch (err) {
  console.error('FAILED:', err.message);
  process.exit(1);
}
main()
  .then(() => releaseLock())
  .catch(e => { releaseLock(); console.error('FAILED:', e.message); process.exit(1); });

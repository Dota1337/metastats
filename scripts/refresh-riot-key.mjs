#!/usr/bin/env node
// Syncs the LoL Riot API key across every place we use it.
// Reads .env.local for:
//   - RIOT_API_KEY        (LoL — currently a dev key, expires every 24h)
//   - GH_TOKEN            (PAT with repo:secrets write on Dota1337/metastats)
//   - HETZNER_REFRESH_URL (used to derive the crawler-box host; HETZNER_HOST overrides)
// Updates Vercel Production + Development env + GitHub Actions repo secret,
// pushes the key to the Hetzner crawler box + kicks its high-elo marketvalue
// refresh (the only moment the dev key is guaranteed fresh — see
// metastats-lol-marketvalue.service), then triggers a redeploy.
//
// RIOT_API_KEY_TFT (TFT production key) is permanent and intentionally not
// synced here — it stays as set in Vercel/GitHub.
//
// Usage:
//   node scripts/refresh-riot-key.mjs
//   node scripts/refresh-riot-key.mjs --skip-deploy # don't push the empty commit
//   node scripts/refresh-riot-key.mjs --skip-box    # don't touch the Hetzner box

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const LOL_STATUS_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';

const SKIP_DEPLOY = process.argv.includes('--skip-deploy');

const KEYS = [
  { envName: 'RIOT_API_KEY', secretName: 'RIOT_API_KEY', validateUrl: LOL_STATUS_URL, label: 'LoL' },
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

// Deploy-Ausloeser. Bis 2026-09-02 war das ein leerer Commit plus `git push` —
// und damit die einzige Stelle, an der die Rotation regelmaessig gescheitert ist:
// 40 Bot-Commits in 60 Tagen (`git log --since=60.days --format='%an'`) machen
// den abgelehnten Push zum Normalfall. Danach standen Vercel-Env, GitHub-Secret
// und Box auf dem neuen Key, die Live-Seite auf dem alten — Meldung: `git failed: 1`.
//
// Ein blinder Rebase-Retry loest das nicht: `run()` sieht nur den Exit-Code und
// kann einen fremden Commit nicht von einem der 11 pre-push-Gates unterscheiden,
// und ein beim Rebase gedroppter Leer-Commit macht den zweiten Push zum stillen
// No-Op mit Exit 0. Deshalb wird der Deploy jetzt direkt bei Vercel angestossen:
// kein Commit, kein Push, keine Gates, keine 38. Leiche in der Historie.
// `vercel redeploy` wartet ohne --no-wait, bis der Build steht.
function triggerRedeploy() {
  const prod = runCapture('vercel', ['ls', '--prod', '--no-color']);
  const url = String(prod.stdout || '').match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
  if (url) {
    const r = spawnSync('vercel', ['redeploy', url, '--target', 'production', '--no-color'],
      { stdio: 'inherit', shell: true });
    if (r.status === 0) return;
    console.log('      WARN: vercel redeploy fehlgeschlagen — fallback auf den Git-Weg.');
  } else {
    console.log('      WARN: keine Prod-URL aus `vercel ls --prod` — fallback auf den Git-Weg.');
  }
  redeployViaGit();
}

// Rueckfall. Nur noch Notnagel, deshalb mit den Guards, die dem alten Weg fehlten:
// bei schmutzigem Arbeitsbaum gar nicht erst committen, und nach dem Rebase
// pruefen, ob der leere Commit ueberhaupt ueberlebt hat.
function redeployViaGit() {
  if (runCapture('git', ['status', '--porcelain']).stdout?.trim()) {
    throw new Error('Arbeitsbaum nicht sauber — kein Deploy-Commit angelegt.');
  }
  run('git', ['commit', '--allow-empty', '-m', '"chore: refresh Riot API keys"']);
  if (spawnSync('git', ['push', 'origin', 'main'], { stdio: 'inherit', shell: true }).status === 0) return;

  console.log('      Push abgelehnt — einmal rebasen und erneut versuchen...');
  run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
  const ahead = Number(runCapture('git', ['rev-list', '--count', '@{u}..HEAD']).stdout?.trim() || '0');
  if (ahead < 1) throw new Error('Deploy-Commit ist beim Rebase verlorengegangen — kein Deploy ausgeloest.');
  run('git', ['push', 'origin', 'main']);
}

// Best-effort: push the freshly-validated LoL key to the Hetzner crawler box
// and kick the high-elo marketvalue refresh. This is the only moment the dev
// key is guaranteed valid, so it's also the right moment to run the box job
// (which self-throttles to ~weekly). SSH/host problems must NOT fail the key
// sync — you might rotate from a machine without box access.
function syncKeyToHetzner(env, key) {
  const host = env.HETZNER_HOST
    || (env.HETZNER_REFRESH_URL ? new URL(env.HETZNER_REFRESH_URL).hostname : null);
  if (!host) {
    console.log('      (no HETZNER_HOST / HETZNER_REFRESH_URL in .env.local — skipping box sync)');
    return;
  }
  // RGAPI keys are [A-Za-z0-9-] only, so they're safe inside the sed `#`
  // expression and the single-quoted printf fallback below.
  const remote = [
    'set -e',
    'f=/etc/metastats-crawler/env',
    'touch "$f"',
    `if grep -q '^RIOT_API_KEY=' "$f"; then sed -i 's#^RIOT_API_KEY=.*#RIOT_API_KEY=${key}#' "$f"; else printf 'RIOT_API_KEY=%s\\n' '${key}' >> "$f"; fi`,
    // --no-block: don't wait out the multi-hour pass; oneshot semantics de-dupe
    // a concurrent run, and the wrapper self-throttles to ~weekly.
    'systemctl start --no-block metastats-lol-marketvalue.service',
    // KEIN Restart von metastats-refresh-api.service (entfernt 2026-09-02):
    // der Dienst liest ausschliesslich RIOT_API_KEY_TFT
    // (scripts/refresh-api-server.mjs:150), und keiner seiner Importe fasst den
    // LoL-Key an (`grep -rn "RIOT_API_KEY\b" scripts/lib/ | grep -v _TFT` → 0).
    // Der Restart war also wirkungslos und hat den Dauerdienst auf :4100 bei
    // jeder taeglichen Rotation mitten in laufenden Anfragen gekappt.
    // Wieder aufnehmen, falls hier je der TFT-Key mitrotiert wird.
    'echo "      box keyed + lol-marketvalue kicked"',
  ].join('; ');
  const r = spawnSync('ssh',
    ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, remote],
    { stdio: 'inherit' });
  if (r.status !== 0) {
    console.log(`      WARN: box sync failed (ssh exit ${r.status ?? r.error?.message ?? '?'}) — Vercel/GitHub keys are updated; box stays on its previous key.`);
  }
}

async function main() {
  const env = readEnv();
  const ghToken = env.GH_TOKEN;
  if (!ghToken || !ghToken.startsWith('github_pat_')) throw new Error('GH_TOKEN missing in .env.local');

  const present = KEYS.filter(k => env[k.envName] && env[k.envName].startsWith('RGAPI-'));
  if (present.length === 0) throw new Error('No RIOT_API_KEY found in .env.local');

  const SKIP_BOX = process.argv.includes('--skip-box');
  const boxSteps = SKIP_BOX ? 0 : present.filter(k => k.envName === 'RIOT_API_KEY').length;
  const step = (n, total, msg) => console.log(`[${n}/${total}] ${msg}`);
  const totalSteps = present.length * 3 + boxSteps + (SKIP_DEPLOY ? 0 : 1);
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

  // Phase 4: push the validated LoL key to the Hetzner box + kick its high-elo
  // marketvalue refresh (best-effort; never fails the key sync).
  if (!SKIP_BOX) {
    for (const k of present.filter(k => k.envName === 'RIOT_API_KEY')) {
      step(++n, totalSteps, 'Syncing LoL key to Hetzner box + kicking marketvalue refresh...');
      syncKeyToHetzner(env, env[k.envName]);
    }
  }

  if (!SKIP_DEPLOY) {
    step(++n, totalSteps, 'Triggering Vercel redeploy...');
    try {
      triggerRedeploy();
    } catch (err) {
      // Zustandsbilanz statt nur `git failed: 1`. Wer hier abbricht, muss wissen,
      // dass ueberall der neue Key steht — nur auf der Live-Seite nicht.
      err.deployState = [
        '  Vercel-Env:      NEU',
        '  GitHub-Secret:   NEU',
        `  Hetzner-Box:     ${SKIP_BOX ? 'uebersprungen (--skip-box)' : 'NEU'}`,
        '  Live-Seite:      ALT — der Deploy fehlt.',
        '  Nachholen:       vercel redeploy $(vercel ls --prod) --target production',
      ].join('\n');
      throw err;
    }
  }

  console.log(`\nDone. Synced ${present.length} key(s): ${present.map(k => k.label).join(', ')}`);
}

main().catch(err => {
  console.error('ERROR:', err.message);
  if (err.deployState) console.error(`\nStand nach dem Abbruch:\n${err.deployState}`);
  process.exit(1);
});

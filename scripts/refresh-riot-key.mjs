#!/usr/bin/env node
// Syncs the LoL Riot API key across every place we use it.
// Reads .env.local for:
//   - RIOT_API_KEY        (LoL — currently a dev key, expires every 24h)
//   - GH_TOKEN            (PAT with repo:secrets write on Dota1337/metastats)
//   - HETZNER_REFRESH_URL (used to derive the crawler-box host; HETZNER_HOST overrides)
// Updates Vercel Production + Development env + GitHub Actions repo secret,
// pushes the key to the Hetzner crawler box, triggers a redeploy, verifies that
// the live domain really serves it — and only then kicks the box job that talks
// to the live site (see metastats-lol-marketvalue.service).
//
// RIOT_API_KEY_TFT (TFT production key) is permanent and intentionally not
// synced here — it stays as set in Vercel/GitHub.
//
// Usage:
//   node scripts/refresh-riot-key.mjs
//   node scripts/refresh-riot-key.mjs --skip-deploy # don't trigger a deploy
//   node scripts/refresh-riot-key.mjs --skip-box    # don't touch the Hetzner box

import { readFileSync, writeFileSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import sodium from 'libsodium-wrappers';

const REPO = 'Dota1337/metastats';
const LOL_STATUS_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';

// Die Produktions-Domain. `metastats.gg` antwortet 307 auf `www.` (gemessen
// 2026-09-18), ein Check gegen die nackte Domain pruefte also die Weiterleitung
// statt das Deployment.
const PROD_DOMAIN = 'www.metastats.gg';
// Verifikations-Abruf: die Route schlaegt bei ungueltigem LoL-Key mit HTTP 503
// und `riot_auth` fehl (app/api/summoner/route.ts:35-39) — genau der Zustand,
// den die Rotation vom 2026-09-18 unbemerkt hinterlassen hat.
const LIVE_PROBE_PATH = '/api/summoner?name=Caps%231337&region=euw1';

// Zeitdeckel. Basis sind eigene Messungen ueber die letzten 12 Prod-Deployments
// (`vercel api "/v6/deployments?limit=12&target=production"`): Build 37-100 s,
// schlechtester beobachteter Lauf 229 s. 600 s ist das 2,6-fache davon.
const REDEPLOY_CALL_MS = 60_000;   // --no-wait liefert nur die URL zurueck
const POLL_READY_MS = Number(process.env.RIOT_KEY_POLL_READY_MS || 600_000);
const POLL_ALIAS_MS = 30_000;      // Auto-Alias kam gemessen mit 0 s Verzug
const POLL_LIVE_MS = 60_000;       // Edge-Propagation nach dem Umhaengen
const POLL_INTERVAL_MS = Number(process.env.RIOT_KEY_POLL_INTERVAL_MS || 10_000);
const VERCEL_CALL_MS = 90_000;     // Deckel fuer jeden einzelnen CLI-Aufruf
const GIT_CALL_MS = 120_000;

const SKIP_DEPLOY = process.argv.includes('--skip-deploy');
const SKIP_BOX = process.argv.includes('--skip-box');

const KEYS = [
  { envName: 'RIOT_API_KEY', secretName: 'RIOT_API_KEY', validateUrl: LOL_STATUS_URL, label: 'LoL' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

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

// Einzel-Instanz-Sperre. Zwei parallele Laeufe wuerden sich beim
// `vercel env rm`/`add` ins Gehege kommen: das `rm` ignoriert seinen Exit-Code
// (es schlaegt planmaessig fehl, wenn die Variable fehlt), also kann Lauf B die
// Variable loeschen, die Lauf A gerade angelegt hat — Ergebnis waere ein
// Deployment ganz ohne Key.
const LOCK_FILE = join(tmpdir(), 'metastats-refresh-riot-key.lock');
const LOCK_STALE_MS = 30 * 60_000;

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const ageMs = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (ageMs < LOCK_STALE_MS) {
      throw new Error(`Es laeuft bereits eine Rotation (${LOCK_FILE}, ${Math.round(ageMs / 1000)} s alt). Abgebrochen — zwei Laeufe wuerden sich die Vercel-Variablen gegenseitig ueberschreiben.`);
    }
    unlinkSync(LOCK_FILE);
  }
  writeFileSync(LOCK_FILE, `${process.pid}\n`);
}

function releaseLock() {
  try { if (existsSync(LOCK_FILE)) unlinkSync(LOCK_FILE); } catch { /* egal */ }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, timeout: GIT_CALL_MS, killSignal: 'SIGKILL', ...opts });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`${cmd} hat das Zeitlimit gerissen`);
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.status}`);
}

function runCapture(cmd, args, input) {
  return spawnSync(cmd, args, { input, shell: true, encoding: 'utf8', timeout: GIT_CALL_MS, killSignal: 'SIGKILL' });
}

// Das Vercel-CLI wird OHNE Shell gestartet. Mit `shell: true` toetet ein
// `timeout` nur die cmd.exe, waehrend der Node-Enkelprozess als Waise
// weiterlaeuft (gemessen 2026-09-18: PID 29108 lief 898 s weiter, erst ein
// manuelles Stop-Process hat ihn beendet). Node >= 18.20 startet `vercel.cmd`
// aber nicht mehr ohne Shell, deshalb wird das JS-Entry direkt aufgeloest und
// mit `process.execPath` gestartet.
let VERCEL_ENTRY;
function vercelEntry() {
  if (VERCEL_ENTRY !== undefined) return VERCEL_ENTRY;
  VERCEL_ENTRY = '';
  const candidates = [];
  // Erst der Starter auf dem PATH: `npm root -g` zeigt auf dieser Workstation
  // ins Node-Installationsverzeichnis, das globale Paket liegt aber unter
  // %APPDATA%\npm (gemessen 2026-09-18 mit `which vercel`).
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['vercel'],
    { encoding: 'utf8', shell: true, timeout: 30_000 }).stdout?.trim();
  for (const line of String(which || '').split(/\r?\n/)) {
    const p = line.trim();
    if (p) candidates.push(join(dirname(p), 'node_modules', 'vercel', 'dist', 'vc.js'));
  }
  const root = spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true, timeout: 60_000 }).stdout?.trim();
  if (root) candidates.push(join(root, 'vercel', 'dist', 'vc.js'));
  if (process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'npm', 'node_modules', 'vercel', 'dist', 'vc.js'));
  for (const c of candidates) {
    if (existsSync(c)) { VERCEL_ENTRY = c; break; }
  }
  if (!VERCEL_ENTRY) {
    console.log('      WARN: vercel-Entry nicht gefunden — CLI laeuft ueber die Shell, ein Zeitlimit kann dann einen Waisenprozess hinterlassen.');
  }
  return VERCEL_ENTRY;
}

function vercel(args, { timeout = VERCEL_CALL_MS, input } = {}) {
  const entry = vercelEntry();
  const opts = { input, encoding: 'utf8', timeout, killSignal: 'SIGKILL' };
  const r = entry
    ? spawnSync(process.execPath, [entry, ...args], opts)
    : spawnSync('vercel', args, { ...opts, shell: true });
  r.timedOut = r.error?.code === 'ETIMEDOUT';
  return r;
}

// Das CLI schreibt Update-Banner und Fortschrittszeilen in denselben Strom wie
// die JSON-Antwort, deshalb wird der JSON-Block herausgeschnitten statt der
// ganze Ausdruck geparst.
function extractJson(text) {
  const s = String(text || '');
  for (const pair of [['{', '}'], ['[', ']']]) {
    const a = s.indexOf(pair[0]);
    const b = s.lastIndexOf(pair[1]);
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)); } catch { /* naechste Klammerform */ }
    }
  }
  return null;
}

function vercelJson(args, opts) {
  const r = vercel(args, opts);
  if (r.status !== 0) return null;
  return extractJson(r.stdout);
}

async function validateRiotKey(key, url, label) {
  const r = await fetchIPv4(url, { headers: { 'X-Riot-Token': key } });
  if (r.status !== 200) throw new Error(`Riot API rejected ${label} key: HTTP ${r.status}`);
}

async function updateVercelEnv(targets, secretName, key) {
  for (const target of targets) {
    // Das `rm` schlaegt planmaessig fehl, wenn die Variable noch nicht existiert —
    // der Exit-Code wird deshalb bewusst ignoriert. Gegen den Ueberschneidungs-
    // Fall schuetzt die Sperre oben, nicht dieser Aufruf.
    vercel(['env', 'rm', secretName, target, '--yes', '--no-color']);
    const add = vercel(['env', 'add', secretName, target, '--no-color'], { input: key });
    if (add.status !== 0) {
      throw new Error(`vercel env add ${secretName} ${target} failed${add.timedOut ? ' (Zeitlimit)' : ''}`);
    }
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

// ---------------------------------------------------------------------------
// Deploy
// ---------------------------------------------------------------------------
// Bis 2026-09-02 war der Ausloeser ein leerer Commit plus `git push` — und damit
// die Stelle, an der die Rotation regelmaessig scheiterte: 40 Bot-Commits in
// 60 Tagen machen den abgelehnten Push zum Normalfall.
//
// Seit 2026-09-18 laeuft der Anstoss mit `--no-wait` und eigenem Warten. Grund:
// an dem Tag hing `vercel redeploy` 898 s, obwohl der Build nach 60 s fertig war,
// und die Domain zeigte danach weiter auf das alte Deployment — die Seite lief
// 15 Minuten lang auf dem abgelaufenen Key, ohne dass irgendetwas gemeldet hat.
// Das Warten gehoert deshalb hierher, wo wir es abbrechen koennen, und am Ende
// steht ein echter Nachweis statt eines Exit-Codes.

function deploymentHost(urlOrHost) {
  return String(urlOrHost || '').replace(/^https?:\/\//, '').replace(/\/.*$/, '');
}

function fetchDeployment(idOrHost) {
  return vercelJson(['api', `/v13/deployments/${deploymentHost(idOrHost)}?withGitRepoInfo=false`]);
}

function listReadyProdDeployments(limit = 20) {
  const j = vercelJson(['api', `/v6/deployments?limit=${limit}&target=production&state=READY`]);
  return Array.isArray(j?.deployments) ? j.deployments : [];
}

function newestProdDeployment() {
  const j = vercelJson(['api', '/v6/deployments?limit=1&target=production']);
  return Array.isArray(j?.deployments) ? j.deployments[0] || null : null;
}

function deployError(message, phase, extra = {}) {
  const err = new Error(message);
  err.deployPhase = phase;
  Object.assign(err, extra);
  return err;
}

// Welches Deployment neu gebaut wird: das juengste, das wirklich READY ist.
// Vorher war es der erste Treffer eines Regex auf `vercel ls` — der konnte auch
// ein fehlgeschlagenes oder noch bauendes Deployment erwischen.
function pickRedeploySource() {
  const ready = listReadyProdDeployments();
  if (!ready.length) return null;
  ready.sort((a, b) => (b.created || 0) - (a.created || 0));
  return ready[0];
}

async function waitForReady(host, deadline) {
  let last = null;
  while (Date.now() < deadline) {
    const d = fetchDeployment(host);
    if (d) {
      last = d;
      const state = d.readyState || d.status;
      if (state === 'READY') return d;
      if (state === 'ERROR' || state === 'CANCELED') {
        throw deployError(
          `Build ${state}: ${d.inspectorUrl || host}`,
          'build-failed',
          { deployUrl: host, inspectorUrl: d.inspectorUrl },
        );
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw deployError(
    `Der Build war nach ${Math.round(POLL_READY_MS / 1000)} s noch nicht fertig (zuletzt: ${last?.readyState || 'unbekannt'}).`,
    'unknown',
    { deployUrl: host, inspectorUrl: last?.inspectorUrl },
  );
}

async function waitForAlias(host, deadline) {
  while (Date.now() < deadline) {
    const d = fetchDeployment(host);
    if (d?.aliasAssigned) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// Die Aliases-Zeile von `vercel inspect <deployment>` taugt NICHT als Nachweis —
// sie zeigt nur, was beim Deploy automatisch zugewiesen werden sollte. Gemessen
// wird deshalb rueckwaerts: welches Deployment liefert die Domain gerade aus?
function servingDeployment() {
  const j = vercelJson(['inspect', PROD_DOMAIN, '--format', 'json', '--no-color']);
  const host = deploymentHost(j?.url || j?.deployment?.url || '');
  return host || null;
}

async function waitForServing(host, deadline) {
  while (Date.now() < deadline) {
    if (servingDeployment() === deploymentHost(host)) return true;
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// Letzter Nachweis: die Live-Seite beantwortet einen Abruf, der ohne gueltigen
// LoL-Key nicht funktionieren kann. 429 ist Riots Ratenbremse und kein Beleg
// gegen den Key, deshalb zweimal nachfassen.
async function probeLiveKey() {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await fetchIPv4(`https://${PROD_DOMAIN}${LIVE_PROBE_PATH}`, {
      headers: { 'User-Agent': 'metastats-refresh-riot-key' },
    });
    if (r.status === 200) return;
    if (r.status === 429 && attempt < 3) { await sleep(POLL_INTERVAL_MS); continue; }
    const body = (await r.text()).slice(0, 200);
    throw deployError(
      `Live-Abruf ${LIVE_PROBE_PATH} antwortet HTTP ${r.status}: ${body}`,
      r.status === 503 ? 'stale-key' : 'unknown',
    );
  }
}

async function triggerRedeploy() {
  const source = pickRedeploySource();
  if (!source) {
    console.log('      WARN: kein fertiges Prod-Deployment gefunden — Rueckfall auf den Git-Weg.');
    return redeployViaGitAndWait();
  }

  const r = vercel(['redeploy', source.url, '--target', 'production', '--no-wait', '--no-color'],
    { timeout: REDEPLOY_CALL_MS });
  // Das CLI verteilt sich auf beide Stroeme (Fortschritt nach stderr, Ergebnis
  // nach stdout), deshalb wird in beiden nach der frischen URL gesucht.
  const fresh = `${r.stdout || ''}\n${r.stderr || ''}`.match(/https:\/\/[^\s]+\.vercel\.app/)?.[0];
  if (r.status !== 0 || !fresh) {
    console.log(`      WARN: vercel redeploy fehlgeschlagen${r.timedOut ? ' (Zeitlimit)' : ''} — Rueckfall auf den Git-Weg.`);
    process.stderr.write(String(r.stderr || ''));
    return redeployViaGitAndWait();
  }
  console.log(`      Deployment angestossen: ${fresh}`);
  return awaitDeployment(fresh);
}

async function awaitDeployment(url) {
  const host = deploymentHost(url);

  const ready = await waitForReady(host, Date.now() + POLL_READY_MS);
  console.log('      Build fertig.');

  if (!(await waitForAlias(host, Date.now() + POLL_ALIAS_MS))) {
    // Vor dem Umhaengen nachsehen, ob inzwischen ein fremdes, neueres Deployment
    // da ist (z. B. ein Push auf main waehrend der Rotation). In dem Fall wird
    // NICHT dazwischengefunkt — sonst wuerde die Rotation fremden Code
    // zurueckrollen.
    const newest = newestProdDeployment();
    const ourCreated = ready.createdAt || ready.created || 0;
    if (newest && deploymentHost(newest.url) !== host && (newest.created || 0) > ourCreated) {
      throw deployError(
        `Ein neueres Deployment (${newest.url}) ist dazwischengekommen — es wurde bewusst nichts umgehaengt.`,
        'foreign',
        { deployUrl: host, foreignUrl: newest.url },
      );
    }
    console.log('      Domain haengt noch am alten Stand — haenge um...');
    const p = vercel(['promote', host, '--timeout', '90s', '--yes', '--no-color']);
    if (p.status !== 0) {
      process.stderr.write(String(p.stderr || ''));
      throw deployError(
        `vercel promote fehlgeschlagen${p.timedOut ? ' (Zeitlimit)' : ''}.`,
        'no-alias',
        { deployUrl: host },
      );
    }
  }

  if (!(await waitForServing(host, Date.now() + POLL_LIVE_MS))) {
    throw deployError(
      `Die Domain ${PROD_DOMAIN} liefert weiterhin ein anderes Deployment aus (${servingDeployment() || 'unbekannt'}).`,
      'no-alias',
      { deployUrl: host },
    );
  }

  await probeLiveKey();
  console.log(`      Live bestaetigt: ${PROD_DOMAIN} liefert ${host} aus und beantwortet ${LIVE_PROBE_PATH} mit HTTP 200.`);
  return host;
}

// Rueckfall. Nur noch Notnagel, deshalb mit den Guards, die dem alten Weg fehlten:
// bei schmutzigem Arbeitsbaum gar nicht erst committen, und nach dem Rebase
// pruefen, ob der leere Commit ueberhaupt ueberlebt hat.
function redeployViaGit() {
  if (runCapture('git', ['status', '--porcelain']).stdout?.trim()) {
    throw deployError('Arbeitsbaum nicht sauber — kein Deploy-Commit angelegt.', 'unknown');
  }
  run('git', ['commit', '--allow-empty', '-m', '"chore: refresh Riot API keys"']);
  const push = spawnSync('git', ['push', 'origin', 'main'],
    { stdio: 'inherit', shell: true, timeout: GIT_CALL_MS, killSignal: 'SIGKILL' });
  if (push.status === 0) return;

  console.log('      Push abgelehnt — einmal rebasen und erneut versuchen...');
  run('git', ['pull', '--rebase', '--autostash', 'origin', 'main']);
  const ahead = Number(runCapture('git', ['rev-list', '--count', '@{u}..HEAD']).stdout?.trim() || '0');
  if (ahead < 1) throw deployError('Deploy-Commit ist beim Rebase verlorengegangen — kein Deploy ausgeloest.', 'unknown');
  run('git', ['push', 'origin', 'main']);
}

async function redeployViaGitAndWait() {
  const before = deploymentHost(newestProdDeployment()?.url || '');
  redeployViaGit();
  const deadline = Date.now() + POLL_READY_MS;
  while (Date.now() < deadline) {
    const newest = newestProdDeployment();
    const host = deploymentHost(newest?.url || '');
    if (host && host !== before) return awaitDeployment(host);
    await sleep(POLL_INTERVAL_MS);
  }
  throw deployError('Nach dem Push ist kein neues Deployment aufgetaucht.', 'unknown');
}

// ---------------------------------------------------------------------------
// Hetzner-Box
// ---------------------------------------------------------------------------
// Best-effort: SSH- oder Host-Probleme duerfen den Key-Sync NICHT scheitern
// lassen — rotiert wird auch von Rechnern ohne Box-Zugang.
function boxHost(env) {
  return env.HETZNER_HOST
    || (env.HETZNER_REFRESH_URL ? new URL(env.HETZNER_REFRESH_URL).hostname : null);
}

function runOnBox(host, lines, label) {
  const r = spawnSync('ssh',
    ['-o', 'ConnectTimeout=12', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', `root@${host}`, lines.join('; ')],
    { stdio: 'inherit', timeout: 120_000, killSignal: 'SIGKILL' });
  if (r.status !== 0) {
    console.log(`      WARN: ${label} fehlgeschlagen (ssh exit ${r.status ?? r.error?.message ?? '?'}).`);
    return false;
  }
  return true;
}

// Schreibt den frischen Key auf die Box und startet den Match-Sammler. Der
// Sammler geht direkt zu Riot (scripts/collect-lol-matches.mjs:276,361) und ist
// damit unabhaengig vom Deploy — er darf sofort los.
function syncKeyToHetzner(env, key) {
  const host = boxHost(env);
  if (!host) {
    console.log('      (no HETZNER_HOST / HETZNER_REFRESH_URL in .env.local — skipping box sync)');
    return false;
  }
  // RGAPI keys are [A-Za-z0-9-] only, so they're safe inside the sed `#`
  // expression and the single-quoted printf fallback below.
  return runOnBox(host, [
    'set -e',
    'f=/etc/metastats-crawler/env',
    'touch "$f"',
    `if grep -q '^RIOT_API_KEY=' "$f"; then sed -i 's#^RIOT_API_KEY=.*#RIOT_API_KEY=${key}#' "$f"; else printf 'RIOT_API_KEY=%s\\n' '${key}' >> "$f"; fi`,
    // --no-block: don't wait out the multi-hour pass; oneshot semantics de-dupe
    // a concurrent run. Beide Box-Jobs teilen sich die Sperre
    // /run/lock/metastats-lol-riot.lock, laufen also nacheinander.
    'systemctl start --no-block metastats-lol-matchfill.service',
    // KEIN Restart von metastats-refresh-api.service (entfernt 2026-09-02):
    // der Dienst liest ausschliesslich RIOT_API_KEY_TFT
    // (scripts/refresh-api-server.mjs:150), und keiner seiner Importe fasst den
    // LoL-Key an (`grep -rn "RIOT_API_KEY\b" scripts/lib/ | grep -v _TFT` → 0).
    // Der Restart war also wirkungslos und hat den Dauerdienst auf :4100 bei
    // jeder taeglichen Rotation mitten in laufenden Anfragen gekappt.
    'echo "      box keyed + lol-matchfill kicked"',
  ], 'box sync');
}

// Der Marktwert-Pass ruft die LIVE-Seite (scripts/lol-marketvalue-weekly.mjs:40
// setzt BASE_URL auf metastats.gg). Vor dem Deploy gestartet, arbeitet er gegen
// den alten Key — und weil refresh-highelo-marketvalues.mjs auch bei 100 %
// Fehlern mit Exit 0 endet, schreibt der Wrapper dann seinen Throttle-Stempel
// und blockt jeden Neuversuch fuer 6 Tage. Deshalb steht dieser Start hinter dem
// verifizierten Deploy und nirgendwo sonst.
function kickBoxMarketvalue(env) {
  const host = boxHost(env);
  if (!host) return false;
  return runOnBox(host, [
    'set -e',
    'systemctl start --no-block metastats-lol-marketvalue.service',
    'echo "      lol-marketvalue kicked (nach verifiziertem Deploy)"',
  ], 'marketvalue kick');
}

async function main() {
  const env = readEnv();
  const ghToken = env.GH_TOKEN;
  if (!ghToken || !ghToken.startsWith('github_pat_')) throw new Error('GH_TOKEN missing in .env.local');

  const present = KEYS.filter(k => env[k.envName] && env[k.envName].startsWith('RGAPI-'));
  if (present.length === 0) throw new Error('No RIOT_API_KEY found in .env.local');

  const lolKeys = present.filter(k => k.envName === 'RIOT_API_KEY');
  const boxSteps = SKIP_BOX ? 0 : lolKeys.length;
  const step = (n, total, msg) => console.log(`[${n}/${total}] ${msg}`);
  const marketvalueStep = !SKIP_BOX && !SKIP_DEPLOY && lolKeys.length ? 1 : 0;
  const totalSteps = present.length * 3 + boxSteps + (SKIP_DEPLOY ? 0 : 1) + marketvalueStep;
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

  // Phase 4: Key auf die Box schreiben + Match-Sammler starten (deploy-unabhaengig).
  if (!SKIP_BOX) {
    for (const k of lolKeys) {
      step(++n, totalSteps, 'Syncing LoL key to Hetzner box + kicking match collector...');
      syncKeyToHetzner(env, env[k.envName]);
    }
  }

  // Phase 5: Deploy anstossen, abwarten, Live-Stand nachweisen.
  if (!SKIP_DEPLOY) {
    step(++n, totalSteps, 'Triggering Vercel redeploy...');
    try {
      await triggerRedeploy();
    } catch (err) {
      // Zustandsbilanz statt nur eines Exit-Codes: wer hier abbricht, muss wissen,
      // dass ueberall der neue Key steht — nur auf der Live-Seite nicht, und
      // warum genau.
      const phase = err.deployPhase || 'unknown';
      const diagnose = {
        'build-failed': `Der Build ist fehlgeschlagen${err.inspectorUrl ? ` (${err.inspectorUrl})` : ''}.`,
        'no-alias': 'Der Build steht, aber die Domain zeigt noch aufs alte Deployment.',
        'stale-key': 'Die Domain zeigt aufs neue Deployment, liefert aber weiter einen Key-Fehler.',
        foreign: 'Ein fremdes, neueres Deployment haelt die Domain — bewusst nicht dazwischengefunkt.',
        unknown: 'Endzustand unbekannt — bitte im Vercel-Dashboard nachsehen.',
      }[phase];
      const fix = {
        'build-failed': 'Ursache im Build beheben, dann: node scripts/refresh-riot-key.mjs --skip-box',
        'no-alias': `vercel promote ${err.deployUrl || '<deployment>'} --timeout 90s --yes`,
        'stale-key': `vercel promote ${err.deployUrl || '<deployment>'} --timeout 90s --yes`,
        foreign: 'nichts tun — das neuere Deployment zieht den Key aus der bereits aktualisierten Vercel-Variable.',
        unknown: `vercel inspect ${PROD_DOMAIN} --format json`,
      }[phase];
      err.deployState = [
        '  Vercel-Env:      NEU',
        '  GitHub-Secret:   NEU',
        `  Hetzner-Box:     ${SKIP_BOX ? 'uebersprungen (--skip-box)' : 'NEU (Marktwert-Pass NICHT gestartet)'}`,
        `  Live-Seite:      ${diagnose}`,
        `  Nachholen:       ${fix}`,
      ].join('\n');
      throw err;
    }

    // Phase 6: erst jetzt den Pass starten, der gegen die Live-Seite arbeitet.
    if (!SKIP_BOX && lolKeys.length) {
      step(++n, totalSteps, 'Kicking high-elo marketvalue refresh on the box...');
      kickBoxMarketvalue(env);
    }
  }

  console.log(`\nDone. Synced ${present.length} key(s): ${present.map(k => k.label).join(', ')}`);
}

const fail = err => {
  console.error('ERROR:', err.message);
  if (err.deployState) console.error(`\nStand nach dem Abbruch:\n${err.deployState}`);
  process.exit(1);
};

try {
  acquireLock();
} catch (err) {
  // Ohne Sperre gar nicht erst anfangen — und ohne Stapelspur, die Meldung ist
  // die Information.
  fail(err);
}

main()
  .then(() => releaseLock())
  .catch(err => { releaseLock(); fail(err); });

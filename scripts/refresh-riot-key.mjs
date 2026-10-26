#!/usr/bin/env node
// Syncs the LoL Riot API key across every place we use it.
// Reads .env.local for:
//   - RIOT_API_KEY        (LoL — currently a dev key, expires every 24h)
//   - GH_TOKEN            (PAT with repo:secrets write on Dota1337/metastats)
//   - HETZNER_REFRESH_URL (used to derive the crawler-box host; HETZNER_HOST overrides)
// Updates Vercel Production + Development env + GitHub Actions repo secret,
// pushes the key to the Hetzner crawler box, triggers a redeploy, verifies that
// the live domain really serves it — and only then kicks the box job that talks
// to the live site (see metastats-lol-marketvalue.service). Finally it starts
// the weekly EUW/KR champion crawls when their data is older than 6 days —
// the Friday cron alone almost always hit an expired key.
//
// RIOT_API_KEY_TFT (TFT production key) is permanent and intentionally not
// synced here — it stays as set in Vercel/GitHub.
//
// Usage:
//   node scripts/refresh-riot-key.mjs
//   node scripts/refresh-riot-key.mjs --skip-deploy # don't trigger a deploy
//   node scripts/refresh-riot-key.mjs --skip-box    # don't touch the Hetzner box

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import sodium from 'libsodium-wrappers';
import { createVercelDeploy, acquireLock, DeployError, PROD_DOMAIN } from './lib/vercel-deploy.mjs';

const REPO = 'Dota1337/metastats';
const LOL_STATUS_URL = 'https://euw1.api.riotgames.com/lol/status/v4/platform-data';

// Verifikations-Abruf: die Route schlaegt bei ungueltigem LoL-Key mit HTTP 503
// und `riot_auth` fehl (app/api/summoner/route.ts:35-39) — genau der Zustand,
// den die Rotation vom 2026-09-18 unbemerkt hinterlassen hat.
const LIVE_PROBE_PATH = '/api/summoner?name=Caps%231337&region=euw1';

// Zeitdeckel fuer Build und Abfrage-Takt; die uebrigen stehen in
// scripts/lib/vercel-deploy.mjs (DEFAULTS).
const POLL_READY_MS = Number(process.env.RIOT_KEY_POLL_READY_MS || 600_000);
const POLL_INTERVAL_MS = Number(process.env.RIOT_KEY_POLL_INTERVAL_MS || 10_000);

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

async function validateRiotKey(key, url, label) {
  const r = await fetchIPv4(url, { headers: { 'X-Riot-Token': key } });
  if (r.status !== 200) throw new Error(`Riot API rejected ${label} key: HTTP ${r.status}`);
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
// Der Weg (ohne Shell, Zeitlimits, Rueckwaerts-Nachweis ueber die Domain,
// kein Zurueckrollen neuerer Deployments) steht seit 24.10.2026 in
// scripts/lib/vercel-deploy.mjs und wird von allen Geheimnis-Skripten geteilt.
// Hier bleibt nur der Riot-eigene Live-Nachweis.
const dep = createVercelDeploy({
  timeouts: { readyMs: POLL_READY_MS, pollMs: POLL_INTERVAL_MS },
});

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
    throw new DeployError(
      `Live-Abruf ${LIVE_PROBE_PATH} antwortet HTTP ${r.status}: ${body}`,
      r.status === 503 ? 'stale-key' : 'unknown',
    );
  }
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

// Wochen-Sammlung (weekly-crawl.yml / weekly-crawl-kr.yml) anstossen, solange
// der Key frisch ist. Der Freitags-Cron traf fast immer einen abgelaufenen Key
// (Laeufe 18.09. und 25.09.: HTTP 401, Sammlung uebersprungen, EUW-Datei blieb
// ab 13.09. stehen). Laeuft ueber die gh-CLI (Scope repo), nicht ueber GH_TOKEN:
// der hat nachweislich nur Lesezugriff auf Actions bestaetigt.
// Sperren gegen Wiederholung: Datei juenger als 6 Tage, ein Lauf wartet oder
// laeuft, oder ein Anstoss liegt weniger als 20 h zurueck (sonst stiesse nach
// einem gescheiterten Lauf jede Rotation einen neuen an). Das Warten auf den
// Marktwert-Pass der Box erledigt der Workflow selbst (scripts/weekly-crawl-gate.mjs).
const WEEKLY_CRAWLS = [
  { region: 'euw', workflow: 'weekly-crawl.yml' },
  { region: 'kr', workflow: 'weekly-crawl-kr.yml' },
];
const CRAWL_STALE_MS = 6 * 86_400_000;
const CRAWL_REKICK_MS = 20 * 3_600_000;

function gh(args) {
  // Ohne Shell, damit das Zeitlimit den richtigen Prozess trifft.
  return spawnSync('gh', args, { encoding: 'utf8', timeout: 60_000, killSignal: 'SIGKILL' });
}

function kickStaleWeeklyCrawls({ dryRun = false } = {}) {
  for (const { region, workflow } of WEEKLY_CRAWLS) {
    const label = `Wochen-Sammlung ${region.toUpperCase()}`;
    const file = gh(['api', `repos/${REPO}/contents/public/champion-stats-${region}.json?ref=main`, '--jq', '.content']);
    if (file.status !== 0) { console.log(`      WARN: ${label}: Datei nicht lesbar (gh exit ${file.status ?? file.error?.code}).`); continue; }
    let collectedAt;
    try { collectedAt = JSON.parse(Buffer.from(file.stdout.replace(/\s+/g, ''), 'base64').toString('utf8')).collectedAt; } catch { /* unten */ }
    const age = Date.now() - new Date(collectedAt).getTime();
    if (!Number.isFinite(age)) { console.log(`      WARN: ${label}: collectedAt fehlt — nicht angestossen.`); continue; }
    const days = (age / 86_400_000).toFixed(1);
    if (age < CRAWL_STALE_MS) { console.log(`      ${label}: Daten ${days} Tage alt — kein Lauf noetig.`); continue; }

    const runs = gh(['run', 'list', '--repo', REPO, '--workflow', workflow, '--limit', '10', '--json', 'status,event,createdAt']);
    let list = null;
    try { list = JSON.parse(runs.stdout); } catch { /* unten */ }
    if (runs.status !== 0 || !Array.isArray(list)) { console.log(`      WARN: ${label}: Laufliste nicht lesbar — nicht angestossen.`); continue; }
    if (list.some(r => ['queued', 'in_progress', 'waiting', 'pending', 'requested'].includes(r.status))) {
      console.log(`      ${label}: laeuft bereits.`); continue;
    }
    if (list.some(r => r.event === 'workflow_dispatch' && Date.now() - new Date(r.createdAt).getTime() < CRAWL_REKICK_MS)) {
      console.log(`      ${label}: Daten ${days} Tage alt, aber vor weniger als 20 h schon angestossen — kein neuer Lauf.`); continue;
    }
    if (dryRun) { console.log(`      ${label}: Daten ${days} Tage alt — wuerde anstossen (Probelauf).`); continue; }
    const kick = gh(['workflow', 'run', workflow, '--repo', REPO, '--ref', 'main']);
    if (kick.status === 0) console.log(`      ${label}: Daten ${days} Tage alt — Lauf angestossen.`);
    else console.log(`      WARN: ${label}: Anstoss fehlgeschlagen (gh exit ${kick.status ?? kick.error?.code}): ${(kick.stderr || '').trim().slice(0, 200)}`);
  }
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
    // Echten Zustand melden statt "kicked": ein Start-Job kann hinter dem
    // Marktwert-Lauf warten (After=), und ein haengender Lauf ist "active" seit
    // Tagen — genau das blieb vom 20.09. bis 30.09.2026 unbemerkt. Bewusst
    // `show`/`list-jobs` statt `is-active`: das endet bei "inactive" mit
    // Exit 3 und wuerde unter set -e den ganzen Schritt abbrechen.
    'for u in metastats-lol-matchfill metastats-lol-marketvalue; do st=$(systemctl show -p ActiveState --value $u.service); if [ "$st" = inactive ]; then p=InactiveEnterTimestamp; else p=InactiveExitTimestamp; fi; since=$(systemctl show -p $p --value $u.service); job=$(systemctl list-jobs --no-legend $u.service | awk \'{print $4}\'); echo "      $u: $st seit ${since:-?}${job:+ (Start-Job: $job)}"; done',
    // KEIN Restart von metastats-refresh-api.service (entfernt 2026-09-02):
    // der Dienst liest ausschliesslich RIOT_API_KEY_TFT
    // (scripts/refresh-api-server.mjs:150), und keiner seiner Importe fasst den
    // LoL-Key an (`grep -rn "RIOT_API_KEY\b" scripts/lib/ | grep -v _TFT` → 0).
    // Der Restart war also wirkungslos und hat den Dauerdienst auf :4100 bei
    // jeder taeglichen Rotation mitten in laufenden Anfragen gekappt.
    'echo "      box keyed + lol-matchfill angestossen"',
  ], 'box sync');
}

// Der Marktwert-Pass ruft die LIVE-Seite (scripts/lol-marketvalue-weekly.mjs:40
// setzt BASE_URL auf metastats.gg). Vor dem Deploy gestartet, arbeitet er gegen
// den alten Key. Seit 02.09.2026 endet refresh-highelo-marketvalues.mjs bei mehr
// als 30 % Fehlern mit Exit 1 (dort Z. 214-224), der Stempel bliebe also frei —
// der Lauf waere aber umsonst und hielte die Riot-Sperre stundenlang. Deshalb
// steht dieser Start hinter dem verifizierten Deploy und nirgendwo sonst.
function kickBoxMarketvalue(env) {
  const host = boxHost(env);
  if (!host) return false;
  return runOnBox(host, [
    'set -e',
    'systemctl start --no-block metastats-lol-marketvalue.service',
    'echo "      lol-marketvalue kicked (nach verifiziertem Deploy)"',
    // Seiten-Datei der LoL-Rangliste: mit dem alten Key schrieb die Box keine
    // (Route 503), die Seite zeigt sonst bis zum naechsten Takt die alte Liste.
    'systemctl start --no-block metastats-mirror-lol-leaderboard.service',
    'echo "      mirror-lol-leaderboard kicked"',
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
  const crawlStep = lolKeys.length ? 1 : 0;
  const totalSteps = present.length * 3 + boxSteps + (SKIP_DEPLOY ? 0 : 1) + marketvalueStep + crawlStep;
  let n = 0;

  // Phase 1: validate each key against its respective game endpoint
  for (const k of present) {
    step(++n, totalSteps, `Validating ${k.label} key against Riot API...`);
    await validateRiotKey(env[k.envName], k.validateUrl, k.label);
    console.log(`      OK (HTTP 200)`);
  }

  // Phase 2: update Vercel prod + dev for each key. Ab hier zaehlt jedes
  // Deployment, das spaeter entsteht, als "traegt den neuen Key".
  const envChangedAt = Date.now();
  for (const k of present) {
    step(++n, totalSteps, `Updating Vercel prod+dev env for ${k.secretName}...`);
    dep.setEnv(k.secretName, env[k.envName]);
    console.log('      OK');
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
      await dep.redeployProduction({ since: envChangedAt, probe: probeLiveKey, gitMessage: 'chore: refresh Riot API keys' });
      console.log(`      Live bestaetigt: ${PROD_DOMAIN} beantwortet ${LIVE_PROBE_PATH} mit HTTP 200.`);
    } catch (err) {
      // Zustandsbilanz statt nur eines Exit-Codes: wer hier abbricht, muss wissen,
      // dass ueberall der neue Key steht — nur auf der Live-Seite nicht, und
      // warum genau.
      const phase = err.deployPhase || 'unknown';
      const diagnose = {
        'build-failed': `Der Build ist fehlgeschlagen${err.inspectorUrl ? ` (${err.inspectorUrl})` : ''}.`,
        'no-alias': 'Der Build steht, aber die Domain zeigt noch aufs alte Deployment.',
        'stale-key': 'Die Domain zeigt aufs neue Deployment, liefert aber weiter einen Key-Fehler.',
        foreign: 'Ein neueres Deployment (traegt den neuen Key) wurde nicht ausgeliefert.',
        unknown: 'Endzustand unbekannt — bitte im Vercel-Dashboard nachsehen.',
      }[phase];
      // Nie blind umhaengen: ist inzwischen ein neueres Deployment da, wuerde
      // `promote` es zurueckrollen.
      const fix = {
        'build-failed': 'Ursache im Build beheben, dann: node scripts/refresh-riot-key.mjs --skip-box',
        'no-alias': `nur wenn \`vercel ls --prod\` kein neueres zeigt: vercel promote ${err.deployUrl || '<deployment>'} --timeout 90s --yes`,
        'stale-key': 'Key in .env.local gegen Riot pruefen, dann: node scripts/refresh-riot-key.mjs --skip-box',
        foreign: `vercel inspect ${PROD_DOMAIN} --format json — und im Dashboard nachsehen, warum das neuere Deployment haengt.`,
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

  // Phase 7: Wochen-Sammlung nachholen, falls faellig. Nicht fatal.
  if (crawlStep) {
    step(++n, totalSteps, 'Checking weekly champion crawls (EUW/KR)...');
    kickStaleWeeklyCrawls();
  }

  console.log(`\nDone. Synced ${present.length} key(s): ${present.map(k => k.label).join(', ')}`);
}

const fail = err => {
  console.error('ERROR:', err.message);
  if (err.deployState) console.error(`\nStand nach dem Abbruch:\n${err.deployState}`);
  process.exit(1);
};

let releaseLock = () => {};
try {
  releaseLock = acquireLock('refresh-riot-key');
} catch (err) {
  // Ohne Sperre gar nicht erst anfangen — und ohne Stapelspur, die Meldung ist
  // die Information.
  fail(err);
}

main()
  .then(() => releaseLock())
  .catch(err => { releaseLock(); fail(err); });

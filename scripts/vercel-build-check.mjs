#!/usr/bin/env node
// Vercel-Build-Health-Check: alle 10 min (systemd-Timer). Liest den letzten
// GitHub-Commit + dessen Vercel-Deployment-Status via GitHub-Checks-API. Wenn
// der Status "failure"/"error" ist UND der Commit jünger als 30 min, wird per
// empty-commit + push ein Redeploy getriggert.
//
// Anti-Loop:
//   - max 1 re-trigger pro 30 min (gate über state.json)
//   - max 3 re-triggers pro 24 h (sonst nur Notification)
//   - Nur re-trigger wenn der jüngste Commit der gefailte ist (=> kein
//     Eingriff bei Builds die der User gerade explizit angestoßen hat)
//
// Config (.env.local oder Hetzner-env):
//   GH_TOKEN                       (Pflicht — Fine-grained PAT mit repo write)
//   HEALTH_NOTIFY_WEBHOOK          (optional — Discord/Slack)
//   VERCEL_CHECK_REPO              (default: Dota1337/metastats)
//   VERCEL_CHECK_BRANCH            (default: main)
//
// Usage:
//   node scripts/vercel-build-check.mjs              # check + ggf. retrigger
//   node scripts/vercel-build-check.mjs --check      # nur status, kein push

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_FILE = process.env.BUILD_CHECK_STATE_PATH
  || (existsSync('/var/lib/metastats-health') ? '/var/lib/metastats-health/build-check.json' : 'build-check-state.json');

const REPO_DEFAULT = 'Dota1337/metastats';
const BRANCH_DEFAULT = 'main';
const COOL_DOWN_MS = 30 * 60 * 1000;
const MAX_RETRIGGERS_PER_DAY = 3;
const COMMIT_MAX_AGE_MS = 30 * 60 * 1000;

function loadDotEnv(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/i.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

function loadState() {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastRetriggerAt: 0, retriggersLast24h: [], lastSeenSha: '', lastSeenState: 'unknown' }; }
}

function saveState(s) {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
  } catch (e) {
    console.error(`[state] write failed: ${e.message}`);
  }
}

async function ghApi(method, path, token, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'metastats-build-check',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`GH ${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

async function notify(webhook, payload) {
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: payload, text: payload }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

// Liest den jüngsten Commit + sucht in der Check-Suite-Liste nach dem
// Vercel-Eintrag. GitHub's deployments-API würde auch gehen, aber check-suites
// liefert konsistent den Vercel-Build-Status für jeden Commit.
async function fetchLatestBuildStatus(token, repo, branch) {
  const commit = await ghApi('GET', `/repos/${repo}/commits/${branch}`, token);
  const sha = commit.sha;
  const commitDate = new Date(commit.commit.committer.date).getTime();
  const suites = await ghApi('GET', `/repos/${repo}/commits/${sha}/check-suites`, token);
  // Vercel posiert als app-slug "vercel". Wir suchen die suite und prüfen
  // conclusion/status. Wenn mehrere Suites existieren, gewinnt die nicht-
  // erfolgreichste (failure > timed_out > cancelled > success).
  const vercelSuites = (suites.check_suites || []).filter(s => s.app?.slug === 'vercel');
  let conclusion = 'none';
  let status = 'unknown';
  for (const s of vercelSuites) {
    status = s.status;
    if (s.conclusion === 'failure' || s.conclusion === 'cancelled' || s.conclusion === 'timed_out') {
      conclusion = s.conclusion;
      break;
    }
    if (s.conclusion === 'success' && conclusion === 'none') conclusion = 'success';
  }
  return { sha, commitDate, conclusion, status, suitesFound: vercelSuites.length };
}

async function triggerRetrigger(token, repo, branch) {
  // Empty-commit via GH-API ist umständlich (braucht parent SHA + tree).
  // Pragmatischer: workflow-dispatch oder repository-dispatch. Aber unsere
  // production hängt am push-to-main; ein leerer Commit ist der direkte Weg.
  //
  // Schritte:
  //   1. Hol HEAD-Commit
  //   2. Erstelle neuen Commit mit gleichem Tree + Parent = HEAD-SHA + Auto-Message
  //   3. Update branch ref auf neuen Commit
  const head = await ghApi('GET', `/repos/${repo}/branches/${branch}`, token);
  const headSha = head.commit.sha;
  const tree = head.commit.commit.tree.sha;
  const newCommit = await ghApi('POST', `/repos/${repo}/git/commits`, token, {
    message: 'chore: auto-retrigger Vercel deploy (build failure detected)\n\n[skip ci]',
    tree,
    parents: [headSha],
  });
  await ghApi('PATCH', `/repos/${repo}/git/refs/heads/${branch}`, token, {
    sha: newCommit.sha,
    force: false,
  });
  return newCommit.sha;
}

async function main() {
  const env = { ...process.env, ...loadDotEnv('.env.local'), ...loadDotEnv('/etc/metastats-crawler/env') };
  const token = env.GH_TOKEN;
  if (!token) { console.error('FAIL: GH_TOKEN missing'); process.exit(1); }
  const repo = env.VERCEL_CHECK_REPO || REPO_DEFAULT;
  const branch = env.VERCEL_CHECK_BRANCH || BRANCH_DEFAULT;
  const webhook = env.HEALTH_NOTIFY_WEBHOOK;
  const checkOnly = process.argv.includes('--check');

  const state = loadState();
  const now = Date.now();

  let status;
  try { status = await fetchLatestBuildStatus(token, repo, branch); }
  catch (e) {
    console.error(`[ERR] ${e.message}`);
    process.exit(2);
  }

  const ageMin = Math.floor((now - status.commitDate) / 60_000);
  console.log(`[check] HEAD=${status.sha.slice(0, 7)} (${ageMin}m ago) · vercel-suites=${status.suitesFound} · status=${status.status} · conclusion=${status.conclusion}`);

  if (checkOnly) return;

  const isFailure = status.conclusion === 'failure' || status.conclusion === 'timed_out';
  const wasJustNotified = state.lastSeenSha === status.sha && state.lastSeenState === status.conclusion;

  if (!isFailure) {
    if (state.lastSeenState === 'failure' || state.lastSeenState === 'timed_out') {
      await notify(webhook, `:white_check_mark: Vercel-Build wieder grün (${status.sha.slice(0, 7)} · ${status.conclusion})`);
    }
    state.lastSeenSha = status.sha;
    state.lastSeenState = status.conclusion;
    saveState(state);
    return;
  }

  // Commit muss frisch sein
  if (now - status.commitDate > COMMIT_MAX_AGE_MS) {
    console.log(`[skip] commit ${ageMin}m alt — kein retrigger für ältere Commits`);
    if (!wasJustNotified) {
      await notify(webhook, `:warning: Vercel-Build failure auf ${status.sha.slice(0, 7)} (${ageMin}m alt). Kein Auto-Retrigger, manuell prüfen.`);
    }
    state.lastSeenSha = status.sha;
    state.lastSeenState = status.conclusion;
    saveState(state);
    return;
  }

  // Rate-Limits prüfen
  state.retriggersLast24h = (state.retriggersLast24h || []).filter(t => now - t < 86_400_000);
  const inCoolDown = now - (state.lastRetriggerAt || 0) < COOL_DOWN_MS;
  const rateLimited = state.retriggersLast24h.length >= MAX_RETRIGGERS_PER_DAY;

  if (inCoolDown) {
    console.log('[skip] in cool-down');
    return;
  }
  if (rateLimited) {
    await notify(webhook,
      `:no_entry: Vercel-Build failure auf ${status.sha.slice(0, 7)} + Retrigger-Limit (${MAX_RETRIGGERS_PER_DAY}/24h) erreicht. Manuelles Eingreifen nötig.`);
    state.lastSeenSha = status.sha;
    state.lastSeenState = status.conclusion;
    saveState(state);
    return;
  }

  console.log(`[action] triggering empty-commit retrigger for ${status.sha.slice(0, 7)}`);
  try {
    const newSha = await triggerRetrigger(token, repo, branch);
    state.lastRetriggerAt = now;
    state.retriggersLast24h.push(now);
    await notify(webhook,
      `:rotating_light: Vercel-Build failure auf ${status.sha.slice(0, 7)} (${status.conclusion}) — Empty-Commit-Retrigger ausgelöst: ${newSha.slice(0, 7)}. #${state.retriggersLast24h.length}/24h`);
  } catch (e) {
    await notify(webhook,
      `:rotating_light: Vercel-Build failure auf ${status.sha.slice(0, 7)} — Retrigger fehlgeschlagen: ${e.message}`);
  }
  state.lastSeenSha = status.sha;
  state.lastSeenState = status.conclusion;
  saveState(state);
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });

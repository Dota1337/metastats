#!/usr/bin/env node
// Detects new League of Legends seasons by tracking the major patch version.
// Riot convention: each year a new major patch X.1 marks the season start
// (14.1 = 2024, 15.1 = 2025, 16.1 = 2026). This script compares the latest
// patch from Data Dragon against the season currently recorded in
// public/seasons.json. On a major bump it updates the file and writes a
// machine-readable flag so the workflow can open a GitHub issue for manual
// confirmation.
//
// Output:
//   - Updates public/seasons.json on bump.
//   - Writes flag to $GITHUB_OUTPUT (or stdout) when a new season is detected.
//   - Exit 0 always — detection is informational, not a failure.

import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const SEASONS_PATH = 'public/seasons.json';

// Same IPv4 workaround as refresh-riot-key — Node fetch hangs on Cloudflare IPv6 here.
function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => (err ? reject(err) : resolve(addr)));
  });
}

async function fetchJSON(url) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: ip,
        servername: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: { Host: u.hostname },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('Request timeout')));
    req.end();
  });
}

// '16.9.1' -> 16
function majorOf(patch) {
  const m = String(patch).match(/^(\d+)\./);
  return m ? Number(m[1]) : null;
}

// Riot Patch convention: Patch X.1 of major X marks season start.
// Returns the first version observed for each major across the full version list.
function buildSeasonHistory(versionsNewestFirst) {
  const reversed = [...versionsNewestFirst].reverse(); // oldest first
  const seen = new Map(); // major -> earliest patch string
  for (const v of reversed) {
    const major = majorOf(v);
    if (major == null) continue;
    if (!seen.has(major)) seen.set(major, v);
  }
  return [...seen.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([major, startPatch]) => ({
      id: `s${major + 2010}`,
      label: `Season ${major + 2010}`,
      major,
      startPatch,
    }));
}

function loadCurrent() {
  if (!existsSync(SEASONS_PATH)) return null;
  return JSON.parse(readFileSync(SEASONS_PATH, 'utf8'));
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
  else console.log(`::set-output ${key}=${value}`);
}

async function main() {
  console.log('[1/3] Fetching version list from Data Dragon...');
  const versions = await fetchJSON(VERSIONS_URL);
  const latest = versions[0];
  const latestMajor = majorOf(latest);
  console.log(`      latest=${latest} (major ${latestMajor})`);

  console.log('[2/3] Comparing against public/seasons.json...');
  const stored = loadCurrent();
  const history = buildSeasonHistory(versions);
  const newestSeason = history[history.length - 1];

  if (!stored) {
    // First run: bootstrap from version list, no bump signal.
    const payload = {
      currentSeason: newestSeason,
      history: history.slice(0, -1).reverse(), // exclude current, newest-first
      lastCheckedAt: new Date().toISOString(),
      latestPatch: latest,
    };
    writeFileSync(SEASONS_PATH, JSON.stringify(payload, null, 2) + '\n');
    console.log(`      bootstrapped — current season ${newestSeason.id} (start ${newestSeason.startPatch})`);
    setOutput('season-changed', 'false');
    return;
  }

  const storedMajor = stored.currentSeason?.major;
  if (latestMajor > storedMajor) {
    // Major bump detected → new season.
    const promoted = {
      ...stored.currentSeason,
      endPatch: versions.find(v => majorOf(v) === storedMajor) || null,
      detectedEndAt: new Date().toISOString(),
    };
    const payload = {
      currentSeason: { ...newestSeason, detectedAt: new Date().toISOString() },
      history: [promoted, ...(stored.history || [])],
      lastCheckedAt: new Date().toISOString(),
      latestPatch: latest,
    };
    writeFileSync(SEASONS_PATH, JSON.stringify(payload, null, 2) + '\n');
    console.log(`      DETECTED: season bump ${stored.currentSeason.id} -> ${newestSeason.id}`);
    setOutput('season-changed', 'true');
    setOutput('previous-season', stored.currentSeason.id);
    setOutput('new-season', newestSeason.id);
    setOutput('start-patch', newestSeason.startPatch);
  } else {
    // No bump — still refresh lastCheckedAt + latestPatch for visibility.
    stored.lastCheckedAt = new Date().toISOString();
    stored.latestPatch = latest;
    writeFileSync(SEASONS_PATH, JSON.stringify(stored, null, 2) + '\n');
    console.log(`      no bump — still on ${stored.currentSeason.id}`);
    setOutput('season-changed', 'false');
  }

  console.log('[3/3] Done.');
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });

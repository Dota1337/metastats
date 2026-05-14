#!/usr/bin/env node
// Detects the current live TFT set and writes public/tft-set.json so the
// frontend + downstream crawlers know which set's data to display.
//
// Source: CommunityDragon's tft/en_us.json (the de-facto authoritative TFT
// metadata mirror — Riot Data Dragon does not expose a set list directly).
// Strategy: find the highest "number" in setData[] whose mutator matches
// /^TFTSet\d+$/ (no TURBO / no subset variants). That is the live ranked set.

import { writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://raw.communitydragon.org/latest/cdragon/tft/en_us.json';
const OUT = 'public/tft-set.json';

// Riot's CommunityDragon mirror only exposes the internal mutator name
// ("Set17") — the marketing-facing name ("Space Gods") is not in the JSON.
// Hardcoded mapping for the user-visible label, fallback "Set N".
const SET_NAMES = {
  10: 'Remix Rumble',
  11: 'Inkborn Fables',
  12: 'Magic n\' Mayhem',
  13: 'Into the Arcane',
  14: 'Cyber City',
  15: 'Spatulor',
  16: 'K.O. Coliseum',
  17: 'Space Gods',
};

// TFT-Patch numbering is NOT exposed by any Riot API — Match-V1's
// game_version returns the LoL build (e.g. "16.9.772.8292") and Data Dragon
// only lists LoL versions. The user-visible TFT patch ("17.2") is a marketing
// label that follows the convention `${setNumber}.${nthPatchSinceSetLaunch}`,
// where each new LoL patch ≈ a new TFT patch.
//
// Mapping = the LoL patch where each set launched. From that we derive the
// current TFT patch by subtracting from the current LoL minor version.
// Update this when a new set ships — and bump the launch entry, not delete
// the old ones (history pages may reference old set patches).
// Maps each TFT set to the "anchor" LoL patch — i.e. the LoL patch number
// where minor-diff = 0 (so LoL anchor.N maps to TFT set.N for N >= 1).
// For Set 17: launch TFT 17.1 went live alongside LoL 16.8 on 2026-04-15.
// Current TFT 17.3 corresponds to LoL 16.10, so the anchor is LoL 16.7
// (LoL 16.8 = TFT 17.1, LoL 16.10 = TFT 17.3).
const SET_LAUNCH_LOL = {
  17: '16.7',   // Set 17 "Space Gods" anchors at LoL 16.7 → TFT 17.1 = LoL 16.8
};

function tftPatchFromLol(lolVersion, setNumber) {
  const launch = SET_LAUNCH_LOL[setNumber];
  if (!launch || !lolVersion) return lolVersion;
  const [curMajor, curMinor] = lolVersion.split('.').slice(0, 2).map(Number);
  const [launchMajor, launchMinor] = launch.split('.').map(Number);
  if ([curMajor, curMinor, launchMajor, launchMinor].some(n => Number.isNaN(n))) return lolVersion;
  // Riot does roughly 25 LoL patches per year. Cross-year math:
  const yearDiff = curMajor - launchMajor;
  const minorDiff = curMinor - launchMinor;
  const tftMinor = yearDiff * 25 + minorDiff;
  if (tftMinor < 0) return lolVersion;
  return `${setNumber}.${tftMinor}`;
}

function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => err ? reject(err) : resolve(addr));
  });
}

async function fetchJSON(url) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: ip,
      servername: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Host: u.hostname, 'User-Agent': 'metastats-crawler/1.0' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function fetchLatestPatch() {
  // Riot Data Dragon's versions.json is the authoritative patch list; first entry is latest.
  const url = 'https://ddragon.leagueoflegends.com/api/versions.json';
  const v = await fetchJSON(url);
  return Array.isArray(v) ? v[0] : null;
}

function setOutput(key, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${key}=${value}\n`);
}

async function main() {
  console.log('[1/3] Fetch latest LoL patch from Data Dragon');
  const lolPatch = await fetchLatestPatch();
  console.log('      LoL patch:', lolPatch);

  console.log('[2/3] Fetch TFT metadata from CommunityDragon');
  const cd = await fetchJSON(SOURCE_URL);
  const setData = cd?.setData || [];
  console.log('      setData entries:', setData.length);

  // Pick the live set: highest "number" with a mutator that is exactly
  // "TFTSet<N>" — this filters out TURBO subsets and beta variants.
  const liveSets = setData.filter(s => /^TFTSet\d+$/.test(s.mutator || ''));
  if (liveSets.length === 0) {
    console.error('ERROR: no live set found in CommunityDragon data');
    process.exit(1);
  }
  const live = liveSets.sort((a, b) => (b.number || 0) - (a.number || 0))[0];
  const displayName = SET_NAMES[live.number] || `Set ${live.number}`;
  console.log(`      live set: ${live.number} "${displayName}" (mutator ${live.mutator})`);

  // Compute the TFT-style patch label from the LoL version + set-launch table.
  // patchOverride in the existing tft-set.json wins — set it manually when
  // Riot ships a hotfix like "17.2b" that doesn't line up with a LoL patch.
  console.log('[3/3] Compare against existing tft-set.json + write');
  const stored = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : null;
  const changed = !stored || stored.setNumber !== live.number;

  const derivedTftPatch = tftPatchFromLol(lolPatch, live.number);
  const tftPatch = stored?.patchOverride || derivedTftPatch;
  console.log(`      LoL ${lolPatch} → TFT ${tftPatch}${stored?.patchOverride ? ' (override)' : ''}`);

  // Pull set-start / set-end from the Riot patch-schedule roadmap if it's been
  // crawled. Keeps tft-set.json self-contained for /api/tft/sets/current.
  let setStartDate = stored?.setStartDate ?? null;
  let setEndDate = stored?.setEndDate ?? null;
  const ROADMAP = 'public/tft-roadmap.json';
  if (existsSync(ROADMAP)) {
    try {
      const roadmap = JSON.parse(readFileSync(ROADMAP, 'utf8'));
      const info = roadmap.sets?.[String(live.number)];
      if (info) {
        setStartDate = info.startDate || setStartDate;
        setEndDate = info.endDate || setEndDate;
      }
    } catch {}
  }

  const payload = {
    setNumber: live.number,
    setName: displayName,
    mutator: live.mutator,
    latestPatch: tftPatch,
    lolPatch,                          // kept around for diagnostics
    patchOverride: stored?.patchOverride || null,
    detectedAt: stored?.detectedAt && !changed ? stored.detectedAt : new Date().toISOString(),
    lastCheckedAt: new Date().toISOString(),
    history: stored?.history || [],
    setStartDate,
    setEndDate,
  };
  if (changed && stored?.setNumber) {
    payload.history = [
      { setNumber: stored.setNumber, setName: stored.setName, mutator: stored.mutator, endedAt: new Date().toISOString() },
      ...(stored.history || []),
    ];
    console.log(`      DETECTED: set ${stored.setNumber} -> ${live.number}`);
    setOutput('set-changed', 'true');
    setOutput('previous-set', String(stored.setNumber));
    setOutput('new-set', String(live.number));
  } else {
    console.log('      no bump');
    setOutput('set-changed', 'false');
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`      -> ${OUT}`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

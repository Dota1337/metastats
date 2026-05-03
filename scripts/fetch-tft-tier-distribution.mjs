#!/usr/bin/env node
// Mirrors scripts/fetch-tier-distribution.mjs but for the TFT-specific
// distribution page on esportstales.com. The TFT page lives at a different
// URL and is updated on its own monthly cadence.

import { readFileSync, writeFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://www.esportstales.com/teamfight-tactics/seasonal-rank-system-and-player-distribution';
const OUT = 'public/tft-tier-distribution.json';

const TIERS = [
  { key: 'IRON',        label: 'Iron',    color: '#6b6b6b' },
  { key: 'BRONZE',      label: 'Bronze',  color: '#a0652a' },
  { key: 'SILVER',      label: 'Silver',  color: '#8fa0a8' },
  { key: 'GOLD',        label: 'Gold',    color: '#c89b3c' },
  { key: 'PLATINUM',    label: 'Plat',    color: '#209e85' },
  { key: 'EMERALD',     label: 'Emerald', color: '#00a86b' },
  { key: 'DIAMOND',     label: 'Dia',     color: '#576cce' },
  { key: 'MASTER',      label: 'Master',  color: '#9d48e0' },
  { key: 'GRANDMASTER', label: 'GM',      color: '#e44040' },
  { key: 'CHALLENGER',  label: 'Chall',   color: '#f0c040' },
];

const TIER_FULLNAME = {
  IRON: 'Iron', BRONZE: 'Bronze', SILVER: 'Silver', GOLD: 'Gold',
  PLATINUM: 'Platinum', EMERALD: 'Emerald', DIAMOND: 'Diamond',
  MASTER: 'Master', GRANDMASTER: 'Grandmaster', CHALLENGER: 'Challenger',
};

function lookupIPv4(host) {
  return new Promise((resolve, reject) => {
    dnsLookup(host, { family: 4 }, (err, addr) => err ? reject(err) : resolve(addr));
  });
}
async function fetchHTML(url) {
  const u = new URL(url);
  const ip = await lookupIPv4(u.hostname);
  return new Promise((resolve, reject) => {
    const req = httpsRequest({
      host: ip, servername: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: { Host: u.hostname, 'User-Agent': 'Mozilla/5.0 (compatible; metastats-crawler/1.0)', Accept: 'text/html' },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function parseDistribution(html) {
  const norm = html.replace(/\s+/g, ' ');
  const out = {};
  for (const t of TIERS) {
    const fullName = TIER_FULLNAME[t.key];
    const re = new RegExp(`\\b${fullName}\\b[^A-Za-z%]*?(\\d+(?:[.,]\\d+)?)\\s*%`, 'i');
    const m = norm.match(re);
    if (m) out[t.key] = Number(m[1].replace(',', '.'));
  }
  return out;
}

function parseMonth(html) {
  const m = html.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/);
  return m ? m[0] : null;
}

async function main() {
  console.log(`[1/3] Fetch ${SOURCE_URL}`);
  const html = await fetchHTML(SOURCE_URL);
  console.log(`      ${html.length} bytes`);

  console.log('[2/3] Parse');
  const found = parseDistribution(html);
  const missing = TIERS.filter(t => found[t.key] == null).map(t => t.key);
  if (missing.length > 0) {
    console.error(`ERROR: missing tiers ${missing.join(',')} — keeping ${OUT}`);
    process.exit(1);
  }
  const month = parseMonth(html);

  console.log('[3/3] Write');
  const payload = {
    queue: 'RANKED_TFT',
    month: month || 'unknown',
    fetchedAt: new Date().toISOString(),
    source: 'esportstales.com',
    tiers: TIERS.map(t => ({ ...t, pct: found[t.key] })),
  };
  const sum = payload.tiers.reduce((a, t) => a + t.pct, 0);
  if (sum < 95 || sum > 105) {
    console.error(`ERROR: implausible sum ${sum.toFixed(1)}%`);
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`      -> ${OUT} (sum ${sum.toFixed(1)}%)`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

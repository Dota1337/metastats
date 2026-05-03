#!/usr/bin/env node
// Pulls the current solo-queue rank distribution from esportstales.com
// (which itself sources from leagueofgraphs) and writes it to
// public/tier-distribution.json. Runs as a step in the weekly crawl.
//
// Strategy:
//   1. Fetch the article HTML (IPv4-pinned to dodge our local Cloudflare bug).
//   2. Find each tier name + percent with a tolerant regex.
//   3. If we got all 10 tiers, rewrite the JSON; otherwise keep the previous
//      file untouched and exit non-zero so the workflow surfaces a warning.
//
// We intentionally do NOT raise the percentages from our own crawler — those
// only cover Master+ and would skew everything below.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns';

const SOURCE_URL = 'https://www.esportstales.com/league-of-legends/rank-distribution-percentage-of-players-by-tier';
const OUT = 'public/tier-distribution.json';

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
      host: ip,
      servername: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        Host: u.hostname,
        'User-Agent': 'Mozilla/5.0 (compatible; metastats-crawler/1.0)',
        Accept: 'text/html',
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

// Look for "<TierName> ... <pct>%" pairs. Tier names appear inside <strong> or
// list items right next to the percentage. We use a tolerant pattern: the tier
// name followed by anything (incl. HTML tags / whitespace, but no other tier
// keyword) up to the percentage value.
function parseDistribution(html) {
  const norm = html.replace(/\s+/g, ' ');
  const out = {};
  for (const t of TIERS) {
    const re = new RegExp(`\\b${t.label === 'Plat' ? 'Platinum' : t.label === 'Dia' ? 'Diamond' : t.label === 'GM' ? 'Grandmaster' : t.label === 'Chall' ? 'Challenger' : t.key.toLowerCase().replace(/^./, c => c.toUpperCase())}\\b[^A-Za-z%]*?(\\d+(?:[.,]\\d+)?)\\s*%`, 'i');
    const m = norm.match(re);
    if (m) {
      out[t.key] = Number(m[1].replace(',', '.'));
    }
  }
  return out;
}

// Try to pluck "Month YEAR" from the page header so we can show it in the UI.
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
    console.error(`ERROR: missing tiers ${missing.join(',')} — keeping existing ${OUT}`);
    process.exit(1);
  }
  const month = parseMonth(html);
  console.log(`      month=${month || 'unknown'}, all 10 tiers parsed`);

  console.log('[3/3] Write');
  const payload = {
    queue: 'RANKED_SOLO_5x5',
    month: month || 'unknown',
    fetchedAt: new Date().toISOString(),
    source: 'esportstales.com (data: leagueofgraphs.com)',
    tiers: TIERS.map(t => ({ ...t, pct: found[t.key] })),
  };
  // Sanity check: percentages should sum near 100. If they don't, surface it.
  const sum = payload.tiers.reduce((a, t) => a + t.pct, 0);
  if (sum < 95 || sum > 105) {
    console.error(`ERROR: implausible sum ${sum.toFixed(1)}% — keeping existing ${OUT}`);
    process.exit(1);
  }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`      -> ${OUT} (sum ${sum.toFixed(1)}%)`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

#!/usr/bin/env node
/**
 * Builds public/tft-augment-tiers-{set}.json from tactics.tools — the only
 * publicly accessible ground-truth for TFT augment tier (Silver/Gold/Prismatic)
 * we found. Riot/DataDragon/CDragon don't ship a tier field; the icon-path
 * suffix (`_I/_II/_III`) is unreliable because Riot recycles base icons
 * across `Plus/PlusPlus` variants (e.g. Heroic Grab Bag++ ships with the
 * Gold base icon).
 *
 * Run on every patch — produces a name→tier map that overlays the icon-suffix
 * fallback in scripts/fetch-tft-assets.mjs.
 */
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { readFileSync, writeFileSync } from 'node:fs';

function lookupIPv4(host) {
  return new Promise((res, rej) => lookup(host, { family: 4 }, (e, a) => e ? rej(e) : res(a)));
}
function get(url) {
  const u = new URL(url);
  return lookupIPv4(u.hostname).then(ip => new Promise((res, rej) => {
    const req = request({
      host: ip, servername: u.hostname, port: 443,
      path: u.pathname + u.search, method: 'GET',
      headers: {
        Host: u.hostname,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
      },
    }, r => {
      const c = [];
      r.on('data', x => c.push(x));
      r.on('end', () => {
        if (r.statusCode !== 200) return rej(new Error('HTTP ' + r.statusCode + ' for ' + url));
        res(Buffer.concat(c).toString('utf8'));
      });
    });
    req.on('error', rej);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  }));
}

function decodeHtml(s) {
  return s
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function sliceByHeaders(html, headers) {
  const out = {};
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].index + headers[i][0].length;
    const end = i + 1 < headers.length ? headers[i + 1].index : html.length;
    out[headers[i][1].toLowerCase()] = html.slice(start, end);
  }
  return out;
}

function parseSection(html) {
  const out = [];
  const cardRe = /<h4 class="font-semibold pb-1 font-montserrat text-lg">([^<]+)<\/h4>([\s\S]*?)(?=<h4 class="font-semibold pb-1|$)/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeHtml(m[1].trim());
    out.push({ name });
  }
  return out;
}

async function main() {
  console.log('[1/3] Fetch tactics.tools/info/augments');
  const html = await get('https://tactics.tools/info/augments');
  console.log(`       html length: ${html.length}`);

  const tierHeaders = [...html.matchAll(/<h2[^>]*>(Silver|Gold|Prismatic)<\/h2>/gi)];
  if (tierHeaders.length < 3) {
    throw new Error(`Expected 3 tier headers, got ${tierHeaders.length}. tactics.tools HTML structure may have changed.`);
  }
  const sections = sliceByHeaders(html, tierHeaders);
  const silver = parseSection(sections.silver);
  const gold = parseSection(sections.gold);
  const prismatic = parseSection(sections.prismatic);
  console.log(`       parsed: silver=${silver.length} gold=${gold.length} prismatic=${prismatic.length}`);

  console.log('[2/3] Cross-reference with local TFT asset bundle');
  const live = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const riotByName = new Map();
  for (const [apiName, a] of Object.entries(live.augments)) {
    const norm = (a.name || '').toLowerCase().trim();
    if (!riotByName.has(norm)) riotByName.set(norm, []);
    riotByName.get(norm).push(apiName);
  }
  const override = {};
  const unmatched = { 1: [], 2: [], 3: [] };
  const tierMap = { 1: silver, 2: gold, 3: prismatic };
  for (const [tier, entries] of Object.entries(tierMap)) {
    const t = parseInt(tier, 10);
    for (const e of entries) {
      const hits = riotByName.get(e.name.toLowerCase().trim());
      if (!hits) { unmatched[t].push(e.name); continue; }
      for (const apiName of hits) override[apiName] = t;
    }
  }
  console.log(`       pinned: ${Object.keys(override).length} augments`);
  console.log(`       unmatched: silver=${unmatched[1].length} gold=${unmatched[2].length} prismatic=${unmatched[3].length}`);

  console.log('[3/3] Write public/tft-augment-tiers-' + live.set + '.json');
  const out = {
    set: live.set,
    source: 'tactics.tools/info/augments',
    fetchedAt: new Date().toISOString(),
    counts: { silver: silver.length, gold: gold.length, prismatic: prismatic.length, pinned: Object.keys(override).length },
    tiers: override,
  };
  writeFileSync(`public/tft-augment-tiers-${live.set}.json`, JSON.stringify(out, null, 2));
  console.log('       done.');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

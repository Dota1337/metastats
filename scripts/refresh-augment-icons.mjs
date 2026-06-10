#!/usr/bin/env node
/**
 * Builds public/tft-augment-icons-{set}.json — a Riot apiName → tactics.tools
 * CDN URL map for augment icons.
 *
 * Why: Riot ships ONE icon file per augment family on CDragon, even when the
 * augment exists in Silver/Gold/Prismatic variants. E.g. "Deadlier Blades"
 * (Prismatic in Set 17) ships with the gold-tinted artwork Riot used for the
 * augment's earlier Gold tier — the `_iii.tex` Prismatic variant doesn't
 * exist on CDragon (HEAD-probed 2026-06-10, all 404).
 *
 * tactics.tools keeps a separate icon per (augment-id, tier) at
 * `ap.tft.tools/img/augments/<stem>.png`. The stem ends in 1/2/3 = tier.
 *
 * Run on every patch — produces a name→stem map that overlays the CDragon
 * icon path in scripts/fetch-tft-assets.mjs.
 */
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { readFileSync, writeFileSync } from 'node:fs';

const CDN_BASE = 'https://ap.tft.tools/img/augments/';

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
        'Accept': 'text/html,*/*',
      },
    }, r => {
      const c = []; r.on('data', x => c.push(x));
      r.on('end', () => r.statusCode === 200 ? res(Buffer.concat(c).toString('utf8')) : rej(new Error('HTTP ' + r.statusCode)));
    });
    req.on('error', rej);
    req.setTimeout(60000, () => req.destroy(new Error('timeout')));
    req.end();
  }));
}
function decodeHtml(s) {
  return s.replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
}

function parseSection(html) {
  const out = [];
  const cardRe = /<h4 class="font-semibold pb-1 font-montserrat text-lg">([^<]+)<\/h4>([\s\S]*?)(?=<h4 class="font-semibold pb-1|$)/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeHtml(m[1].trim());
    const body = m[2];
    const imgMatch = body.match(/https:\/\/ap\.tft\.tools\/img\/augments\/([^"'\s\?]+)\.png/);
    if (imgMatch) out.push({ name, stem: imgMatch[1] });
  }
  return out;
}

async function main() {
  console.log('[1/3] Fetch tactics.tools/info/augments');
  const html = await get('https://tactics.tools/info/augments');

  const tierHeaders = [...html.matchAll(/<h2[^>]*>(Silver|Gold|Prismatic)<\/h2>/gi)];
  if (tierHeaders.length < 3) throw new Error(`Expected 3 tier headers, got ${tierHeaders.length}`);
  const sections = {};
  for (let i = 0; i < tierHeaders.length; i++) {
    const start = tierHeaders[i].index + tierHeaders[i][0].length;
    const end = i + 1 < tierHeaders.length ? tierHeaders[i + 1].index : html.length;
    sections[tierHeaders[i][1].toLowerCase()] = html.slice(start, end);
  }
  const all = [
    ...parseSection(sections.silver),
    ...parseSection(sections.gold),
    ...parseSection(sections.prismatic),
  ];
  console.log(`       parsed: ${all.length} augment cards with image stems`);

  console.log('[2/3] Cross-reference with local TFT asset bundle');
  const live = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const byName = new Map();
  for (const e of all) byName.set(e.name.toLowerCase().trim(), e.stem);
  const stems = {};
  let matched = 0, unmatched = 0;
  for (const [apiName, a] of Object.entries(live.augments)) {
    const stem = byName.get((a.name || '').toLowerCase().trim());
    if (stem) { stems[apiName] = stem; matched++; } else unmatched++;
  }
  console.log(`       pinned: ${matched} augments  unmatched: ${unmatched}`);

  console.log(`[3/3] Write public/tft-augment-icons-${live.set}.json`);
  writeFileSync(`public/tft-augment-icons-${live.set}.json`, JSON.stringify({
    set: live.set,
    source: 'tactics.tools/info/augments',
    cdn: CDN_BASE,
    fetchedAt: new Date().toISOString(),
    counts: { matched, unmatched },
    stems,
  }, null, 2));
  console.log('       done.');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

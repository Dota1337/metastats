#!/usr/bin/env node
/**
 * Builds public/tft-comp-augments-{set}.json from tftacademy.com.
 *
 * Riot's Match-V1 stopped exposing `augments` in participant DTOs at some
 * point in 2026 — verified 2026-06-18 across 12 M cache rows in 12 regions:
 * 0% with augments. We therefore can't statistically aggregate augment
 * recommendations from player data and rely on tftacademy's curated lists
 * instead.
 *
 * Each Set-17 comp has a curated list of ~8 augments displayed on its
 * detail page. We parse the comp slugs from the tier-list index, fetch
 * each detail page, slice the chunk around the comp's display anchor and
 * extract the augment apiNames from `assets.tftacademy.com/augments/
 * {apiName}.webp` URLs.
 *
 * The output is keyed by tftacademy-slug. A separate
 * `public/tft-comp-slug-map-{set}.json` (editorial) maps slugs to our
 * canonical cluster_key primary identity (trait + carry).
 *
 * Run on every patch — produces `{ comps: { slug: [apiName, ...] } }`.
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
        'Accept': 'text/html,*/*',
      },
    }, r => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        const next = r.headers.location.startsWith('http')
          ? r.headers.location
          : `https://${u.hostname}${r.headers.location}`;
        return get(next).then(res, rej);
      }
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractSlugsFromIndex(html, setNumber) {
  const re = new RegExp(`/tierlist/comps/set-${setNumber}-([a-z0-9-]+)`, 'g');
  return [...new Set([...html.matchAll(re)].map(m => m[1]))].sort();
}

// Find the comp's primary anchor by counting Augment URLs in a sliding
// window around each occurrence of the slug. The position with the densest
// augment-image cluster is the comp's card.
function extractAugmentsForSlug(html, slug, setNumber) {
  const slugFull = `set-${setNumber}-${slug}`;
  const positions = [];
  const re = new RegExp(slugFull.replace(/-/g, '\\-'), 'g');
  let m;
  while ((m = re.exec(html)) !== null) positions.push(m.index);
  if (positions.length === 0) return [];

  let best = { augs: [], score: 0 };
  for (const pos of positions) {
    const chunk = html.slice(pos, pos + 25000);
    const augMatches = [...chunk.matchAll(/augments\/(TFT\d*_?Augment_[A-Za-z0-9]+)\.webp/g)];
    if (augMatches.length === 0) continue;
    // Cluster-Score: how close are the augment URLs to the anchor? Use
    // the index of the LAST augment as a proxy for "block size" — smaller
    // = denser cluster around the anchor.
    const lastIdx = augMatches[augMatches.length - 1].index;
    const score = augMatches.length / Math.max(1, lastIdx / 1000);
    const augs = [...new Set(augMatches.map(a => a[1]))].slice(0, 8);
    if (score > best.score && augs.length >= 3) {
      best = { augs, score };
    }
  }
  return best.augs;
}

async function main() {
  const liveBundle = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const setNumber = liveBundle.set;
  const bundleAugs = new Set(Object.keys(liveBundle.augments || {}));

  console.log(`[1/3] Fetch tftacademy index for Set ${setNumber}`);
  const indexHtml = await get('https://tftacademy.com/tierlist/comps');
  const slugs = extractSlugsFromIndex(indexHtml, setNumber);
  console.log(`       found ${slugs.length} slugs: ${slugs.slice(0, 5).join(', ')}...`);

  console.log(`[2/3] Scrape augments per slug (sequential, ~2s pause)`);
  const comps = {};
  const unmatched = [];
  let success = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    try {
      const html = await get(`https://tftacademy.com/tierlist/comps/set-${setNumber}-${slug}`);
      const augs = extractAugmentsForSlug(html, slug, setNumber);
      // Verify apiNames exist in Riot's bundle — drop unknowns silently.
      const verified = augs.filter(a => bundleAugs.has(a));
      const dropped = augs.length - verified.length;
      if (verified.length >= 3) {
        comps[slug] = verified;
        success++;
        process.stdout.write(`       [${i + 1}/${slugs.length}] ${slug}: ${verified.length} augments${dropped > 0 ? ` (${dropped} unknown dropped)` : ''}\n`);
      } else {
        unmatched.push({ slug, found: augs.length, verified: verified.length });
        process.stdout.write(`       [${i + 1}/${slugs.length}] ${slug}: SPARSE (${verified.length} verified) — skipped\n`);
      }
    } catch (e) {
      unmatched.push({ slug, error: e.message });
      process.stdout.write(`       [${i + 1}/${slugs.length}] ${slug}: ERROR ${e.message}\n`);
    }
    if (i < slugs.length - 1) await sleep(2000);
  }

  console.log(`[3/3] Write public/tft-comp-augments-${setNumber}.json (${success}/${slugs.length} comps)`);
  const out = {
    set: setNumber,
    source: 'tftacademy.com/tierlist/comps',
    fetchedAt: new Date().toISOString(),
    counts: { slugs: slugs.length, populated: success, skipped: unmatched.length },
    comps,
    unmatched,
  };
  writeFileSync(`public/tft-comp-augments-${setNumber}.json`, JSON.stringify(out, null, 2));
  console.log(`       done.`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

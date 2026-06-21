#!/usr/bin/env node
/**
 * Builds public/tft-augment-stages-{set}.json from tactics.tools — the only
 * publicly accessible ground-truth for per-Augment Stage-Constraints we found.
 *
 * Pattern: tactics.tools/info/augments rendert pro Augment-Card unter dem
 * Tier-Header zusätzlich 3 Stage-Pills („2-1" / „3-2" / „4-2"). Inactive
 * Stages haben eine opacity-30-Klasse, active sind voll opak. Wir parsen
 * pro Augment welche Stages active sind und schreiben das als Array.
 *
 * Schema-Beispiel:
 *   {
 *     "set": 17,
 *     "source": "tactics.tools/info/augments",
 *     "fetchedAt": "...",
 *     "counts": { "covered": 261, "unmatched": 4 },
 *     "stages": {
 *       "TFT_Augment_AFK":              ["2-1"],
 *       "TFT_Augment_BoxingLessons":    ["3-2", "4-2"],
 *       "TFT_Augment_HeroicGrabBag":    ["2-1"],
 *       "TFT_Augment_HeroicGrabBagPlus":["3-2"],
 *       ...
 *     }
 *   }
 *
 * Run on every patch — analog zu refresh-augment-tiers.mjs. Bei HTML-
 * Struktur-Änderungen am tactics.tools-Markup schlägt der Parser laut fehl
 * (no silent default — siehe feedback_no_fake_values).
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

// Pro Augment-Card (h4) parsen wir den nachfolgenden Body bis zum nächsten
// h4 — darin sind die 3 Stage-Pills. tactics.tools rendert sie als kleine
// Divs mit Text „2-1" / „3-2" / „4-2". Inactive haben `opacity-30` im
// className, active haben das nicht.
function parseAugmentCards(html) {
  const out = [];
  const cardRe = /<h4 class="font-semibold pb-1 font-montserrat text-lg">([^<]+)<\/h4>([\s\S]*?)(?=<h4 class="font-semibold pb-1|$)/g;
  let m;
  while ((m = cardRe.exec(html)) !== null) {
    const name = decodeHtml(m[1].trim());
    const body = m[2];
    const stages = parseStagesFromBody(body);
    out.push({ name, stages });
  }
  return out;
}

// Pro Card-Body finde alle Stage-Pill-Divs. Pragmatisch parsing: jeder Div
// der genau einen Stage-Text („2-1", „3-2", „4-2") enthält + optional einen
// opacity-30-Marker. Wir akzeptieren mehrere Markup-Varianten.
const STAGES = ['2-1', '3-2', '4-2'];
function parseStagesFromBody(body) {
  const active = [];
  for (const stage of STAGES) {
    // Match: <div class="...">...2-1...</div>
    // Heuristik: Stage-String erscheint in einem div mit class-Attribut.
    // Wenn das Closest-Class-Attribut `opacity-30` enthält → inactive.
    // Sonst: active.
    //
    // Wir suchen alle Occurrences des Stage-Strings im body, und prüfen
    // pro Match das nächst-vorangehende class="..."-Attribut.
    const re = new RegExp(`<div[^>]*class="([^"]*)"[^>]*>\\s*${stage.replace('-', '\\-')}\\s*</div>`, 'g');
    let foundActive = false;
    let foundAny = false;
    let mm;
    while ((mm = re.exec(body)) !== null) {
      foundAny = true;
      const className = mm[1] || '';
      if (!/opacity-30/.test(className)) {
        foundActive = true;
        break;
      }
    }
    if (foundActive) active.push(stage);
    // Wenn der Stage gar nicht im Body steht: Markup-Drift, skip (Hardfail
    // im Aggregat-Check unten wenn zu viele Augments leer sind).
  }
  return active;
}

async function main() {
  console.log('[1/3] Fetch tactics.tools/info/augments');
  const html = await get('https://tactics.tools/info/augments');
  console.log(`       html length: ${html.length}`);

  const cards = parseAugmentCards(html);
  console.log(`       parsed cards: ${cards.length}`);
  const withStages = cards.filter(c => c.stages.length > 0).length;
  console.log(`       cards with at least 1 active stage: ${withStages}`);

  if (cards.length < 50) {
    throw new Error(`Too few cards parsed (${cards.length}). HTML structure changed?`);
  }
  if (withStages < cards.length * 0.5) {
    throw new Error(
      `Too few cards have stage data (${withStages}/${cards.length}). `
      + `HTML structure changed? Investigate the stage-div pattern.`,
    );
  }

  console.log('[2/3] Cross-reference with local TFT asset bundle');
  const live = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const riotByName = new Map();
  for (const [apiName, a] of Object.entries(live.augments)) {
    const norm = (a.name || '').toLowerCase().trim();
    if (!riotByName.has(norm)) riotByName.set(norm, []);
    riotByName.get(norm).push(apiName);
  }
  const override = {};
  const unmatched = [];
  for (const c of cards) {
    const hits = riotByName.get(c.name.toLowerCase().trim());
    if (!hits) { unmatched.push(c.name); continue; }
    for (const apiName of hits) override[apiName] = c.stages;
  }
  console.log(`       pinned: ${Object.keys(override).length} augments`);
  console.log(`       unmatched (tactics.tools name not in bundle): ${unmatched.length}`);
  if (unmatched.length > 0 && unmatched.length <= 20) {
    console.log(`       unmatched names: ${unmatched.join(', ')}`);
  }

  // Stage-Distribution für Sanity-Check
  const patterns = {};
  for (const s of Object.values(override)) {
    const key = s.join('|') || '(none)';
    patterns[key] = (patterns[key] || 0) + 1;
  }
  console.log('       stage-pattern distribution:');
  for (const [k, v] of Object.entries(patterns).sort((a, b) => b[1] - a[1])) {
    console.log(`         ${k}: ${v}`);
  }

  console.log('[3/3] Write public/tft-augment-stages-' + live.set + '.json');
  const out = {
    set: live.set,
    source: 'tactics.tools/info/augments',
    fetchedAt: new Date().toISOString(),
    counts: {
      cards: cards.length,
      pinned: Object.keys(override).length,
      unmatched: unmatched.length,
      patterns,
    },
    stages: override,
  };
  writeFileSync(`public/tft-augment-stages-${live.set}.json`, JSON.stringify(out, null, 2));
  console.log('       done.');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

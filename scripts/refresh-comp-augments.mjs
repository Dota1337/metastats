#!/usr/bin/env node
/**
 * Builds public/tft-comp-guides-{set}.json from tftacademy.com.
 *
 * Riot's Match-V1 stopped exposing `augments` in participant DTOs at some
 * point in 2026 (verified 2026-06-18 across 12M cache rows: 0% populated).
 * Statistical augment aggregation from player data is therefore dead. We
 * surface curated recommendations + early-game build + stage tips from
 * tftacademy's per-comp guide pages, parsed from the SvelteKit inline
 * hydration data island.
 *
 * Per comp we extract (per data-skeptic verdict 2026-06-18):
 *   - augments[]        — 8 apiNames, slot-ordered
 *   - augmentTypes[]    — parallel to augments, vocabulary {ECON, ITEMS,
 *                         COMBAT, EMBLEM, HERO}
 *   - augmentsTip       — string, free-text guidance
 *   - carousel[]        — round-1 item apiNames
 *   - earlyComp[]       — strict 4 champions w/ {apiName, items[], stars}
 *   - tips[]            — {stage, tip} array (2-5 entries, Stage 2..5)
 *   - difficulty        — EASY | MEDIUM | HARD | CONDITIONAL
 *   - title, updated    — display metadata
 *
 * Parsing strategy (architect verdict): NO eval, NO object-slicing.
 * Per-slug field-by-field regex against the slug-anchored chunk. Robust
 * against SvelteKit minifier output. Partial slugs (editorial gaps —
 * nova-yi, nami-flex, vanguard-asol-flex) are written with skeleton
 * fields rather than fake defaults (`feedback_no_fake_values`).
 *
 * Run on every patch — produces tft-comp-guides-{set}.json.
 */
import { request } from 'node:https';
import { lookup } from 'node:dns';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local so ANTHROPIC_API_KEY is available when running standalone
// (Daily-Crawl Workflow already injects env via repository secrets).
function loadDotEnvLocal() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadDotEnvLocal();

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

// Paraphrase + localize the raw augmentsTip via Anthropic. Returns
// { de, en, ko, zh, es, fr } when the response parses + validates,
// otherwise null (UI then renders no tip rather than fake content).
async function paraphraseTip(anthropic, rawTip, compTitle, carryName) {
  if (!rawTip || rawTip.trim().length === 0) return null;
  const prompt = `You're paraphrasing a Teamfight Tactics comp build tip so it reads in our own words rather than the source phrasing. Preserve EVERY proper noun and game term:
- Champion names (e.g. Lulu, Pantheon, Gnar)
- Trait, variant, constellation names (e.g. Mountain, Fountain, Stargazer, Medallion)
- Augment names
- Star levels (3-star, Pantheon 3)
- Stage references (Stage 2, stage 4-1)
- Conditional logic ("if A then B")
- Comparisons ("X > Y")

Comp: ${compTitle} (carry: ${carryName})
Original tip:
"${rawTip}"

Output exactly one JSON object with paraphrased translations into 6 languages. Each translation MUST keep the proper nouns identical (do not translate champion/trait/augment names). Each translation under 280 characters. No preamble, no markdown, just JSON:
{"de":"...","en":"...","ko":"...","zh":"...","es":"...","fr":"..."}`;

  let response;
  try {
    response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
  } catch (e) {
    process.stdout.write(`        ⚠ Anthropic API error: ${e.message}\n`);
    return null;
  }
  const text = response.content?.[0]?.type === 'text' ? response.content[0].text : '';
  // Strip any accidental code-fence wrapping
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed;
  try { parsed = JSON.parse(jsonMatch[0]); } catch { return null; }
  const langs = ['de', 'en', 'ko', 'zh', 'es', 'fr'];
  for (const k of langs) {
    if (typeof parsed[k] !== 'string' || parsed[k].trim().length === 0) return null;
  }
  // Anti-hallucination guard: at least 3 proper-noun tokens from the original
  // must appear in the English paraphrase (case-insensitive). Catches LLM
  // outputs that summarised away the strategic detail.
  const propers = [...new Set((rawTip.match(/\b[A-Z][a-z]{2,}|\b\d-?(?:star|cost)|stage\s*\d-?\d?/gi) || []))];
  const enLower = parsed.en.toLowerCase();
  const matched = propers.filter(p => enLower.includes(p.toLowerCase())).length;
  if (propers.length >= 3 && matched < 3) {
    process.stdout.write(`        ⚠ Paraphrase dropped — only ${matched}/${propers.length} proper nouns preserved\n`);
    return null;
  }
  return parsed;
}

function extractSlugsFromIndex(html, setNumber) {
  const re = new RegExp(`/tierlist/comps/set-${setNumber}-([a-z0-9-]+)`, 'g');
  return [...new Set([...html.matchAll(re)].map(m => m[1]))].sort();
}

// Locate the densest occurrence of the slug in the page (= comp's own card
// section). Earlier occurrences are usually breadcrumbs / sidebar links.
function findCompChunk(html, slug, setNumber) {
  const anchor = `compSlug:"set-${setNumber}-${slug}"`;
  const pos = html.indexOf(anchor);
  if (pos < 0) return null;
  // Slice generously — comp data extends ~5-15 KB after the anchor; the next
  // comp is delimited by another `compSlug:"set-N-..."` literal.
  const startBack = Math.max(0, pos - 8000);
  const end = Math.min(html.length, pos + 12000);
  return html.slice(startBack, end);
}

// Field extractors — each returns null on failure (= editorial gap), never
// a fake default. Caller decides skeleton-vs-skip.

function extractStringField(chunk, fieldName) {
  // tftacademy escapes inner double-quotes as \" and inner backslashes as \\.
  // We capture the value literal and unescape minimally.
  const re = new RegExp(`${fieldName}:"((?:\\\\.|[^"\\\\])*)"`);
  const m = re.exec(chunk);
  if (!m) return null;
  return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
}

function extractStringArray(chunk, fieldName) {
  // Pattern: fieldName:["a","b",...]
  const re = new RegExp(`${fieldName}:\\[((?:"[^"]*"(?:,)?)*)\\]`);
  const m = re.exec(chunk);
  if (!m) return null;
  const inner = m[1];
  return [...inner.matchAll(/"([^"]*)"/g)].map(x => x[1]);
}

function extractApiNameArray(chunk, fieldName) {
  // Pattern: fieldName:[{apiName:"X",...},...] — multi-key objects.
  // Slice the array body and collect inner apiName values.
  const re = new RegExp(`${fieldName}:\\[(.*?)\\]`, 's');
  const m = re.exec(chunk);
  if (!m) return null;
  const inner = m[1];
  return [...inner.matchAll(/apiName:"([^"]+)"/g)].map(x => x[1]);
}

// earlyComp has items[] nested per champion entry. Parse the comp body
// into [{apiName, items[], stars}] preserving order.
function extractEarlyComp(chunk) {
  // Slice between `earlyComp:[` and the matching closing `]` at depth 0.
  const startIdx = chunk.indexOf('earlyComp:[');
  if (startIdx < 0) return null;
  let depth = 0;
  let i = startIdx + 'earlyComp:'.length;
  let bodyStart = -1;
  for (; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === '[') { if (depth === 0) bodyStart = i + 1; depth++; }
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  if (bodyStart < 0 || i >= chunk.length) return null;
  const body = chunk.slice(bodyStart, i);
  // Split by `},{` at depth 1 (sloppy but works because champion entries
  // don't nest beyond items:[..])
  const entries = [];
  let curStart = 0;
  let curDepth = 0;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '{') curDepth++;
    else if (c === '}') {
      curDepth--;
      if (curDepth === 0) {
        entries.push(body.slice(curStart, j + 1));
        // skip the comma between objects
        while (j + 1 < body.length && (body[j + 1] === ',' || /\s/.test(body[j + 1]))) j++;
        curStart = j + 1;
      }
    }
  }
  return entries.map(e => {
    const apiName = /apiName:"([^"]+)"/.exec(e)?.[1] || null;
    const stars = Number(/stars:(\d+)/.exec(e)?.[1] || '1');
    const itemsBody = /items:\[([^\]]*)\]/.exec(e)?.[1] || '';
    const items = [...itemsBody.matchAll(/"([^"]+)"/g)].map(x => x[1]);
    return apiName ? { apiName, items, stars } : null;
  }).filter(Boolean);
}

// tips has {stage:"Stage 2",tip:"..."} objects. Parse preserving order.
function extractTips(chunk) {
  const startIdx = chunk.indexOf('tips:[');
  if (startIdx < 0) return null;
  let depth = 0;
  let i = startIdx + 'tips:'.length;
  let bodyStart = -1;
  for (; i < chunk.length; i++) {
    const c = chunk[i];
    if (c === '[') { if (depth === 0) bodyStart = i + 1; depth++; }
    else if (c === ']') { depth--; if (depth === 0) break; }
  }
  if (bodyStart < 0 || i >= chunk.length) return null;
  const body = chunk.slice(bodyStart, i);
  const entries = [];
  let curDepth = 0;
  let curStart = 0;
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === '{') curDepth++;
    else if (c === '}') {
      curDepth--;
      if (curDepth === 0) {
        entries.push(body.slice(curStart, j + 1));
        while (j + 1 < body.length && (body[j + 1] === ',' || /\s/.test(body[j + 1]))) j++;
        curStart = j + 1;
      }
    }
  }
  return entries.map(e => {
    const stage = /stage:"([^"]*)"/.exec(e)?.[1] || null;
    const tipMatch = /tip:"((?:\\.|[^"\\])*)"/.exec(e);
    const tip = tipMatch ? tipMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
    return stage ? { stage, tip } : null;
  }).filter(Boolean);
}

const VALID_AUGMENT_TYPES = new Set(['ECON', 'ITEMS', 'COMBAT', 'EMBLEM', 'HERO']);
const VALID_DIFFICULTIES = new Set(['EASY', 'MEDIUM', 'HARD', 'CONDITIONAL']);

// tftacademy supplies augmentTypes as a list of 3 unique slot-headers
// (one per round-augment slot — Stage 2-1, 3-2, 4-2). Their canonical
// distribution across 8 augment picks is 3+3+2 (Round 2-1 has 3 options,
// 3-2 has 3, 4-2 has 2). Expand the slot-headers into a parallel array of
// length 8 so consumers can map augments[i] → augmentTypes[i] directly.
//
// When the augments / slot-headers counts don't fit the standard pattern,
// return an empty array — the UI then renders flat (no slot grouping)
// rather than mislabel.
function expandAugmentTypes(augments, slotHeaders) {
  if (augments.length === 8 && slotHeaders.length === 3) {
    return [
      slotHeaders[0], slotHeaders[0], slotHeaders[0],
      slotHeaders[1], slotHeaders[1], slotHeaders[1],
      slotHeaders[2], slotHeaders[2],
    ];
  }
  // Fall-through: future schema (more slots, different counts) — drop
  // the labels rather than guess. UI renders flat.
  return [];
}

async function main() {
  const liveBundle = JSON.parse(readFileSync('public/tft-assets.json', 'utf8'));
  const setNumber = liveBundle.set;
  const bundleAugs = new Set(Object.keys(liveBundle.augments || {}));
  const bundleChamps = new Set(Object.keys(liveBundle.champions || {}));

  // Anthropic client for tip paraphrase+translation. Optional — if key is
  // missing, the scraper still runs but emits raw tips (back-compat).
  let anthropic = null;
  if (process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    console.log('       Anthropic SDK initialised — tips will be paraphrased + localised');
  } else {
    console.log('       ANTHROPIC_API_KEY missing — tips will stay as raw English copy');
  }

  console.log(`[1/3] Fetch tftacademy index for Set ${setNumber}`);
  const indexHtml = await get('https://tftacademy.com/tierlist/comps');
  const slugs = extractSlugsFromIndex(indexHtml, setNumber);
  console.log(`       found ${slugs.length} slugs`);

  console.log(`[2/3] Scrape comp guides per slug (sequential, ~2s pause)`);
  const comps = {};
  const skipped = [];
  let fullCount = 0;
  let partialCount = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    try {
      const html = await get(`https://tftacademy.com/tierlist/comps/set-${setNumber}-${slug}`);
      const chunk = findCompChunk(html, slug, setNumber);
      if (!chunk) {
        skipped.push({ slug, reason: 'no anchor found' });
        process.stdout.write(`       [${i + 1}/${slugs.length}] ${slug}: NO ANCHOR — skipped\n`);
        if (i < slugs.length - 1) await sleep(2000);
        continue;
      }

      const augments = (extractApiNameArray(chunk, 'augments') || []).filter(a => bundleAugs.has(a));
      const slotHeaders = (extractStringArray(chunk, 'augmentTypes') || [])
        .filter(t => VALID_AUGMENT_TYPES.has(t));
      const augmentTypes = expandAugmentTypes(augments, slotHeaders);
      const carousel = (extractApiNameArray(chunk, 'carousel') || []);
      const earlyComp = (extractEarlyComp(chunk) || []).filter(e => bundleChamps.has(e.apiName));
      const tips = (extractTips(chunk) || []).filter(t => t.tip && t.tip.trim());
      const rawDifficulty = extractStringField(chunk, 'difficulty');
      const difficulty = VALID_DIFFICULTIES.has(rawDifficulty) ? rawDifficulty : null;
      const title = extractStringField(chunk, 'title');
      const updated = extractStringField(chunk, 'updated');
      const rawAugmentsTip = extractStringField(chunk, 'augmentsTip') || '';
      // Paraphrase + localise via Anthropic so the rendered tip is in our
      // own words (avoid wholesale text re-use). When the API call fails
      // or validation drops the result, we render no tip at all rather
      // than fall back to the verbatim source.
      let augmentsTip = null;
      if (anthropic && rawAugmentsTip) {
        const carryName = (title || slug).split(/\s+/).slice(-1)[0];
        augmentsTip = await paraphraseTip(anthropic, rawAugmentsTip, title || slug, carryName);
      }

      const entry = {
        title: title || slug,
        difficulty,
        updated: updated || null,
        augments,
        augmentTypes,
        augmentsTip,
        carousel,
        earlyComp,
        tips,
      };

      const hasMinimum = augments.length >= 3 || earlyComp.length >= 3 || tips.length >= 1;
      if (hasMinimum) {
        comps[slug] = entry;
        const isFull = augments.length === 8 && earlyComp.length === 4 && tips.length >= 1;
        if (isFull) fullCount++; else partialCount++;
        const marker = isFull ? '✓' : '◦';
        process.stdout.write(
          `       [${i + 1}/${slugs.length}] ${marker} ${slug}: aug=${augments.length}/${augmentTypes.length} early=${earlyComp.length} tips=${tips.length} diff=${difficulty || '?'}\n`
        );
      } else {
        skipped.push({ slug, reason: 'editorial gap — minimum data missing' });
        process.stdout.write(`       [${i + 1}/${slugs.length}] · ${slug}: editorial gap — skipped\n`);
      }
    } catch (e) {
      skipped.push({ slug, error: e.message });
      process.stdout.write(`       [${i + 1}/${slugs.length}] ${slug}: ERROR ${e.message}\n`);
    }
    if (i < slugs.length - 1) await sleep(2000);
  }

  console.log(`[3/3] Write public/tft-comp-guides-${setNumber}.json (${fullCount} full + ${partialCount} partial / ${slugs.length} slugs, ${skipped.length} skipped)`);
  const out = {
    set: setNumber,
    source: 'tftacademy.com/tierlist/comps (SvelteKit hydration data island)',
    fetchedAt: new Date().toISOString(),
    counts: {
      slugsIndexed: slugs.length,
      populatedFull: fullCount,
      populatedPartial: partialCount,
      skipped: skipped.length,
    },
    comps,
    skipped,
  };
  writeFileSync(`public/tft-comp-guides-${setNumber}.json`, JSON.stringify(out, null, 2));
  console.log(`       done.`);
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

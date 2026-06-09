// Shared Liquipedia/TFT helpers — used by every script that calls the
// teamfighttactics wiki API. Centralises rate-limiting, UA, retry logic,
// dollar-template parsing AND a cross-process rate-limit lock + ETag-based
// HTTP cache so the whole pipeline stays under Liquipedia's rate budget.
//
// Rate-limit strategy (3 layers, in order):
//   1. In-process minimum delay between calls (last-call timestamp in memory).
//   2. Cross-process minimum delay via a timestamp file shared across all
//      crawler subprocesses. Without this, the watchdog's forked pipeline
//      burst-fires calls at every script boundary (last_call_at resets to 0
//      when a new Node starts).
//   3. HTTP cache with If-None-Match / If-Modified-Since. Wikitext rarely
//      changes — a 304 response is ~free for Liquipedia and lifts our
//      effective rate dramatically. Cache lives in $METASTATS_LIQ_CACHE_DIR
//      (or $TMPDIR/metastats-liquipedia-cache) keyed by SHA-256 of the URL.

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
const LIQUIPEDIA_BASE = 'https://liquipedia.net';
// 5 seconds between Liquipedia calls — Liquipedia's published ToU asks for
// "at least 2 seconds"; we run with 2.5x headroom because our pipeline
// occasionally double-counts when subprocess boundaries reset the in-process
// counter. With the cross-process lock below this becomes globally enforced.
const DEFAULT_MIN_DELAY_MS = 5000;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

// Cross-process state files. Tiny (one int / one short string), atomic writes.
const LOCK_FILE = process.env.METASTATS_LIQ_LOCK_FILE
  || join(tmpdir(), 'metastats-liquipedia-last-call');
const CACHE_DIR = process.env.METASTATS_LIQ_CACHE_DIR
  || join(tmpdir(), 'metastats-liquipedia-cache');
// Cache entries older than this re-fetch unconditionally (still with ETag
// so a quick 304 is possible if Liquipedia agrees). 24h is short enough that
// a daily Re-Crawl picks up edits, long enough that a single weekly enrich
// hits the cache for the same page on day 2+.
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let inProcessLastCallAt = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Cross-process gate. Reads the last-call timestamp from a tiny file shared
// by every node process in this pipeline. Bumps it BEFORE sending the call
// so concurrent subprocess starts serialise cleanly. Falls back to the in-
// process timestamp if the file isn't accessible (e.g. read-only fs).
async function rateLimitGate(minDelayMs = DEFAULT_MIN_DELAY_MS) {
  let lastCallAt = inProcessLastCallAt;
  try {
    if (existsSync(LOCK_FILE)) {
      const raw = readFileSync(LOCK_FILE, 'utf8').trim();
      const persisted = Number(raw) || 0;
      if (persisted > lastCallAt) lastCallAt = persisted;
    }
  } catch {}
  const now = Date.now();
  const wait = lastCallAt + minDelayMs - now;
  if (wait > 0) await sleep(wait);
  const stamp = Date.now();
  inProcessLastCallAt = stamp;
  try {
    writeFileSync(LOCK_FILE, String(stamp));
  } catch {}
}

// ─── HTTP cache ─────────────────────────────────────────────────────────
// Disk cache keyed by SHA-256 of the request URL. Stores body + ETag + Last-
// Modified + timestamp. Read on the way in, used to send conditional headers
// (If-None-Match, If-Modified-Since) and to short-circuit 304 responses
// without parsing JSON twice.

function cacheKey(url) {
  return createHash('sha256').update(url).digest('hex');
}

function cachePath(url) {
  return join(CACHE_DIR, cacheKey(url) + '.json');
}

function readCache(url) {
  try {
    const p = cachePath(url);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch { return null; }
}

function writeCache(url, entry) {
  try {
    if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(cachePath(url), JSON.stringify(entry));
  } catch (e) {
    // Cache write failures are non-fatal — just means the next call refetches.
  }
}

// ─── Core JSON fetcher ──────────────────────────────────────────────────
// 6-step exponential backoff for 429s. Total patience here is 30s + 60s +
// 120s + 240s + 480s + 960s ≈ 32 minutes — long enough to ride out a
// Cloudflare cool-off, short enough that a genuinely broken request fails
// in finite time.
export async function liquipediaJson(params, { minDelayMs, noCache } = {}) {
  const url = `${LIQUIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  // Try cache before touching the network — never goes through the rate-
  // limit gate, so a cache hit costs us zero rate budget.
  if (!noCache) {
    const c = readCache(url);
    if (c && c.body && Date.now() - (c.fetchedAt || 0) < CACHE_MAX_AGE_MS) {
      return c.body;
    }
  }

  await rateLimitGate(minDelayMs);
  const cached = !noCache ? readCache(url) : null;
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept-Encoding': 'gzip, deflate',
  };
  // Send conditional headers when we have them — Liquipedia's CDN responds
  // 304 for unchanged pages, which doesn't count toward our rate budget AND
  // doesn't require re-parsing.
  if (cached?.etag) headers['If-None-Match'] = cached.etag;
  if (cached?.lastModified) headers['If-Modified-Since'] = cached.lastModified;

  let backoff = 30_000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers });

    if (res.status === 304 && cached) {
      // Refresh fetchedAt so we don't re-validate every call.
      writeCache(url, { ...cached, fetchedAt: Date.now() });
      return cached.body;
    }
    if (res.ok) {
      const body = await res.json();
      writeCache(url, {
        body,
        etag: res.headers.get('etag') || undefined,
        lastModified: res.headers.get('last-modified') || undefined,
        fetchedAt: Date.now(),
      });
      return body;
    }
    if (res.status === 429 && attempt < 5) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 0;
      const wait = Math.max(retryAfter * 1000, backoff);
      console.log(`  [liquipedia] 429 — backoff ${Math.round(wait/1000)}s (attempt ${attempt+1}/6)`);
      await sleep(wait);
      backoff *= 2;
      continue;
    }
    if (res.status === 404) return null;
    throw new Error(`Liquipedia HTTP ${res.status}: ${url.slice(0, 200)}`);
  }
  throw new Error('Liquipedia 429 after 6 attempts');
}

// Rendered HTML for a page (`action=parse&prop=text`). Used for tables that
// don't survive wikitext parsing (e.g. {{Achievements}} templates that pull
// data from Cargo at render time).
export async function liquipediaHtml(title, opts) {
  const j = await liquipediaJson({ action: 'parse', page: title, prop: 'text', disablelimitreport: '1' }, opts);
  return j?.parse?.text?.['*'] || '';
}

// Wikitext of a page — preferred for participant lists and other content that
// uses public templates ({{SoloOpponent}}, {{Slot}}…).
export async function liquipediaWikitext(title, opts) {
  const j = await liquipediaJson({ action: 'parse', page: title, prop: 'wikitext' }, opts);
  return j?.parse?.wikitext?.['*'] || '';
}

// Enumerate all page titles in a Liquipedia category — handles cmcontinue
// paging transparently. Each underlying call respects the rate-limit gate.
export async function liquipediaCategoryMembers(category) {
  const pages = [];
  let cmcontinue = null;
  do {
    const params = {
      action: 'query', list: 'categorymembers',
      cmtitle: `Category:${category}`, cmlimit: '500', cmtype: 'page',
    };
    if (cmcontinue) params.cmcontinue = cmcontinue;
    const j = await liquipediaJson(params);
    for (const m of j?.query?.categorymembers || []) pages.push(m.title);
    cmcontinue = j?.continue?.cmcontinue || null;
  } while (cmcontinue);
  return pages;
}

// Batched wikitext fetch — up to 50 titles per request via prop=revisions.
// Returns Map<title, wikitext>. Saves ~50× rate budget vs per-page parsing
// when iterating over Category:Players.
export async function liquipediaWikitextsBatch(titles) {
  const out = new Map();
  const BATCH = 50;
  for (let i = 0; i < titles.length; i += BATCH) {
    const batch = titles.slice(i, i + BATCH);
    const j = await liquipediaJson({
      action: 'query', prop: 'revisions',
      titles: batch.join('|'),
      rvprop: 'content', rvslots: 'main',
    });
    const pages = j?.query?.pages || {};
    for (const p of Object.values(pages)) {
      const title = p.title;
      const content = p.revisions?.[0]?.slots?.main?.['*']
        || p.revisions?.[0]?.['*']
        || '';
      if (title) out.set(title, content);
    }
  }
  return out;
}

// Server-side template expansion — for {{SetName/N}}-style templates the
// local lookup doesn't know. On-demand only; never use as a default since
// it costs an extra round-trip.
export async function expandTemplates(text) {
  if (!text) return text;
  try {
    const j = await liquipediaJson({ action: 'expandtemplates', text, prop: 'wikitext' });
    return j?.expandtemplates?.wikitext || text;
  } catch { return text; }
}

// ─── Template parsing utilities ─────────────────────────────────────────

// Depth-balanced {{Template ...}} extractor. Returns { start, end, body } for
// the first occurrence, where body is the content between the outer braces.
// Handles nested templates and case-insensitive first letter (Mediawiki rule).
export function findTemplate(wikitext, templateName, from = 0) {
  const lower = templateName.charAt(0).toLowerCase() + templateName.slice(1);
  const upper = templateName.charAt(0).toUpperCase() + templateName.slice(1);
  const markers = upper === lower ? [`{{${lower}`] : [`{{${lower}`, `{{${upper}`];
  let idx = from;
  while (true) {
    let start = -1, marker = '';
    for (const mk of markers) {
      const p = wikitext.indexOf(mk, idx);
      if (p >= 0 && (start < 0 || p < start)) { start = p; marker = mk; }
    }
    if (start < 0) return null;
    const next = wikitext[start + marker.length];
    if (next !== '|' && next !== ' ' && next !== '\n' && next !== '}') {
      idx = start + 1; continue;
    }
    let depth = 0, i = start;
    while (i < wikitext.length) {
      if (wikitext[i] === '{' && wikitext[i+1] === '{') { depth++; i += 2; continue; }
      if (wikitext[i] === '}' && wikitext[i+1] === '}') {
        depth--; i += 2;
        if (depth === 0) return { start, end: i, body: wikitext.slice(start + marker.length, i - 2) };
        continue;
      }
      i++;
    }
    return null;
  }
}

export function findAllTemplates(wikitext, templateName) {
  const out = []; let from = 0;
  while (true) {
    const t = findTemplate(wikitext, templateName, from);
    if (!t) break;
    out.push(t); from = t.end;
  }
  return out;
}

// Resolve a relative Liquipedia image href to an absolute URL.
export function absoluteUrl(href) {
  if (!href) return null;
  if (href.startsWith('//')) return 'https:' + href;
  if (href.startsWith('/')) return LIQUIPEDIA_BASE + href;
  if (/^https?:\/\//.test(href)) return href;
  return null;
}

// Diagnostics — call from the watchdog to check cache health.
export function cacheStats() {
  try {
    if (!existsSync(CACHE_DIR)) return { entries: 0, sizeBytes: 0 };
    const fs = require('node:fs');
    let entries = 0, sizeBytes = 0;
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (!f.endsWith('.json')) continue;
      entries++;
      try { sizeBytes += statSync(join(CACHE_DIR, f)).size; } catch {}
    }
    return { entries, sizeBytes };
  } catch { return { entries: 0, sizeBytes: 0 }; }
}

export const constants = {
  LIQUIPEDIA_API, LIQUIPEDIA_BASE, USER_AGENT,
  DEFAULT_MIN_DELAY_MS, LOCK_FILE, CACHE_DIR, CACHE_MAX_AGE_MS,
};

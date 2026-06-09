// Shared Liquipedia/TFT helpers — used by every script that calls the
// teamfighttactics wiki API. Centralises rate-limiting, UA, retry logic and
// dollar-template parsing so a single change here adjusts every consumer.
//
// Why centralised: Liquipedia's published ToU is "at least 2 seconds between
// requests". Multiple scripts each maintaining their own 2.1s delay still
// drives the wiki to 429 because the in-process clocks don't share state.
// This helper enforces a single global cool-off across the whole process,
// no matter how many functions concurrently start fetches.

const LIQUIPEDIA_API = 'https://liquipedia.net/teamfighttactics/api.php';
const LIQUIPEDIA_BASE = 'https://liquipedia.net';
// 3.5s is a comfortable margin over the 2s minimum — gives Liquipedia
// headroom against clock-skew + occasional double-counts and keeps us off
// the rate-limit radar across long runs (~half-hour enrichments).
const DEFAULT_MIN_DELAY_MS = 3500;
const USER_AGENT = 'metastats-bot/1.0 (https://metastats.gg; info@metastats.gg)';

let lastCallAt = 0;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Global rate-limit gate. Awaits whatever time is still left until the next
// allowed Liquipedia call (delay since last call < min). Bumps the last-call
// timestamp before returning so concurrent awaiters serialise cleanly.
async function rateLimitGate(minDelayMs = DEFAULT_MIN_DELAY_MS) {
  const now = Date.now();
  const wait = lastCallAt + minDelayMs - now;
  if (wait > 0) await sleep(wait);
  lastCallAt = Date.now();
}

// Core JSON fetcher with 6-step exponential backoff for 429s. Total patience
// here is 30s + 60s + 120s + 240s + 480s + 960s ≈ 32 minutes — long enough
// to ride out a Cloudflare cool-off if we hit one, short enough that an
// actually-broken request fails the script in finite time.
export async function liquipediaJson(params, { minDelayMs } = {}) {
  await rateLimitGate(minDelayMs);
  const url = `${LIQUIPEDIA_API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  let backoff = 30_000;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip, deflate' },
    });
    if (res.ok) return res.json();
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

export const constants = { LIQUIPEDIA_API, LIQUIPEDIA_BASE, USER_AGENT, DEFAULT_MIN_DELAY_MS };

// Event-dated FX rates for tournament prize-money conversion (W1, 2026-07-04).
//
// Source: frankfurter.app (ECB reference rates — free, keyless, history to 1999).
// ECB reference vs market rate differs <1%, irrelevant for prize display.
// The ECB basket covers KRW/JPY/CNY (the actual offenders in our data) but NOT
// VND, TWD or RUB (suspended 2022) — for those the caller must keep prize_usd
// NULL and persist the native amount instead (feedback_no_fake_values: an honest
// gap beats a fabricated rate).
//
// Every resolved (currency, requested-date) pair is cached in data/fx-rates.json
// and committed back to the repo (workflow commit-back), so re-runs are
// deterministic and offline-capable. Weekends/holidays: frankfurter returns the
// last banking day — we store BOTH the requested date (cache key) and the
// effective date the rate is for (fx_date in the DB), so the cache stays
// reproducible (data-skeptic 2026-07-04).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, '..', '..', 'data', 'fx-rates.json');

// Not in the ECB basket — skip the API call, caller stores native-only.
const UNSUPPORTED = new Set(['VND', 'TWD', 'RUB']);

let _cache = null;
function loadCache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8')); }
  catch { _cache = {}; }
  return _cache;
}

function saveCache() {
  if (!_cache) return;
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  // Stable key order → minimal diffs in the committed cache file.
  const sorted = Object.fromEntries(Object.entries(_cache).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(CACHE_PATH, JSON.stringify(sorted, null, 2) + '\n', 'utf8');
}

/**
 * USD rate for 1 unit of `currency` on `dateIso` (event date).
 * Returns { rate, effectiveDate } or null (unsupported currency / API failure).
 * Never throws; a failed lookup is the caller's cue to keep prize_usd NULL.
 */
export async function getUsdRate(currency, dateIso) {
  const cur = (currency || '').trim().toUpperCase();
  if (!cur || !dateIso) return null;
  if (cur === 'USD') return { rate: 1, effectiveDate: dateIso };
  if (UNSUPPORTED.has(cur)) return null;

  const cache = loadCache();
  const key = `${cur}:${dateIso}`;
  if (cache[key]) return { rate: cache[key].rate, effectiveDate: cache[key].date };

  try {
    const res = await fetch(`https://api.frankfurter.app/${dateIso}?from=${cur}&to=USD`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;   // 404 = currency not in basket for that date
    const body = await res.json();
    const rate = body?.rates?.USD;
    const effectiveDate = body?.date;   // last banking day ≤ requested date
    if (typeof rate !== 'number' || !effectiveDate) return null;
    cache[key] = { rate, date: effectiveDate };
    saveCache();
    return { rate, effectiveDate };
  } catch {
    return null;
  }
}

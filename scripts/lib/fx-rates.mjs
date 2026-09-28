// Event-dated FX rates for tournament prize-money conversion (W1, 2026-07-04,
// Quellen erweitert 2026-09-28).
//
// Source: frankfurter.dev — keyless, history to 1999.
//   ECB basket (KRW/JPY/CNY/EUR/…) → v1 `/{date}?from=X&to=USD` (source 'ecb').
//   Not in the ECB basket → v2 with a FIXED central-bank provider, never the
//   blended default (reproducible, no weekend rates):
//     TWD, VND → CBC (Central Bank of the Republic of China, Taiwan)
//     RUB      → CBR (Bank of Russia)
//   Measured 2026-09-28: TWD/CBC 2023-09-24 = 32.122, VND/CBC 2024-03-06 = 24707.5,
//   RUB/CBR 2024-03-06 = 91.1604 (v2 answers "quote per 1 USD" → inverted here).
// ECB reference vs market rate differs <1%, irrelevant for prize display.
//
// Every resolved (currency, requested-date[, provider]) pair is cached in
// data/fx-rates.json and committed back to the repo (workflow commit-back), so
// re-runs are deterministic. Weekends/holidays: the API returns the last
// banking day — we store BOTH the requested date (cache key) and the effective
// date (fx_date in the DB).
//
// Future event dates (upcoming tournaments): the latest rate as a PROVISIONAL
// value (source '<src>:provisional'), never cached — the crawler re-converts
// such rows once the event is over (feedback_no_fake_values: labelled, not guessed).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = resolve(__dirname, '..', '..', 'data', 'fx-rates.json');
const HOST = 'https://api.frankfurter.dev';

// Outside the ECB basket → fixed v2 provider.
const V2_PROVIDER = { TWD: 'CBC', VND: 'CBC', RUB: 'CBR' };

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

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) return null;   // 404 = currency not covered for that date
  return res.json();
}

// → { rate: USD per 1 unit, effectiveDate } | null
async function fetchRate(cur, dateIso /* null = latest */) {
  const provider = V2_PROVIDER[cur];
  if (provider) {
    const q = `base=USD&quotes=${cur}&providers=${provider}${dateIso ? `&date=${dateIso}` : ''}`;
    const body = await getJson(`${HOST}/v2/rates?${q}`);
    const row = Array.isArray(body) ? body.find(r => r?.quote === cur) : null;
    if (!row || typeof row.rate !== 'number' || row.rate <= 0 || !row.date) return null;
    return { rate: 1 / row.rate, effectiveDate: row.date };
  }
  // Umgekehrt abfragen: from=KRW&to=USD kommt auf 5 Nachkommastellen gerundet
  // (KRW 0.0007 = 2 gueltige Stellen, bis ~0,7 % daneben); USD→KRW ist exakt.
  const body = await getJson(`${HOST}/v1/${dateIso || 'latest'}?from=USD&to=${cur}`);
  const inv = body?.rates?.[cur];
  if (typeof inv !== 'number' || inv <= 0 || !body?.date) return null;
  return { rate: 1 / inv, effectiveDate: body.date };
}

/**
 * USD rate for 1 unit of `currency` on `dateIso` (event date).
 * Returns { rate, effectiveDate, source } or null (unknown currency / API failure).
 * source: 'ecb' | 'cbc' | 'cbr' | 'usd', with ':provisional' for future dates.
 * Never throws; a failed lookup is the caller's cue to keep prize_usd NULL.
 */
export async function getUsdRate(currency, dateIso, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const cur = (currency || '').trim().toUpperCase();
  if (!cur || !dateIso) return null;
  if (cur === 'USD') return { rate: 1, effectiveDate: dateIso, source: 'usd' };
  const provider = V2_PROVIDER[cur];
  const src = provider ? provider.toLowerCase() : 'ecb';

  try {
    if (dateIso > today) {
      const r = await fetchRate(cur, null);
      return r ? { ...r, source: `${src}:provisional` } : null;
    }
    const cache = loadCache();
    // Quelle im Schluessel. Alte Schluessel ohne Quelle (`KRW:2020-08-23`) stammen
    // aus der gerundeten Abfrage und werden nicht mehr gelesen.
    const key = `${cur}:${dateIso}:${src}`;
    if (cache[key]) return { rate: cache[key].rate, effectiveDate: cache[key].date, source: src };
    const r = await fetchRate(cur, dateIso);
    if (!r) return null;
    cache[key] = { rate: r.rate, date: r.effectiveDate };
    saveCache();
    return { ...r, source: src };
  } catch {
    return null;
  }
}

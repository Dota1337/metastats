/**
 * Centralized Riot API client with rate-limiting.
 *
 * Replaces the per-script `rateLimitedFetch` helpers that were tuned for
 * the dev key (90 req / 2min ≈ 0.75 req/s). With the production key
 * (active since 2026-05-11) we run at 200 req/s sustained — that's ~4x
 * safety margin under Riot's long-window limit (500k req / 10min ≈ 833
 * req/s) and well below the short-window cap (30k req / 10s).
 *
 * Two surfaces are exposed:
 *   - fetch(url, init)                    → Response (drop-in for old helpers)
 *   - fetchJson(url, { safe = false })    → JSON, or { _status } / null when safe=true
 *
 * Behaviour:
 *   - Steady pacing: enforces minimum delay between requests (200/s = 5ms)
 *   - Burst safety: caps requests/10s window as a backstop for parallel surges
 *   - 429 handling: respects Retry-After header with 1s pad, then retries
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createRiotClient(opts = {}) {
  const {
    requestsPerSecond = 200,
    log = console.log,
  } = opts;

  const minDelayMs = Math.max(1, Math.floor(1000 / requestsPerSecond));
  const burstLimit = requestsPerSecond * 10; // 10s worth, safety backstop
  const burstWindowMs = 10_500;

  let requestCount = 0;
  let windowStart = Date.now();
  let lastRequestAt = 0;

  async function rateLimitedFetch(url, init) {
    // Window reset
    const now = Date.now();
    if (now - windowStart >= burstWindowMs) {
      requestCount = 0;
      windowStart = now;
    }

    // Burst-safety backstop (rarely triggers at 200/s, but catches parallel surges)
    if (requestCount >= burstLimit) {
      const wait = burstWindowMs - (Date.now() - windowStart);
      if (wait > 0) {
        log(`  [rate-limit] burst cap (${requestCount}) reached, waiting ${Math.ceil(wait / 1000)}s`);
        await sleep(wait);
      }
      requestCount = 0;
      windowStart = Date.now();
    }

    // Steady-pacing: enforce min delay between requests
    const sinceLast = Date.now() - lastRequestAt;
    if (sinceLast < minDelayMs) {
      await sleep(minDelayMs - sinceLast);
    }

    requestCount++;
    lastRequestAt = Date.now();

    const res = await fetch(url, init);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
      log(`  [429] Rate limited, waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000 + 1000);
      requestCount = 0;
      windowStart = Date.now();
      return rateLimitedFetch(url, init);
    }

    return res;
  }

  async function fetchJson(url, { safe = false } = {}) {
    let res;
    try {
      res = await rateLimitedFetch(url);
    } catch (e) {
      if (safe) return null;
      throw e;
    }
    if (!res.ok) {
      if (safe) return { _status: res.status };
      throw new Error(`${res.status} ${res.statusText}: ${url}`);
    }
    return res.json();
  }

  return { fetch: rateLimitedFetch, fetchJson };
}

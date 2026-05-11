/**
 * Centralized Riot API client with sliding-window rate-limiting.
 *
 * Defaults match what our actual key reports via `X-App-Rate-Limit`:
 *   short:  20 req / 1s  → we use 18 (10% safety)
 *   long:  100 req / 2min → we use 95 (5% safety)
 *
 * NOTE — 2026-05-11: Our key was expected to be a Production key but
 * still reports Dev-key limits. Until Riot upgrades the actual app
 * tier, both windows are needed to avoid the 115s `Retry-After` lockouts.
 *
 * Two surfaces:
 *   - fetch(url, init)                    → Response (drop-in for old helpers)
 *   - fetchJson(url, { safe = false })    → JSON, or { _status } / null when safe=true
 *
 * Behaviour:
 *   - Sliding-window check against BOTH short + long limits
 *   - 429 → respects Retry-After + clears windows + retries
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

export function createRiotClient(opts = {}) {
  const {
    shortWindowRequests = 18,
    shortWindowMs = 1100,           // 1s + 100ms slack
    longWindowRequests = 95,
    longWindowMs = 122_000,         // 120s + 2s slack
    log = console.log,
  } = opts;

  const shortWindow = [];
  const longWindow = [];

  async function rateLimitedFetch(url, init) {
    // Acquire a slot in both windows before firing
    while (true) {
      const now = Date.now();
      while (shortWindow.length && shortWindow[0] < now - shortWindowMs) shortWindow.shift();
      while (longWindow.length && longWindow[0] < now - longWindowMs) longWindow.shift();

      if (shortWindow.length < shortWindowRequests && longWindow.length < longWindowRequests) {
        shortWindow.push(now);
        longWindow.push(now);
        break;
      }

      const shortWait = shortWindow.length >= shortWindowRequests
        ? Math.max(0, shortWindow[0] + shortWindowMs - now) : 0;
      const longWait = longWindow.length >= longWindowRequests
        ? Math.max(0, longWindow[0] + longWindowMs - now) : 0;
      const wait = Math.max(shortWait, longWait, 50);

      if (wait > 5000) {
        log(`  [rate-limit] long-window cap, waiting ${Math.ceil(wait / 1000)}s`);
      }
      await sleep(wait);
    }

    const res = await fetch(url, init);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);
      log(`  [429] Rate limited, waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000 + 1000);
      // Reset windows after explicit 429 — Riot's internal counters
      // were ahead of ours, so the safest restart is from a clean slate.
      shortWindow.length = 0;
      longWindow.length = 0;
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

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
 *   - 429 → globale Sperre für ALLE Worker dieses Clients (Retry-After), dann Retry
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Transient network errors that warrant a retry. GitHub-hosted runners
// occasionally see `ENOTFOUND` for the regional Riot hostnames (e.g.
// th2/ph2.api.riotgames.com) for a few seconds — without a retry the whole
// workflow fails the first second of execution.
const TRANSIENT_NET_CODES = new Set([
  'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT',
]);

// Hard per-request timeout. Without it a single stuck socket hangs the whole
// crawler indefinitely — and because the crawls are systemd Type=oneshot,
// the unit then sits in "activating" forever (observed 2026-05-25 on stop).
// Treat a timeout like a transient net error: abort + retry, then give up.
const REQUEST_TIMEOUT_MS = 20_000;

async function fetchWithNetRetry(url, init, log, attempt = 0) {
  try {
    // Respect a caller-supplied signal if present; otherwise enforce our own.
    const signal = init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return await fetch(url, { ...init, signal });
  } catch (err) {
    const code = err?.cause?.code || err?.code || '';
    const isTimeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    if ((TRANSIENT_NET_CODES.has(code) || isTimeout) && attempt < 3) {
      const backoffMs = [2000, 5000, 10000][attempt];
      log(`  [net-retry] ${isTimeout ? 'request-timeout' : code} on ${url} — retry ${attempt + 1}/3 in ${Math.round(backoffMs / 1000)}s`);
      await sleep(backoffMs);
      return fetchWithNetRetry(url, init, log, attempt + 1);
    }
    throw err;
  }
}

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

  // Globale 429-Sperre für alle Worker DIESES Clients.
  //
  // Bis 2026-08-04 pausierte nur die Coroutine, die den 429 kassiert hatte —
  // die übrigen `concurrency - 1` Worker feuerten währenddessen weiter und
  // kassierten ihrerseits 429er. Das ist eine positive Rückkopplung, kein
  // Backoff: je höher die Concurrency, desto größer der Einschlag. Deshalb
  // hält jetzt ein gemeinsamer Zeitstempel alle Worker an.
  let penaltyUntil = 0;

  // Ein 429 darf nicht endlos im Kreis retryen. Nach MAX_429_RETRIES geben wir
  // die Response an den Caller zurück (safe:true sieht dann `{_status:429}`)
  // — mit einem lauten Log, weil ein stiller Verlust hier als "Spieler hatte
  // keine neuen Matches" durchgeht und nie wieder nachgeholt wird.
  const MAX_429_RETRIES = 5;

  async function rateLimitedFetch(url, init, retry429 = 0) {
    // Acquire a slot in both windows before firing
    while (true) {
      const now = Date.now();

      if (penaltyUntil > now) {
        await sleep(Math.min(penaltyUntil - now, 2000));
        continue;
      }

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

    const res = await fetchWithNetRetry(url, init, log);

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);

      if (retry429 >= MAX_429_RETRIES) {
        log(`  [429] AUFGEGEBEN nach ${MAX_429_RETRIES} Versuchen: ${url}`);
        return res;
      }

      // Sperre nur verlängern, nie verkürzen: parallele Worker, die im selben
      // Fenster einen 429 kassieren, dürfen die Sperre des ersten nicht kippen.
      const until = Date.now() + retryAfter * 1000 + 1000;
      if (until > penaltyUntil) {
        penaltyUntil = until;
        log(`  [429] Rate limited — alle Worker pausieren ${retryAfter}s`);
      }

      // Fenster bewusst NICHT leeren. Ein Reset machte den Client nach einem
      // Verstoß permissiver statt vorsichtiger: die nächsten N Requests gingen
      // sofort durch, während Riots Fenster noch voll war. Die echte Historie
      // stehen zu lassen ist die konservative Variante; sie altert von selbst
      // aus, und der Retry-After oben ist der eigentliche Backoff.
      return rateLimitedFetch(url, init, retry429 + 1);
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

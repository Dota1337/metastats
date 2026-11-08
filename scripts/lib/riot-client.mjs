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
 *   - Option `fill` (nur collect-lol-matches.mjs): freies Kontingent am Ende
 *     jedes Riot-Fensters auffuellen, siehe unten
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
      log(`  [net-retry] ${isTimeout ? 'request-timeout' : code} on ${redact(url)} — retry ${attempt + 1}/3 in ${Math.round(backoffMs / 1000)}s`);
      await sleep(backoffMs);
      return fetchWithNetRetry(url, init, log, attempt + 1);
    }
    throw err;
  }
}

// Ein Key, der jemals in einer URL stand, darf nicht ins Log. Der Client
// loggt URLs an drei Stellen (net-retry, 429-Aufgabe, fetchJson-Fehler) —
// journald auf der Box haelt die Zeilen wochenlang vor. Dasselbe gilt fuer
// Riot-Namen im Pfad der Konto-Abfrage (Companion-Daten, Datenschutz).
export function redact(url) {
  return String(url)
    .replace(/([?&]api_key=)[^&]*/g, '$1REDACTED')
    .replace(/(\/by-riot-id\/)[^/?]+\/[^/?]+/g, '$1…');
}

// Host einer Riot-URL (europe.api.riotgames.com, euw1.api.riotgames.com …).
// Riot zaehlt das App-Limit je Host. Regex statt new URL(): wirft nie.
const hostOf = (url) => (/^https?:\/\/([^/?#]+)/i.exec(String(url)) || [])[1] || '';

/** Zaehler des langen Fensters aus `x-app-rate-limit-count` („68:120,11:1" → 68), sonst null. */
export function longWindowCount(header, windowSec) {
  if (!header) return null;
  for (const part of String(header).split(',')) {
    const [n, w] = part.trim().split(':').map(Number);
    if (w === windowSec && Number.isInteger(n) && n >= 0) return n;
  }
  return null;
}

export function createRiotClient(opts = {}) {
  const {
    shortWindowRequests = 18,
    shortWindowMs = 1100,           // 1s + 100ms slack
    longWindowRequests = 95,
    longWindowMs = 122_000,         // 120s + 2s slack
    log = console.log,
    // Riot-Key. Wird als X-Riot-Token-Header mitgeschickt statt als
    // ?api_key= in der URL zu haengen — sonst steht er in jedem Log, das
    // eine URL zitiert (siehe redact() oben, das nur noch Altlasten faengt).
    //
    // Bewusst KEIN Default auf RIOT_API_KEY_TFT || RIOT_API_KEY: die
    // LoL-Skripte und die TFT-Skripte haben verschiedene Keys, und ein
    // Fallback wuerde stillschweigend den falschen mitschicken. Lieber laut.
    apiKey,
    // Freies Kontingent auffuellen (lolFillOptions in riot-limits.mjs). null = aus.
    fill = null,
    // Nur fuer Tests austauschbar.
    now = Date.now,
    sleep: pause = sleep,
  } = opts;

  if (!apiKey) {
    throw new Error('createRiotClient: apiKey fehlt — der Key geht als X-Riot-Token-Header raus und muss explizit uebergeben werden.');
  }

  const shortWindow = [];
  // Eintraege { t, host }. Ohne `fill` zaehlen alle Hosts zusammen (wie bisher),
  // mit `fill` je Host — so zaehlt Riot auch, und ein seltener euw1-Abruf muss
  // nicht warten, bis die europe-Abrufe aus dem gleitenden Fenster gefallen sind.
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

  // ------------------------------------------------------------------------
  // Auffuellen (08.11.2026, nur collect-lol-matches.mjs).
  //
  // Riots App-Fenster ist FEST, nicht gleitend: es beginnt mit der ersten
  // Anfrage und zaehlt 120 s lang alle Abrufe des Keys auf diesem Host, auch
  // die der Live-Seite (gemessen: Zaehler 69 → 1 in einem Schritt). Der Sammler
  // liest den Zaehler aus jeder Antwort und nimmt sich je Fenster:
  //   - bis `baseRequests` (35) sofort, wie bisher — es bleiben 65 fuer einen
  //     Besucher (ungecachte Spielerseite: bis 63),
  //   - erst in den letzten `endZoneMs` (8 s) bis `maxRequests` (85). Ein
  //     Besucher, der dann kommt, wartet hoechstens bis zum Fensterwechsel —
  //     die Live-Seite wiederholt 429 nach Retry-After (riot-fetch.ts).
  // Nur, wenn das Fenster sicher von uns eroeffnet wurde (Zaehler „1"), keine
  // eigene Anfrage offen ist, hoechstens `foreignMax` fremde Abrufe drin sind
  // und `quietMs` lang kein 429 und kein fremder Schub kam. Sonst gilt das
  // gleitende Fenster oben — der Rueckfall auf 35 greift also sofort.
  // ------------------------------------------------------------------------
  let fillCfg = fill || null;
  const hosts = new Map();
  const fillStats = { calls: 0, busy: 0 };

  function hostState(host) {
    let s = hosts.get(host);
    if (!s) {
      s = { start: null, own: 0, count: 0, inFlight: 0, overlap: false, quietUntil: 0, lastSentAt: 0 };
      hosts.set(host, s);
    }
    return s;
  }
  const forget = (s) => { s.start = null; s.own = 0; s.count = 0; };

  function fillAllows(s, t) {
    const c = fillCfg;
    if (!c || s.inFlight > 0 || t < s.quietUntil || s.count === 0) return false;
    if (s.start === null) return s.own < c.baseRequests;   // Beginn unbekannt: nur der Grundanteil
    const end = s.start + c.windowMs;
    // Fenster muesste vorbei sein: eine Probe je Sekunde, bis Riot den Wechsel zeigt.
    if (t >= end) return s.lastSentAt < end || t - s.lastSentAt >= 1000;
    if (s.own < c.baseRequests) return true;
    return t >= end - c.endZoneMs && s.count < c.maxRequests;
  }

  function goQuiet(s, host, t, why) {
    if (t >= s.quietUntil) {
      fillStats.busy++;
      log(`  [fill] ${why} auf ${host} — ${Math.round(fillCfg.quietMs / 60_000)} min nur ${longWindowRequests} je 2 min`);
    }
    s.quietUntil = t + fillCfg.quietMs;
  }

  function noteResponse(s, host, res, sentAt) {
    const c = fillCfg;
    if (!c) return;
    const t = now();
    // Mit parallelen Anfragen kommen Zaehler in falscher Reihenfolge an —
    // dann lieber gar nicht auffuellen als falsch zaehlen.
    if (s.overlap) { forget(s); if (s.inFlight === 0) s.overlap = false; return; }
    if (res.status === 429) { forget(s); goQuiet(s, host, t, '429'); return; }
    const n = longWindowCount(res.headers?.get?.('x-app-rate-limit-count'), c.windowMs / 1000);
    if (n === null) { forget(s); return; }
    // Gesendet deutlich nach dem erwarteten Ende: neues Fenster, auch wenn der
    // Zaehler hoeher ist als zuletzt (dann haben andere es eroeffnet). 1 s
    // Gnade, weil die erste Probe noch knapp im alten Fenster landen kann.
    const stale = s.start !== null && sentAt >= s.start + c.windowMs + 1000;
    if (s.count === 0 || n <= s.count || stale) {   // neues Fenster
      s.own = 1;
      s.start = n === 1 ? sentAt : null;        // sicher nur, wenn diese Anfrage es eroeffnet hat
    } else {
      s.own += 1;
    }
    s.count = n;
    const foreign = n - s.own;
    if (foreign > c.foreignMax) goQuiet(s, host, t, `${foreign} fremde Abrufe`);
  }

  async function rateLimitedFetch(url, init, retry429 = 0) {
    const host = hostOf(url);
    let st = null;
    let viaFill = false;
    // Acquire a slot in both windows before firing
    while (true) {
      const t = now();

      if (penaltyUntil > t) {
        await pause(Math.min(penaltyUntil - t, 2000));
        continue;
      }

      while (shortWindow.length && shortWindow[0] < t - shortWindowMs) shortWindow.shift();
      while (longWindow.length && longWindow[0].t < t - longWindowMs) longWindow.shift();

      st = fillCfg ? hostState(host) : null;
      const mine = st ? longWindow.filter(e => e.host === host) : longWindow;
      const shortOk = shortWindow.length < shortWindowRequests;
      const longOk = mine.length < longWindowRequests;
      viaFill = shortOk && !longOk && st !== null && fillAllows(st, t);

      if (shortOk && (longOk || viaFill)) {
        shortWindow.push(t);
        longWindow.push({ t, host });
        break;
      }

      const shortWait = !shortOk ? Math.max(0, shortWindow[0] + shortWindowMs - t) : 0;
      const longWait = !longOk ? Math.max(0, mine[0].t + longWindowMs - t) : 0;
      let wait = Math.max(shortWait, longWait, 50);

      if (st) {
        wait = Math.min(wait, 1000);              // Zone und Fensterwechsel nicht verschlafen
      } else if (wait > 5000) {
        log(`  [rate-limit] long-window cap, waiting ${Math.ceil(wait / 1000)}s`);
      }
      await pause(wait);
    }

    const sentAt = now();
    if (st) {
      if (st.inFlight > 0) st.overlap = true;
      st.inFlight++;
      st.lastSentAt = sentAt;
      if (viaFill) fillStats.calls++;
    }

    let res;
    try {
      res = await fetchWithNetRetry(
        url,
        { ...init, headers: { ...(init?.headers || {}), 'X-Riot-Token': apiKey } },
        log,
      );
    } catch (err) {
      // Ob Riot die Anfrage gezaehlt hat, ist unbekannt.
      if (st) { st.inFlight--; forget(st); }
      throw err;
    }
    if (st) {
      st.inFlight--;
      noteResponse(st, host, res, sentAt);
    }

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '10', 10);

      if (retry429 >= MAX_429_RETRIES) {
        log(`  [429] AUFGEGEBEN nach ${MAX_429_RETRIES} Versuchen: ${redact(url)}`);
        return res;
      }

      // Sperre nur verlängern, nie verkürzen: parallele Worker, die im selben
      // Fenster einen 429 kassieren, dürfen die Sperre des ersten nicht kippen.
      const until = now() + retryAfter * 1000 + 1000;
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
      throw new Error(`${res.status} ${res.statusText}: ${redact(url)}`);
    }
    return res.json();
  }

  /** Auffuellen an- oder abschalten (null = aus), ohne den Client neu zu bauen. */
  function setFill(cfg) {
    if (cfg && !fillCfg) hosts.clear();       // alter Zaehlerstand ist ungueltig
    fillCfg = cfg || null;
  }

  return { fetch: rateLimitedFetch, fetchJson, setFill, fillStats: () => ({ ...fillStats }) };
}

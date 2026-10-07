// Upsert in Paketen nach Supabase (PostgREST), mit Wiederholung bei
// voruebergehenden Fehlern und einer Frist fuer den ganzen Lauf.
//
// Anlass 05.–07.10.2026: metastats-marketvalue-sync scheiterte drei Abende in
// Folge um 19:15 UTC mit "The operation was aborted due to timeout" — ein
// einzelner langsamer POST (15 s, keine Wiederholung) kippte den ganzen Lauf.
// Der Upsert ist idempotent (on_conflict + merge-duplicates), ein Paket darf
// also gefahrlos erneut gesendet werden.

// 408/429/5xx plus Cloudflare-Codes vor Supabase (520 unbekannt, 522
// Verbindungs-Timeout, 524 Antwort-Timeout). 4xx sonst: Fehler im Paket,
// eine Wiederholung aendert nichts.
export const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524]);

const NET_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'EHOSTUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

export function isRetriable(err) {
  if (!err) return false;
  if (err.status != null) return RETRY_STATUS.has(err.status);
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = err.code || err.cause?.code;
  if (code && NET_CODES.has(String(code))) return true;
  // undici meldet Netzfehler als TypeError("fetch failed") mit Ursache in cause.
  return err instanceof TypeError && /fetch failed/i.test(err.message);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secs = (ms) => `${Math.round(ms / 1000)} s`;

/**
 * Schreibt rows in Paketen zu batchSize per POST nach `${url}/rest/v1/${table}`.
 * Wiederholt ein Paket bei Timeout/Netzfehler/RETRY_STATUS mit den Pausen aus
 * backoffMs; andere Fehler werfen sofort. Ist `deadline` (Epoch-ms) erreicht
 * oder reicht die naechste Pause nicht mehr, endet der Lauf mit
 * "Frist abgelaufen … X von Y Paketen".
 *
 * Fehlertexte beginnen weiter mit "Supabase upsert <table> failed: HTTP …",
 * damit Aufrufer bekannte Antworten (z. B. fehlende Tabelle) erkennen.
 */
export async function upsertBatches({
  url, key, table, rows, onConflict,
  batchSize = 200,
  timeoutMs = 30_000,
  backoffMs = [30_000, 60_000, 120_000],
  deadline = Infinity,
  log = console.log,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
}) {
  const total = Math.ceil(rows.length / batchSize);
  const endpoint = `${url}/rest/v1/${table}?on_conflict=${onConflict}`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };
  let retries = 0;

  for (let b = 0; b < total; b++) {
    const body = JSON.stringify(rows.slice(b * batchSize, (b + 1) * batchSize));
    for (let attempt = 0; ; attempt++) {
      if (now() >= deadline) {
        throw new Error(`Frist abgelaufen: ${table} ${b} von ${total} Paketen uebertragen`);
      }
      const t0 = now();
      try {
        const res = await fetchImpl(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(timeoutMs),
          headers,
          body,
        });
        if (!res.ok) {
          const text = await res.text();
          const err = new Error(`Supabase upsert ${table} failed: HTTP ${res.status} ${text.slice(0, 300)}`);
          err.status = res.status;
          throw err;
        }
        if (attempt > 0) log(`[${table}] Paket ${b + 1}/${total} angekommen im Versuch ${attempt + 1}`);
        break;
      } catch (err) {
        const reason = err.status != null ? `HTTP ${err.status}` : err.message;
        if (!isRetriable(err) || attempt >= backoffMs.length) {
          if (attempt === 0) throw err;
          throw new Error(`${err.message} (${table} Paket ${b + 1}/${total}, ${attempt + 1} Versuche)`, { cause: err });
        }
        const wait = backoffMs[attempt];
        if (now() + wait >= deadline) {
          throw new Error(`Frist abgelaufen: ${table} ${b} von ${total} Paketen uebertragen (zuletzt ${reason})`, { cause: err });
        }
        log(`[${table}] Paket ${b + 1}/${total}: ${reason} nach ${secs(now() - t0)} — Versuch ${attempt + 2} in ${secs(wait)}`);
        retries++;
        await sleep(wait);
      }
    }
  }
  return { batches: total, retries };
}

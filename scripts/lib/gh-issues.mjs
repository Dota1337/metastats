// Gemeinsamer Zugang zur GitHub-REST-API fuer die Melde-Skripte
// (contracts-alert.mjs, failure-watch.mjs, tft-data-refresh-report.mjs ueber
// lib/tft-cdragon-outage.mjs): Aufruf, Issues lesen, anlegen, Text aendern,
// schliessen ohne Kommentar, dem Besitzer zuweisen.
//
// Warum zugewiesen wird: ein Issue allein schickt keine Mail. GitHub
// benachrichtigt nur Zustaendige und Beobachter, und das Repo hat keine
// Beobachter. Erst die Zuweisung an den Besitzer loest genau eine Mail aus.
// Text aendern und Schliessen ohne Kommentar bleiben still.
//
// Keine Abhaengigkeiten, keine Umgebungsvariablen beim Import: das Modul wird
// ueber contracts-alert.mjs auch von refresh-api-server.mjs auf der Box geladen.

const API = 'https://api.github.com';

/** Besitzer aus "owner/repo". */
export const ownerOf = (repo) => String(repo).split('/')[0];

/** GitHub-Logins sind nicht case-sensitiv. */
export const sameLogin = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// Neue Versuche bei kurzer Stoerung (seit 24.11.2026). Bis dahin endete der
// Fehler-Melder fuenfmal rot: 18.11. viermal HTTP 502/503 beim Lesen, 24.11.
// einmal „fetch failed". Die Regel geht nach Methode:
// - Lesen und Setzen (GET, PATCH; jeder PATCH hier setzt feste Werte):
//   neuer Versuch bei Netzfehler, eigener Frist und HTTP 500/502/503/504.
// - POST (Issue, Kommentar, Label, Zuweisung, Rerun): nur, wenn die Anfrage
//   GitHub sicher nicht erreicht hat (Verbindung kam gar nicht zustande).
//   Nach Abbruch, Frist oder 5xx kann GitHub das Issue schon angelegt haben.
//   Ein zweites hiesse zweite Mail, und der Melder behielte das aeltere
//   (decide in lib/failure-watch.mjs), der Zwilling bliebe offen. Den unklaren
//   Fall klaert der naechste Lauf ueber den Zustand.
// Eigene Liste statt supabase-upsert/riot-client/source-down: keine davon
// trennt „nicht abgeschickt" von „abgeschickt, Antwort fehlt".
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ENETUNREACH', 'EHOSTUNREACH']);
const RETRY_STATUS = new Set([500, 502, 503, 504]);
const REPEATABLE = new Set(['GET', 'PATCH', 'PUT', 'DELETE']);

// fetch legt den Grund in err.cause; bei mehreren Adressen (IPv4/IPv6) als
// AggregateError mit errors[].
const netCode = (err) => {
  const c = err?.cause;
  return c?.code ?? c?.errors?.find((e) => e?.code)?.code ?? null;
};

/** Darf nach diesem Fehlschlag ({ status } oder { err }) ein neuer Versuch folgen? */
export function retryable(method, { status, err }) {
  const repeatable = REPEATABLE.has(method);
  if (status != null) return repeatable && RETRY_STATUS.has(status);
  const code = netCode(err);
  if (code && NOT_SENT.has(code)) return true;
  // Ohne Code (z. B. „bad port", kaputtes JSON) ist es kein Netzfehler.
  return repeatable && (err?.name === 'TimeoutError' || Boolean(code));
}

const reason = (err) => {
  if (err?.name === 'TimeoutError') return 'Zeitueberschreitung';
  const code = netCode(err);
  return `${err?.message || 'unbekannter Fehler'}${code ? ` (${code})` : ''}`;
};

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * gh(method, path, body?, opts?) — path relativ zu /repos/{repo}.
 * Wirft bei jedem Status ausser 2xx und opts.allow; der Token steht nie in der
 * Meldung. opts.text = Antwort als Text (Logs), sonst JSON; 204 = null.
 * Bei einem erlaubten Fehlerstatus kommt { status } zurueck (ohne neuen Versuch).
 *
 * Neue Versuche nach `retryable` mit den Pausen aus backoffMs ([] = keiner),
 * je Client hoechstens maxRetries (6 × (30 s Frist + 10 s Pause) ≈ 4 min, der
 * Melder-Job hat 10 min). Jeder Versuch schreibt eine Zeile ueber `log`.
 * Bei GET gehoert das Lesen der Antwort zum Versuch; ein POST mit 2xx wird nie
 * wiederholt, auch wenn das Lesen danach scheitert.
 */
export function makeGh({
  repo, token, fetchImpl = fetch, timeoutMs = 30_000,
  backoffMs = [3_000, 10_000], maxRetries = 6, sleep = defaultSleep, log = console.warn,
}) {
  let retriesLeft = maxRetries;
  return async function gh(method, path, body, { allow = [], text = false } = {}) {
    const what = `GitHub ${method} ${path}`;
    for (let attempt = 0; ; attempt++) {
      let failure;
      try {
        const res = await fetchImpl(`${API}/repos/${repo}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'metastats-melder',
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(timeoutMs), // je Versuch neu
        });
        if (res.ok) {
          if (res.status === 204) return null;
          if (!REPEATABLE.has(method)) return text ? res.text() : res.json();
          return await (text ? res.text() : res.json());
        }
        if (allow.includes(res.status)) return { status: res.status };
        failure = { status: res.status };
      } catch (err) {
        failure = { err };
      }
      const why = failure.status != null ? `HTTP ${failure.status}` : reason(failure.err);
      const pause = backoffMs[attempt];
      if (pause == null || retriesLeft <= 0 || !retryable(method, failure)) {
        throw failure.err ? new Error(`${what} → ${why}`, { cause: failure.err }) : new Error(`${what} → ${why}`);
      }
      retriesLeft--;
      log(`${what}: ${why}, neuer Versuch ${attempt + 2}/${backoffMs.length + 1} in ${Math.round(pause / 1000)} s`);
      await sleep(pause);
    }
  };
}

/** Issues mit Label (ohne Pull Requests), auf das Noetige gekuerzt. */
export async function listIssues(gh, { label, state = 'open', maxPages = 10 }) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const batch = await gh('GET', `/issues?labels=${encodeURIComponent(label)}&state=${state}&per_page=100&page=${page}`);
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return all.map((i) => ({
    number: i.number,
    state: i.state,
    title: i.title,
    body: i.body || '',
    assignees: (i.assignees ?? []).map((a) => a.login),
  }));
}

/** Label anlegen; 422 = gibt es schon. */
export function ensureLabel(gh, { name, color, description }) {
  return gh('POST', '/labels', { name, color, description }, { allow: [422] });
}

export function createIssue(gh, { title, body, labels = [] }) {
  return gh('POST', '/issues', { title, body, labels });
}

/** Nur der Text (und optional der Titel) — GitHub verschickt dafuer keine Mail. */
export function editIssue(gh, number, { body, title }) {
  return gh('PATCH', `/issues/${number}`, title ? { body, title } : { body });
}

/** Schliessen ohne Kommentar — keine Mail. */
export function closeIssue(gh, number) {
  return gh('PATCH', `/issues/${number}`, { state: 'closed', state_reason: 'completed' });
}

// Einziger Weg zur Zuweisung, immer NACH dem Anlegen. Wirft nie, damit eine
// Panne hier nicht die uebrigen Meldungen stoppt. GitHub verwirft eine
// Zuweisung ohne Rechte still, deshalb zaehlt nur, was die Antwort zeigt.
// Rueckgabe: null oder der Grund.
export async function assignOwner(gh, number, owner) {
  try {
    const issue = await gh('POST', `/issues/${number}/assignees`, { assignees: [owner] });
    const assigned = (issue?.assignees ?? []).some((a) => sameLogin(a?.login, owner));
    return assigned ? null : 'GitHub hat die Zuweisung verworfen';
  } catch (err) {
    return err?.message || 'unbekannter Fehler';
  }
}

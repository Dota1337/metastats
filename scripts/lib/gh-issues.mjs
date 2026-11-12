// Gemeinsamer Zugang zur GitHub-REST-API fuer die Melde-Skripte
// (contracts-alert.mjs, failure-watch.mjs): Aufruf, Issues lesen, anlegen,
// Text aendern, schliessen ohne Kommentar, dem Besitzer zuweisen.
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

/**
 * gh(method, path, body?, opts?) — path relativ zu /repos/{repo}.
 * Wirft bei jedem Status ausser 2xx und opts.allow; der Token steht nie in der
 * Meldung. opts.text = Antwort als Text (Logs), sonst JSON; 204 = null.
 * Bei einem erlaubten Fehlerstatus kommt { status } zurueck.
 */
export function makeGh({ repo, token, fetchImpl = fetch, timeoutMs = 30_000 }) {
  return async function gh(method, path, body, { allow = [], text = false } = {}) {
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
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      if (allow.includes(res.status)) return { status: res.status };
      throw new Error(`GitHub ${method} ${path} → HTTP ${res.status}`);
    }
    if (res.status === 204) return null;
    return text ? res.text() : res.json();
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

// Fehler-Melder fuer die GitHub-Actions-Laeufe — reine Entscheidungslogik,
// kein Netz, keine Dateien. Der Runner (scripts/failure-watch.mjs) holt den
// Zustand per REST und fuehrt die Operationen aus.
//
// Ziel (User 12.11.2026): nur noch Mails zu Fehlern, die sich nicht selbst
// geloest haben — genau eine Mail je Vorfall, kurze Aussetzer still. GitHub
// verschickt die eigenen „Run failed“-Mails dann nicht mehr (schaltet der User
// ab), dieser Melder ersetzt sie.
//
// Entschieden wird nach ZUSTAND, nicht nach Ereignis: je Workflow die
// juengsten abgeschlossenen Laeufe auf main. workflow_run weckt den Melder nur;
// verlorene Ereignisse (concurrency, Reruns mit GITHUB_TOKEN, Stoerungen)
// faengt der Abgleich alle 15 min auf.
//
// Regeln (Plan .claude/plan-current.md, Teil 2):
// - Ignoriert: cancelled/skipped/neutral/stale, nicht main, Ereignis
//   pull_request*, Forks, Dependabot (dynamic/), der Melder selbst.
// - Gruener Leerlauf (gate gruen, Hauptjob skipped) zaehlt weder rot noch gruen.
// - Schwelle je Workflow in der Workflow-Datei (env FAILURE_WATCH_AFTER, sonst 1):
//   so viele rote Laeufe in Folge, bevor gemeldet wird. startup_failure nie neu
//   starten und erst melden, wenn auch der naechste Lauf rot ist.
// - Wiederholung (Rerun) nur bei: Fehler in einem Vorbereitungsschritt vor jeder
//   Nebenwirkung (Set up job, checkout, setup-node, npm ci) mit Netz-Muster,
//   Versuch 1, kein offenes Issue, Lauf seit >= 10 min zu Ende, ALLE roten Jobs so.
// - Ein Issue je Ursache (Workflow; Riot-Schluessel: EIN Issue fuer alle),
//   dem Besitzer zugewiesen = 1 Mail. Neue Ursache: Text aendern, kein Kommentar.
//   Schliessen ohne Kommentar nach 2 echten gruenen Laeufen, neuer als der rote.
// - Issue-Text nur Workflow, Job, Schritt, Lauf-Link: keine Log-Zeilen (Repo ist
//   oeffentlich, Geheimnisse, @-Erwaehnungen).

import { sameLogin } from './gh-issues.mjs';

export const LABEL = 'lauf-rot';
export const SELF = 'failure-watch.yml';
export const DEFAULT_AFTER = 1;
export const MAX_AFTER = 5;
export const GREEN_TO_CLOSE = 2;
export const RERUN_MIN_AGE_MS = 10 * 60_000;
export const RIOT_KEY = 'riot-key';
const RIOT_ACTION = './.github/actions/riot-preflight';

const RED = new Set(['failure', 'timed_out', 'startup_failure']);
const JOB_RED = new Set(['failure', 'timed_out']);

// Die Zeile, die riot-preflight bei 401/403 ausgibt („::error::“ steht im Log als
// „##[error]“). Das Skript selbst steht ebenfalls im Log, dort aber mit „::error::“
// — deshalb nur die ausgegebene Form.
export const RIOT_PATTERN = /##\[error\]\s*Riot-Schluessel abgelaufen/;

// Netz-Aussetzer: 5xx, ETIMEDOUT, ECONNRESET, Gateway Time-out. 5xx nur mit
// Zusammenhang — eine nackte Zahl 5xx steht in jedem npm-Log („added 523 packages“).
export const NET_PATTERN = new RegExp([
  String.raw`\bETIMEDOUT\b`,
  String.raw`\bECONNRESET\b`,
  String.raw`Gateway Time-?out`,
  String.raw`\bHTTP(?:\/[\d.]+)?:?\s+5\d\d\b`,
  String.raw`status code(?: does not indicate success)?:?\s*5\d\d\b`,
  String.raw`returned error:?\s*5\d\d\b`,
  String.raw`Unexpected HTTP response:?\s*5\d\d\b`,
  String.raw`\b5\d\d (?:Internal Server Error|Bad Gateway|Service Unavailable)\b`,
  String.raw`\bE5\d\d\b`,
].join('|'), 'i');

// ---- Workflow-Datei lesen (Regex, keine YAML-Bibliothek) -------------------

const unquote = (s) => String(s ?? '').trim().replace(/^(['"])(.*)\1$/, '$2');

/**
 * Schritte je Job: [{ job, steps: [{ name, uses, run }] }]. name ist der Name,
 * den GitHub in der Jobs-API zeigt: `name:`, sonst „Run <uses>“ bzw.
 * „Run <erste Befehlszeile>“.
 */
export function workflowJobs(yml) {
  const lines = String(yml).split(/\r?\n/);
  const indent = (l) => l.match(/^ */)[0].length;
  const jobs = [];
  let i = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (i < 0) return jobs;
  for (i++; i < lines.length; i++) {
    const l = lines[i];
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (indent(l) === 0) break;
    const jm = /^ {2}([\w-]+):\s*$/.exec(l);
    if (jm) jobs.push({ job: jm[1], lines: [] });
    else if (jobs.length) jobs.at(-1).lines.push(l);
  }
  return jobs.map(({ job, lines: body }) => ({ job, steps: stepsOf(body) }));
}

function stepsOf(body) {
  const indent = (l) => l.match(/^ */)[0].length;
  const at = body.findIndex((l) => /^\s*steps:\s*$/.test(l));
  if (at < 0) return [];
  const base = indent(body[at]);
  const items = [];
  let itemIndent = -1;
  for (const l of body.slice(at + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    if (indent(l) <= base) break;
    const m = /^(\s*)-\s+(.*)$/.exec(l);
    if (m && (itemIndent < 0 || m[1].length === itemIndent)) {
      itemIndent = m[1].length;
      items.push([`${' '.repeat(itemIndent + 2)}${m[2]}`]);
    } else if (items.length) items.at(-1).push(l);
  }
  return items.map((item) => {
    const key = itemIndent + 2;
    const get = (k) => {
      const idx = item.findIndex((l) => indent(l) === key && new RegExp(`^\\s*${k}:`).test(l));
      if (idx < 0) return null;
      const v = item[idx].replace(new RegExp(`^\\s*${k}:\\s*`), '');
      if (/^[|>][-+]?\s*$/.test(v)) {
        const next = item.slice(idx + 1).find((l) => l.trim() && indent(l) > key);
        return next ? next.trim() : '';
      }
      return unquote(v);
    };
    const name = get('name');
    const uses = get('uses');
    const run = get('run');
    return { name: name || (uses ? `Run ${uses}` : `Run ${run ?? ''}`), uses, run };
  });
}

const isPrepStep = (s) => /^actions\/(?:checkout|setup-node)@/.test(s.uses ?? '') || /^npm ci\b/.test(s.run ?? '');

/**
 * Was der Melder aus der Workflow-Datei braucht:
 * - after: Schwelle (env FAILURE_WATCH_AFTER, sonst 1)
 * - idleCapable: hat einen gate-Job, ein gruener Lauf kann also Leerlauf sein
 * - prepSteps: Vorbereitungsschritte, die vor jeder Nebenwirkung laufen
 *   (nur am Anfang eines Jobs; dazwischen nur die lesende Riot-Pruefung)
 * - riotSteps: Schritte, die riot-preflight aufrufen
 */
export function workflowMeta(yml) {
  const m = /^\s*FAILURE_WATCH_AFTER:\s*['"]?([^'"\s#]+)['"]?\s*(?:#.*)?$/m.exec(String(yml));
  let after = DEFAULT_AFTER;
  if (m) {
    after = Number(m[1]);
    if (!Number.isInteger(after) || after < 1 || after > MAX_AFTER) {
      throw new Error(`FAILURE_WATCH_AFTER ungueltig: ${m[1]} (erlaubt 1 bis ${MAX_AFTER})`);
    }
  }
  const jobs = workflowJobs(yml);
  const prep = new Set(['Set up job']);
  const riot = new Set();
  for (const { steps } of jobs) {
    let prefix = true;
    for (const s of steps) {
      const isRiot = s.uses === RIOT_ACTION;
      if (isRiot) riot.add(s.name);
      if (prefix && isPrepStep(s)) prep.add(s.name);
      else if (!isRiot) prefix = false;
    }
  }
  return {
    after,
    idleCapable: jobs.some((j) => j.job === 'gate'),
    prepSteps: [...prep],
    riotSteps: [...riot],
  };
}

// ---- Laeufe einordnen ------------------------------------------------------

const newestFirst = (a, b) => (Date.parse(b.createdAt) - Date.parse(a.createdAt)) || (b.id - a.id);

function onMain(run, repo) {
  const event = String(run.event ?? '');
  return run.branch === 'main'
    && !event.startsWith('pull_request')
    && event !== 'dynamic'
    && (run.headRepo == null || run.headRepo === repo);
}

/** Abgeschlossene, zaehlende Laeufe auf main, neueste zuerst. */
export function relevantRuns(wf, repo) {
  return (wf.runs ?? [])
    .filter((r) => onMain(r, repo) && r.status === 'completed' && (r.conclusion === 'success' || RED.has(r.conclusion)))
    .sort(newestFirst);
}

/** Gruen, aber nur das gate lief (Hauptjob skipped) — hat nichts geprueft. */
export function isIdle(run) {
  if (run.conclusion !== 'success' || !Array.isArray(run.jobs)) return false;
  const ran = run.jobs.filter((j) => j.conclusion !== 'skipped');
  return run.jobs.length > ran.length && ran.every((j) => j.name === 'gate');
}

export const redJobs = (run) => (run.jobs ?? []).filter((j) => JOB_RED.has(j.conclusion));

/** Erster rote Schritt eines Jobs; beim Zeitlimit der abgebrochene. */
export function failedStep(job) {
  const steps = [...(job.steps ?? [])].sort((a, b) => a.number - b.number);
  return steps.find((s) => s.conclusion === 'failure')
    ?? (job.conclusion === 'timed_out' ? steps.find((s) => s.conclusion === 'cancelled') : undefined)
    ?? null;
}

// Laeuft gerade ein Rerun (Versuch > 1 noch nicht fertig), fehlt sein roter
// Vorgaenger in der Liste der abgeschlossenen Laeufe. Dann nichts entscheiden.
const rerunning = (wf, repo) => (wf.runs ?? []).some((r) => onMain(r, repo) && r.status !== 'completed' && r.attempt > 1);

/**
 * Laeuft die Laeufe ab, neueste zuerst:
 * - top 'red': reds = rote Laeufe in Folge (Leerlaeufe uebersprungen)
 * - top 'green': greens = echte gruene Laeufe in Folge
 * need = Daten, die der Runner noch holen muss ({kind:'jobs', run} oder
 * {kind:'log', run, job}), sonst null. Geholt wird nur, was die Entscheidung
 * braucht: Jobs gruener Laeufe nur bei Workflows mit gate, Jobs nur des
 * neuesten roten Laufs, Logs nur fuer rote Vorbereitungs- oder Riot-Schritte.
 */
export function scan(wf, repo) {
  if (rerunning(wf, repo)) return { busy: true, top: 'none', reds: [], greens: [], need: null };
  const res = { busy: false, top: 'none', reds: [], greens: [], need: null };
  const want = Math.max(wf.after ?? DEFAULT_AFTER, 2);
  for (const run of relevantRuns(wf, repo)) {
    if (run.conclusion === 'success') {
      if (wf.idleCapable && !run.jobs) return { ...res, need: { kind: 'jobs', run } };
      if (isIdle(run)) continue;
      if (res.top === 'red') break;
      res.top = 'green';
      res.greens.push(run);
      if (res.greens.length >= GREEN_TO_CLOSE) break;
    } else {
      if (res.top === 'green') break;
      res.top = 'red';
      res.reds.push(run);
      if (res.reds.length >= want) { res.capped = true; break; } // mehr braucht keine Regel
    }
  }
  if (res.top === 'red') {
    const newest = res.reds[0];
    if (!newest.jobs) return { ...res, need: { kind: 'jobs', run: newest } };
    for (const job of redJobs(newest)) {
      const step = failedStep(job);
      const wanted = step && ((wf.prepSteps ?? []).includes(step.name) || (wf.riotSteps ?? []).includes(step.name));
      if (wanted && job.log === undefined) return { ...res, need: { kind: 'log', run: newest, job } };
    }
  }
  return res;
}

export const nextNeed = (wf, repo) => scan(wf, repo).need;

/** Riot-Schluessel abgelehnt: die Riot-Pruefung ist der rote Schritt und ihr Log sagt es. */
export function isRiotRun(run, wf) {
  return redJobs(run).some((job) => {
    const step = failedStep(job);
    return step && (wf.riotSteps ?? []).includes(step.name) && RIOT_PATTERN.test(job.log ?? '');
  });
}

/** null = kein Rerun-Fall; sonst { ready } (ready = Lauf seit >= 10 min zu Ende). */
export function rerunCheck(run, wf, now) {
  if (run.conclusion !== 'failure' || run.attempt !== 1) return null;
  const jobs = redJobs(run);
  if (!jobs.length) return null;
  for (const job of jobs) {
    if (job.conclusion !== 'failure') return null;
    const step = failedStep(job);
    if (!step || !(wf.prepSteps ?? []).includes(step.name)) return null;
    if (!NET_PATTERN.test(job.log ?? '')) return null;
  }
  return { ready: now - Date.parse(run.updatedAt) >= RERUN_MIN_AGE_MS };
}

// ---- Issue-Text ------------------------------------------------------------

// Namen kommen aus den Workflow-Dateien, trotzdem nie roh in den Text: kein
// @ (Erwaehnung), keine Backticks, kein < > (Marker), kein Zeilenumbruch.
export const clean = (s) => String(s ?? '').replace(/[@`<>\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);

// Matrix-Jobs („crawl (euw1)“) zaehlen als ein Job, sonst waere jede andere
// Region eine neue Ursache.
const jobKey = (name) => clean(name).replace(/\s*\([^)]*\)\s*$/, '');

/** Ursache eines roten Laufs als Text: „Job › Schritt“, sortiert. */
export function signature(run) {
  if (run.conclusion === 'startup_failure') return 'Workflow startet nicht (startup_failure)';
  const parts = redJobs(run).map((job) => {
    const step = failedStep(job);
    return `${jobKey(job.name)} › ${step ? clean(step.name) : 'ohne Schritt'}${job.conclusion === 'timed_out' ? ' (Zeitlimit)' : ''}`;
  });
  return [...new Set(parts)].sort().join('; ') || 'ohne roten Job';
}

const MARK = /<!-- ms-failure (\{.*?\}) -->/;
export function parseMarker(body) {
  const m = MARK.exec(body || '');
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}
export function withMarker(text, state) {
  return `${text}\n\n<!-- ms-failure ${JSON.stringify(state)} -->`;
}

const runUrl = (repo, run) => `https://github.com/${repo}/actions/runs/${run.id}`;
const runLine = (repo, run) => `${runUrl(repo, run)} (Versuch ${run.attempt ?? 1})`;
const CLOSE_HINT = `Schliesst sich selbst nach ${GREEN_TO_CLOSE} gruenen Laeufen. Log-Zeilen stehen bewusst nicht hier (oeffentliches Repo), nur im Lauf.`;

function wfIssue(repo, f) {
  const rows = signature(f.run).split('; ').map((s) => `- Rot: ${s}`);
  return {
    title: `[Lauf rot] ${clean(f.wf.name)}`,
    text: [
      `Der Workflow ${clean(f.wf.name)} (${clean(f.wf.file)}) ist rot.`,
      '',
      `- Lauf: ${runLine(repo, f.run)}`,
      ...rows,
      `- Rote Laeufe in Folge: ${f.capped ? 'mindestens ' : ''}${f.streak}`,
      '',
      CLOSE_HINT,
    ].join('\n'),
  };
}

function riotIssue(repo, list) {
  const rows = [...list]
    .sort((a, b) => a.wf.file.localeCompare(b.wf.file))
    .map((f) => `- ${clean(f.wf.name)}: ${runLine(repo, f.run)}`);
  return {
    title: '[Lauf rot] Riot-Schluessel abgelaufen',
    text: [
      'Die Vorabpruefung des Riot-Schluessels (riot-preflight) ist rot: Riot lehnt den Schluessel ab (HTTP 401/403). Die Crawls brechen vor dem Start ab.',
      '',
      ...rows,
      '',
      `Schliesst sich selbst nach ${GREEN_TO_CLOSE} gruenen Laeufen der betroffenen Workflows. Log-Zeilen stehen bewusst nicht hier (oeffentliches Repo), nur im Lauf.`,
    ].join('\n'),
  };
}

// ---- Entscheidung ----------------------------------------------------------

/**
 * input: { repo, now, owner, workflows: [{file, name, after, idleCapable,
 *          prepSteps, riotSteps, runs}], issues: [{number, state, title, body,
 *          assignees}] } — issues = offene Issues mit Label LABEL.
 * Rueckgabe: Operationen
 *   { op:'rerun', runId, file }
 *   { op:'create', key, title, body }        (Runner weist danach zu)
 *   { op:'editBody', number, body }
 *   { op:'close', number }
 *   { op:'assign', number }                  (Zuweisung fehlt noch)
 */
export function decide({ repo, now, owner, workflows, issues }) {
  const ops = [];
  const byKey = new Map();
  for (const i of [...issues].sort((a, b) => a.number - b.number)) {
    const st = parseMarker(i.body);
    if (i.state !== 'open' || !st?.key || byKey.has(st.key)) continue; // aeltestes offenes gewinnt
    byKey.set(st.key, { issue: i, st });
  }

  const watched = workflows.filter((w) => w.file !== SELF && !String(w.file).startsWith('dynamic/'));
  const scans = new Map();
  const findings = new Map(); // key -> [{ wf, run, streak }]
  for (const wf of watched) {
    const s = scan(wf, repo);
    if (s.need) throw new Error(`Zustand unvollstaendig fuer ${wf.file}: ${s.need.kind} von Lauf ${s.need.run.id} fehlt`);
    scans.set(wf.file, s);
    if (s.busy || s.top !== 'red') continue;

    const newest = s.reds[0];
    const key = isRiotRun(newest, wf) ? RIOT_KEY : `wf:${wf.file}`;
    if (!byKey.has(`wf:${wf.file}`) && !byKey.has(key)) {
      const rerun = rerunCheck(newest, wf, now);
      if (rerun) {
        if (rerun.ready) ops.push({ op: 'rerun', runId: newest.id, file: wf.file });
        continue; // Aussetzer: wiederholen statt melden (oder noch warten)
      }
    }
    const after = newest.conclusion === 'startup_failure' ? Math.max(wf.after ?? DEFAULT_AFTER, 2) : (wf.after ?? DEFAULT_AFTER);
    if (s.reds.length < after) continue;
    if (!findings.has(key)) findings.set(key, []);
    findings.get(key).push({ wf, run: newest, streak: s.reds.length, capped: Boolean(s.capped) });
  }

  for (const [key, list] of findings) {
    const { title, text } = key === RIOT_KEY ? riotIssue(repo, list) : wfIssue(repo, list[0]);
    const sig = key === RIOT_KEY ? 'riot' : signature(list[0].run);
    const newest = [...list].map((f) => f.run).sort(newestFirst)[0];
    const st = { key, sig, since: newest.createdAt, run: newest.id };
    const hit = byKey.get(key);
    if (!hit) ops.push({ op: 'create', key, title, body: withMarker(text, st) });
    else if (hit.st.sig !== sig) ops.push({ op: 'editBody', number: hit.issue.number, body: withMarker(text, st) });
    // gleiche Ursache: nichts, auch kein neuer Lauf-Link
  }

  const closing = new Set();
  const newer = (since) => (r) => !(Date.parse(r.createdAt) <= Date.parse(since));
  for (const [key, { issue, st }] of byKey) {
    if (findings.has(key)) continue;
    if (key.startsWith('wf:')) {
      const file = key.slice(3);
      const s = scans.get(file);
      if (!s) {
        // Workflow gibt es nicht mehr (geloescht oder abgeschaltet)
        if (!workflows.some((w) => w.file === file)) { ops.push({ op: 'close', number: issue.number }); closing.add(issue.number); }
        continue;
      }
      if (s.busy || s.top !== 'green') continue;
      if (s.greens.filter(newer(st.since)).length >= GREEN_TO_CLOSE) { ops.push({ op: 'close', number: issue.number }); closing.add(issue.number); }
    } else if (key === RIOT_KEY) {
      const riotWfs = watched.filter((w) => (w.riotSteps ?? []).length);
      if (riotWfs.some((w) => scans.get(w.file)?.busy)) continue;
      const greens = riotWfs.flatMap((w) => (scans.get(w.file)?.top === 'green' ? scans.get(w.file).greens : []));
      if (greens.filter(newer(st.since)).length >= GREEN_TO_CLOSE) { ops.push({ op: 'close', number: issue.number }); closing.add(issue.number); }
    }
  }

  // Zuweisung nachholen (z. B. wenn sie beim Anlegen scheiterte)
  for (const { issue } of byKey.values()) {
    if (closing.has(issue.number)) continue;
    if (!(issue.assignees ?? []).some((login) => sameLogin(login, owner))) {
      ops.push({ op: 'assign', number: issue.number });
    }
  }
  return ops;
}

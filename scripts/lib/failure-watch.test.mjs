// Fehler-Melder (scripts/lib/failure-watch.mjs): je Regel aus dem Plan
// (.claude/plan-current.md, Teil 2) mindestens ein Fall. Die Workflow-Angaben
// (Schwelle, Vorbereitungs- und Riot-Schritte, gate) kommen aus den echten
// Workflow-Dateien, die Schrittnamen sind die der Jobs-API (gemessen
// 12.11.2026 an den Laeufen 42345778995, 43165063906, 43211103233).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decide, scan, nextNeed, workflowMeta, workflowJobs, parseMarker, withMarker, signature,
  RIOT_KEY, SELF, LABEL, NET_PATTERN, RIOT_PATTERN, RERUN_MIN_AGE_MS,
} from './failure-watch.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = 'Dota1337/metastats';
const OWNER = 'Dota1337';
const NOW = Date.parse('2026-11-12T14:00:00Z');

let seq = 1000;
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
/** Lauf, der vor `min` Minuten zu Ende ging (5 min Laufzeit). */
function run(conclusion, min, { jobs, attempt = 1, event = 'workflow_dispatch', branch = 'main', headRepo = REPO, status = 'completed' } = {}) {
  seq += 1;
  return { id: seq, attempt, event, branch, headRepo, status, conclusion, createdAt: ago(min + 5), updatedAt: ago(min), jobs };
}
/** Job mit Schritten [[name, conclusion], ...]; log undefined = noch nicht geholt. */
function job(name, conclusion, steps, log) {
  seq += 1;
  const j = { id: seq, name, conclusion, steps: steps.map(([n, c], i) => ({ name: n, number: i + 1, conclusion: c })) };
  if (log !== undefined) j.log = log;
  return j;
}
const meta = (file) => workflowMeta(readFileSync(join(ROOT, '.github', 'workflows', file), 'utf8'));
const wf = (file, name, runs) => ({ file, name, ...meta(file), runs });
const go = (workflows, issues = []) => decide({ repo: REPO, now: NOW, owner: OWNER, workflows, issues });
const kinds = (ops) => ops.map((o) => o.op);

// Weekly Data Crawl (EUW): kein gate, Schwelle 1, Vorbereitung „Checkout repository“ usw.
const CRAWL = 'crawl-and-deploy';
const NET_LOG = '2026-11-12T10:00:01.0000000Z ##[error]fatal: unable to access \'https://github.com/x/y/\': The requested URL returned error: 502';
const prepFail = (log = NET_LOG) => job(CRAWL, 'failure', [['Set up job', 'success'], ['Checkout repository', 'failure']], log);
const crawlFail = (step = 'Crawl') => job(CRAWL, 'failure', [['Set up job', 'success'], ['Checkout repository', 'success'], ['Install dependencies', 'success'], [step, 'failure']]);
const green = () => job(CRAWL, 'success', [['Set up job', 'success'], ['Crawl', 'success']]);
const euw = (runs) => wf('weekly-crawl.yml', 'Weekly Data Crawl (EUW)', runs);

// Issue so, wie decide es anlegen wuerde (Text + Marker), offen und zugewiesen.
function issueFrom(op, number, assignees = [OWNER]) {
  return { number, state: 'open', title: op.title, body: op.body, assignees };
}

// ---- Workflow-Dateien lesen -------------------------------------------------

test('Schwelle steht in der Workflow-Datei: data-refresh und icon-mirror 2, sonst 1', () => {
  assert.equal(meta('tft-data-refresh.yml').after, 2);
  assert.equal(meta('tft-icon-mirror.yml').after, 2);
  assert.equal(meta('weekly-crawl.yml').after, 1);
  assert.equal(meta('ci.yml').after, 1);
  assert.throws(() => workflowMeta('env:\n  FAILURE_WATCH_AFTER: 0\njobs:\n'), /ungueltig/);
  assert.throws(() => workflowMeta('env:\n  FAILURE_WATCH_AFTER: zwei\njobs:\n'), /ungueltig/);
});

test('Schrittnamen wie in der Jobs-API, Vorbereitung nur vor jeder Nebenwirkung', () => {
  const euwMeta = meta('weekly-crawl.yml');
  for (const s of ['Set up job', 'Checkout repository', 'Setup Node.js', 'Install dependencies']) assert.ok(euwMeta.prepSteps.includes(s), s);
  // data-refresh: npm ci steht hinter zwei anderen Schritten — kein Rerun-Kandidat
  const dr = meta('tft-data-refresh.yml');
  assert.ok(dr.prepSteps.includes('Run actions/checkout@v7'));
  assert.ok(!dr.prepSteps.includes('Abhaengigkeiten'));
  assert.ok(!dr.prepSteps.includes('Commit'));
  assert.equal(dr.idleCapable, true);
  // Riot-Pruefung zwischen checkout und setup-node unterbricht die Vorbereitung nicht
  const tw = meta('tft-weekly-crawl.yml');
  assert.deepEqual(tw.riotSteps, ['Riot TFT key pre-flight']);
  assert.ok(tw.prepSteps.includes('Install dependencies'));
  assert.ok(!tw.prepSteps.includes('Riot TFT key pre-flight'));
  // unbenannter run-Schritt: „Run <erste Zeile>“ (API: „Run run=true“ im gate)
  const gate = workflowJobs(readFileSync(join(ROOT, '.github/workflows/tft-data-refresh.yml'), 'utf8')).find((j) => j.job === 'gate');
  assert.equal(gate.steps[0].name, 'Run run=true');
});

// ---- Rerun --------------------------------------------------------------------

test('Uebergangsfehler in der Vorbereitung: genau ein Rerun, kein Issue', () => {
  const red = run('failure', 15, { jobs: [prepFail()] });
  const ops = go([euw([red, run('success', 600)])]);
  assert.deepEqual(ops, [{ op: 'rerun', runId: red.id, file: 'weekly-crawl.yml' }]);
});

test('Rerun erst, wenn der Lauf 10 min vorbei ist — vorher nichts, auch kein Issue', () => {
  const red = run('failure', 3, { jobs: [prepFail()] });
  assert.ok(3 * 60_000 < RERUN_MIN_AGE_MS);
  assert.deepEqual(go([euw([red])]), []);
});

test('zweiter Versuch rot: Issue statt neuem Rerun', () => {
  const red = run('failure', 15, { jobs: [prepFail()], attempt: 2 });
  const ops = go([euw([red])]);
  assert.deepEqual(kinds(ops), ['create']);
  assert.equal(ops[0].title, '[Lauf rot] Weekly Data Crawl (EUW)');
});

test('kein Rerun: Crawl-Schritt, ohne Netz-Muster, offenes Issue, ein Job nicht so, Zeitlimit', () => {
  const crawlNet = job(CRAWL, 'failure', [['Set up job', 'success'], ['Crawl', 'failure']], NET_LOG);
  assert.deepEqual(kinds(go([euw([run('failure', 15, { jobs: [crawlNet] })])])), ['create']);
  assert.deepEqual(kinds(go([euw([run('failure', 15, { jobs: [prepFail('npm error code ERESOLVE')] })])])), ['create']);
  // ALLE roten Jobs muessen Vorbereitungs-Aussetzer sein
  const mixed = run('failure', 15, { jobs: [prepFail(), job('andere', 'failure', [['Commit data updates', 'failure']])] });
  assert.deepEqual(kinds(go([euw([mixed])])), ['create']);
  const timedOut = run('timed_out', 15, { jobs: [job(CRAWL, 'timed_out', [['Checkout repository', 'cancelled']], NET_LOG)] });
  assert.deepEqual(kinds(go([euw([timedOut])])), ['create']);
  // offenes Issue zum Workflow: nicht mehr wiederholen
  const first = go([euw([run('failure', 900, { jobs: [crawlFail()] })])]);
  const open = issueFrom(first[0], 50);
  const ops = go([euw([run('failure', 15, { jobs: [prepFail()] })])], [open]);
  assert.ok(!ops.some((o) => o.op === 'rerun'));
});

test('startup_failure: nie Rerun, erst beim zweiten roten Lauf melden', () => {
  const first = run('startup_failure', 15, { jobs: [] });
  assert.deepEqual(go([euw([first])]), []);
  const second = run('startup_failure', 5, { jobs: [] });
  const ops = go([euw([second, first])]);
  assert.deepEqual(kinds(ops), ['create']);
  assert.match(ops[0].body, /startup_failure/);
});

// ---- Ein Issue je Vorfall -------------------------------------------------------

test('Dauerfehler: genau ein Issue, naechster roter Lauf derselben Ursache = keine Operation', () => {
  const r1 = run('failure', 300, { jobs: [crawlFail()] });
  const ops = go([euw([r1])]);
  assert.deepEqual(kinds(ops), ['create']);
  assert.equal(parseMarker(ops[0].body).key, 'wf:weekly-crawl.yml');
  const open = issueFrom(ops[0], 61);
  const r2 = run('failure', 20, { jobs: [crawlFail()] });
  assert.deepEqual(go([euw([r2, r1])], [open]), []);
});

test('neue Ursache: Text aendern, kein Kommentar, keine neue Mail', () => {
  const r1 = run('failure', 300, { jobs: [crawlFail('Crawl')] });
  const open = issueFrom(go([euw([r1])])[0], 62);
  const r2 = run('failure', 20, { jobs: [crawlFail('Commit data updates')] });
  const ops = go([euw([r2, r1])], [open]);
  assert.deepEqual(kinds(ops), ['editBody']);
  assert.equal(ops[0].number, 62);
  assert.match(ops[0].body, /Commit data updates/);
  assert.equal(parseMarker(ops[0].body).run, r2.id);
});

test('gruener Leerlauf (gate gruen, Hauptjob skipped) schliesst nicht und unterbricht keine Serie', () => {
  const dr = (runs) => wf('tft-data-refresh.yml', 'TFT Data Refresh', runs);
  const idle = (min) => run('success', min, { event: 'schedule', jobs: [job('gate', 'success', [['Run run=true', 'success']]), job('refresh', 'skipped', [])] });
  const redRun = (min) => run('failure', min, { jobs: [job('gate', 'success', []), job('refresh', 'failure', [['Daten-Bundle', 'failure']])] });
  const realGreen = (min) => run('success', min, { jobs: [job('gate', 'success', []), job('refresh', 'success', [])] });
  const r1 = redRun(400);
  const r2 = redRun(200);
  // Schwelle 2: rot, Leerlauf, rot = zwei in Folge
  const ops = go([dr([idle(100), r2, idle(300), r1, realGreen(900)])]);
  assert.deepEqual(kinds(ops), ['create']);
  const open = issueFrom(ops[0], 70);
  // nur Leerlaeufe danach: bleibt offen
  assert.deepEqual(go([dr([idle(10), idle(40), idle(70), r2, r1])], [open]), []);
});

test('zwei echte gruene Laeufe neuer als der rote schliessen still, einer nicht', () => {
  const r1 = run('failure', 300, { jobs: [crawlFail()] });
  const open = issueFrom(go([euw([r1])])[0], 63);
  assert.deepEqual(go([euw([run('success', 100, { jobs: [green()] }), r1])], [open]), []);
  const ops = go([euw([run('success', 20, { jobs: [green()] }), run('success', 100, { jobs: [green()] }), r1])], [open]);
  assert.deepEqual(ops, [{ op: 'close', number: 63 }]);
});

test('gruene Laeufe aelter als der rote zaehlen nicht (Rerun des roten laeuft gerade)', () => {
  const r1 = run('failure', 30, { jobs: [crawlFail()] });
  const open = issueFrom(go([euw([r1])])[0], 64);
  const g1 = run('success', 200, { jobs: [green()] });
  const g2 = run('success', 300, { jobs: [green()] });
  // Rerun von r1 laeuft: r1 fehlt in den abgeschlossenen — nichts entscheiden
  const rerunning = { ...r1, status: 'in_progress', conclusion: null, attempt: 2 };
  assert.deepEqual(go([euw([rerunning, g1, g2])], [open]), []);
  // waehrend des Reruns auch keine Meldung zu einem aelteren roten Lauf
  assert.deepEqual(go([euw([rerunning, run('failure', 400, { jobs: [crawlFail()] })])]), []);
  // auch ohne Rerun-Kennung: gruene Laeufe vor dem roten schliessen nicht
  assert.deepEqual(go([euw([g1, g2])], [open]), []);
});

test('Schwelle 2 (tft-icon-mirror.yml): erster roter Lauf nichts, zweiter Issue', () => {
  const im = (runs) => wf('tft-icon-mirror.yml', 'TFT-Bilder-Kopie', runs);
  const red = (min) => run('failure', min, { jobs: [job('gate', 'success', []), job('mirror', 'failure', [['Bilder kopieren', 'failure']])] });
  const ok = (min) => run('success', min, { jobs: [job('gate', 'success', []), job('mirror', 'success', [])] });
  const r1 = red(60);
  assert.deepEqual(go([im([r1, ok(120)])]), []);
  const ops = go([im([red(1), r1, ok(120)])]);
  assert.deepEqual(kinds(ops), ['create']);
  assert.match(ops[0].body, /Rote Laeufe in Folge: mindestens 2/);
  // Schwelle 1, ein roter Lauf vor einem gruenen: genaue Zahl
  const one = go([euw([run('failure', 30, { jobs: [crawlFail()] }), run('success', 300)])]);
  assert.match(one[0].body, /Rote Laeufe in Folge: 1\n/);
});

test('ignoriert: cancelled, pull_request, Fork, nicht main, Dependabot, der Melder selbst', () => {
  const failing = { jobs: [crawlFail()] };
  const runs = [
    run('cancelled', 5, failing),
    run('failure', 6, { ...failing, event: 'pull_request' }),
    run('failure', 7, { ...failing, event: 'pull_request_target' }),
    run('failure', 8, { ...failing, headRepo: 'fremd/metastats' }),
    run('failure', 9, { ...failing, branch: 'dependabot/npm_and_yarn/x' }),
    run('failure', 10, { ...failing, event: 'dynamic' }),
    run('skipped', 11, failing),
    run('neutral', 12, failing),
    run('success', 600, { jobs: [green()] }),
  ];
  assert.deepEqual(go([euw(runs)]), []);
  const dependabot = { file: 'dynamic/dependabot/dependabot-updates', name: 'Dependabot Updates', after: 1, prepSteps: [], riotSteps: [], runs: [run('failure', 5, failing)] };
  const self = { file: SELF, name: 'Fehler-Melder', after: 1, prepSteps: [], riotSteps: [], runs: [run('failure', 5, failing)] };
  assert.deepEqual(go([dependabot, self]), []);
});

test('Riot-Schluessel in 4 Workflows: EIN Issue, schliesst nach 2 echten gruenen', () => {
  const RIOT_LOG = "  echo \"::error::Riot-Schluessel abgelaufen ($LABEL, HTTP $STATUS). Abbruch vor dem Crawl.\"\n2026-11-12T10:00:00.0000000Z ##[error]Riot-Schluessel abgelaufen (TFT, HTTP 401). Abbruch vor dem Crawl.";
  const riotRun = (jobName, min) => run('failure', min, { jobs: [job(jobName, 'failure', [['Set up job', 'success'], ['Checkout repository', 'success'], ['Riot TFT key pre-flight', 'failure']], RIOT_LOG)] });
  const four = () => [
    wf('tft-weekly-crawl.yml', 'TFT Weekly Crawl', [riotRun('crawl-and-deploy', 30)]),
    wf('tft-pro-crawl-weekly.yml', 'TFT Pro Player Weekly Crawl', [riotRun('crawl', 40)]),
    wf('tft-daily-crawl.yml', 'TFT Daily Crawl', [riotRun('crawl (euw1)', 50)]),
    // Pre-Warm hat ein gate: der Leerlauf danach aendert nichts
    wf('tft-player-cache-prewarm.yml', 'TFT Player Cache Pre-Warm', [
      run('success', 20, { event: 'schedule', jobs: [job('gate', 'success', []), job('prewarm (kr)', 'skipped', [])] }),
      riotRun('prewarm (kr)', 60),
    ]),
  ];
  const ops = go(four());
  assert.deepEqual(kinds(ops), ['create']);
  assert.equal(ops[0].key, RIOT_KEY);
  assert.equal(ops[0].title, '[Lauf rot] Riot-Schluessel abgelaufen');
  for (const n of ['TFT Weekly Crawl', 'TFT Pro Player Weekly Crawl', 'TFT Daily Crawl', 'TFT Player Cache Pre-Warm']) assert.match(ops[0].body, new RegExp(n));
  const open = issueFrom(ops[0], 80);
  // weiter rot: nichts
  assert.deepEqual(go(four(), [open]), []);
  // Schluessel erneuert: ein gruener Lauf reicht nicht, zwei schon
  const okRun = (min) => run('success', min, { jobs: [job('crawl', 'success', [])] });
  const oneGreen = [wf('tft-pro-crawl-weekly.yml', 'TFT Pro Player Weekly Crawl', [okRun(5), riotRun('crawl', 40)])];
  assert.deepEqual(go(oneGreen, [open]), []);
  const twoGreens = [
    wf('tft-pro-crawl-weekly.yml', 'TFT Pro Player Weekly Crawl', [okRun(5), riotRun('crawl', 40)]),
    wf('tft-weekly-crawl.yml', 'TFT Weekly Crawl', [okRun(3), riotRun('crawl-and-deploy', 30)]),
  ];
  assert.deepEqual(go(twoGreens, [open]), [{ op: 'close', number: 80 }]);
  // das Skript-Echo allein („::error::“) ist kein Treffer
  assert.ok(!RIOT_PATTERN.test('  echo "::error::Riot-Schluessel abgelaufen ($LABEL)"'));
});

test('Issue-Text: keine Log-Zeilen, kein @, nur Workflow, Job, Schritt, Lauf-Link', () => {
  const leaky = 'SECRET=abc123 ##[error]token ghp_xxx in Zeile, @jemand bitte ansehen ' + NET_LOG;
  const j = job('verify', 'failure', [['Set up job', 'success'], ['Run actions/checkout@v7', 'success'], ['Unit-Tests @ main', 'failure']], leaky);
  const ops = go([{ ...wf('ci.yml', 'CI', [run('failure', 30, { jobs: [j], event: 'push' })]) }]);
  assert.deepEqual(kinds(ops), ['create']);
  const { title, body } = ops[0];
  for (const text of [title, body]) {
    assert.ok(!text.includes('@'), text);
    assert.ok(!/SECRET|ghp_|##\[error\]|returned error/.test(text), text);
  }
  assert.match(body, /https:\/\/github\.com\/Dota1337\/metastats\/actions\/runs\/\d+ \(Versuch 1\)/);
  assert.match(body, /Rot: verify › Unit-Tests main/);
});

test('Zuweisung nachholen, aber nicht fuer das, was gerade geschlossen wird', () => {
  const r1 = run('failure', 300, { jobs: [crawlFail()] });
  const created = go([euw([r1])])[0];
  assert.deepEqual(go([euw([r1])], [issueFrom(created, 90, [])]), [{ op: 'assign', number: 90 }]);
  assert.deepEqual(go([euw([r1])], [issueFrom(created, 90, ['dota1337'])]), []);
  const greens = [run('success', 20, { jobs: [green()] }), run('success', 100, { jobs: [green()] }), r1];
  assert.deepEqual(go([euw(greens)], [issueFrom(created, 90, [])]), [{ op: 'close', number: 90 }]);
});

test('Issue zu einem Workflow, den es nicht mehr gibt: still schliessen; fremde Issues unberuehrt', () => {
  const gone = { number: 91, state: 'open', title: 't', body: withMarker('x', { key: 'wf:weg.yml', sig: 's', since: ago(500) }), assignees: [OWNER] };
  const fremd = { number: 39, state: 'open', title: 'TFT-Daten: Befund', body: 'ohne Marker <!-- befund:abc -->', assignees: [] };
  assert.deepEqual(go([euw([run('success', 10)])], [gone, fremd]), [{ op: 'close', number: 91 }]);
});

// ---- Abruf-Plan (was der Runner holen muss) ---------------------------------------

test('nextNeed: nur, was die Entscheidung braucht', () => {
  // ohne gate: gruene Laeufe brauchen keine Jobs
  assert.equal(nextNeed(euw([run('success', 10), run('success', 70)]), REPO), null);
  // mit gate: Jobs des gruenen Laufs (Leerlauf?)
  const g = run('success', 10);
  const im = wf('tft-icon-mirror.yml', 'TFT-Bilder-Kopie', [g]);
  assert.deepEqual(nextNeed(im, REPO), { kind: 'jobs', run: g });
  // roter Lauf: erst Jobs, dann Log nur fuer Vorbereitungs-/Riot-Schritt
  const r = run('failure', 10);
  const w = euw([r]);
  assert.equal(nextNeed(w, REPO).kind, 'jobs');
  r.jobs = [prepFail(undefined)];
  delete r.jobs[0].log;
  assert.equal(nextNeed(w, REPO).kind, 'log');
  r.jobs[0].log = null; // nicht mehr abrufbar
  assert.equal(nextNeed(w, REPO), null);
  r.jobs = [crawlFail()];
  assert.equal(nextNeed(w, REPO), null);
  // unvollstaendiger Zustand ist ein Fehler, keine stille Entscheidung
  assert.throws(() => go([euw([run('failure', 10)])]), /unvollstaendig/);
  assert.equal(scan(euw([]), REPO).top, 'none');
});

test('Netz-Muster: 5xx nur mit Zusammenhang', () => {
  for (const s of ['HTTP 503', 'Response status code does not indicate success: 500 (Internal Server Error).', 'npm error code E502', 'read ECONNRESET', 'connect ETIMEDOUT 1.2.3.4:443', '504 Gateway Time-out', 'The requested URL returned error: 502']) {
    assert.ok(NET_PATTERN.test(s), s);
  }
  for (const s of ['added 523 packages in 12s', 'Process completed with exit code 1.', 'Error: Cannot find module']) {
    assert.ok(!NET_PATTERN.test(s), s);
  }
});

test('Marker: Text und Zustand getrennt lesbar, Signatur fasst Matrix-Jobs zusammen', () => {
  assert.deepEqual(parseMarker(withMarker('t', { key: 'k', sig: 's' })), { key: 'k', sig: 's' });
  assert.equal(parseMarker('kein Marker'), null);
  const r = run('failure', 1, { jobs: [job('crawl (euw1)', 'failure', [['Crawl', 'failure']]), job('crawl (kr)', 'failure', [['Crawl', 'failure']])] });
  assert.equal(signature(r), 'crawl › Crawl');
  assert.equal(LABEL, 'lauf-rot');
});

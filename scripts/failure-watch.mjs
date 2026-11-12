#!/usr/bin/env node
/**
 * Fehler-Melder fuer die GitHub-Actions-Laeufe: holt den Zustand ALLER
 * Workflows per REST, entscheidet (scripts/lib/failure-watch.mjs) und fuehrt
 * aus: Rerun bei Netz-Aussetzern in der Vorbereitung, sonst ein Issue je
 * Ursache, dem Besitzer zugewiesen (= eine Mail), Text aendern bei neuer
 * Ursache, still schliessen nach zwei echten gruenen Laeufen.
 *
 * Laeuft in .github/workflows/failure-watch.yml (workflow_run aller anderen
 * Workflows + alle 15 min von der Box angestossen, scripts/gh-dispatch-due.mjs).
 *
 *   node scripts/failure-watch.mjs             # echt (GH_TOKEN/GITHUB_TOKEN: issues + actions write)
 *   node scripts/failure-watch.mjs --dry-run   # liest nur, gibt die Operationen aus
 *
 * Schwelle je Workflow: env FAILURE_WATCH_AFTER in der Workflow-Datei selbst
 * (gelesen aus dem Checkout von main), keine zweite Liste hier.
 *
 * Das Repo ist oeffentlich: ausgegeben werden nur Workflow-Namen, Lauf-Nummern
 * und Operationen, nie Log-Inhalte.
 */
import { readFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LABEL, SELF, decide, nextNeed, scan, workflowMeta, isRiotRun,
} from './lib/failure-watch.mjs';
import {
  makeGh, ownerOf, listIssues, ensureLabel, createIssue, editIssue, closeIssue, assignOwner,
} from './lib/gh-issues.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.GITHUB_REPOSITORY || 'Dota1337/metastats';
const OWNER = ownerOf(REPO);
const TOKEN = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const DRY = process.argv.includes('--dry-run');
const RUNS_PER_WORKFLOW = 15;
const LOG_TAIL = 512 * 1024; // Vorbereitungs-Fehler stehen am Anfang des Jobs, das Log ist dann klein

const mask = (s) => (TOKEN ? String(s).split(TOKEN).join('***') : String(s));

const toRun = (r) => ({
  id: r.id,
  attempt: r.run_attempt,
  event: r.event,
  branch: r.head_branch,
  headRepo: r.head_repository?.full_name ?? null,
  status: r.status,
  conclusion: r.conclusion,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const toJob = (j) => ({
  id: j.id,
  name: j.name,
  conclusion: j.conclusion,
  steps: (j.steps ?? []).map((s) => ({ name: s.name, number: s.number, conclusion: s.conclusion })),
});

async function loadWorkflows(gh) {
  const list = await gh('GET', '/actions/workflows?per_page=100');
  const out = [];
  for (const w of list.workflows ?? []) {
    if (!String(w.path).startsWith('.github/workflows/')) continue; // dynamic/ = Dependabot
    const file = basename(w.path);
    if (file === SELF || w.state !== 'active') continue;
    const path = join(ROOT, '.github', 'workflows', file);
    // Workflows, die nur auf anderen Zweigen liefen, fehlen im Checkout von main.
    if (!existsSync(path)) { console.log(`(${file}: nicht auf main, uebersprungen)`); continue; }
    const meta = workflowMeta(readFileSync(path, 'utf8'));
    const res = await gh('GET', `/actions/workflows/${w.id}/runs?branch=main&per_page=${RUNS_PER_WORKFLOW}&exclude_pull_requests=true`);
    out.push({ file, name: w.name, ...meta, runs: (res.workflow_runs ?? []).map(toRun) });
  }
  return out;
}

// Holt nur, was die Entscheidung braucht (nextNeed), Schritt fuer Schritt.
async function complete(gh, wf) {
  for (let guard = 0; guard < 40; guard++) {
    const need = nextNeed(wf, REPO);
    if (!need) return;
    if (need.kind === 'jobs') {
      const res = await gh('GET', `/actions/runs/${need.run.id}/jobs?filter=latest&per_page=100`);
      need.run.jobs = (res.jobs ?? []).map(toJob);
    } else {
      // Logs alter Laeufe sind irgendwann weg (404/410): dann unbekannt, kein Rerun, keine Riot-Ursache.
      const text = await gh('GET', `/actions/jobs/${need.job.id}/logs`, null, { text: true, allow: [404, 410] });
      need.job.log = typeof text === 'string' ? text.slice(-LOG_TAIL) : null;
    }
  }
  throw new Error(`${wf.file}: Zustand nach 40 Abrufen nicht vollstaendig`);
}

function describe(wf) {
  const s = scan(wf, REPO);
  if (s.busy) return 'Rerun laeuft';
  if (s.top === 'none') return 'keine zaehlenden Laeufe';
  if (s.top === 'green') return `gruen (${s.greens.length} echt in Folge)`;
  return `ROT, ${s.reds.length} in Folge (Schwelle ${wf.after})${isRiotRun(s.reds[0], wf) ? ', Riot-Schluessel' : ''}`;
}

async function apply(gh, op, ctx) {
  switch (op.op) {
    case 'rerun':
      await gh('POST', `/actions/runs/${op.runId}/rerun-failed-jobs`);
      return;
    case 'create': {
      if (!ctx.labelReady) {
        await ensureLabel(gh, { name: LABEL, color: 'B60205', description: 'GitHub-Lauf rot (Fehler-Melder, automatisch)' });
        ctx.labelReady = true;
      }
      const issue = await createIssue(gh, { title: op.title, body: op.body, labels: [LABEL] });
      return assign(gh, issue.number);
    }
    case 'editBody': await editIssue(gh, op.number, { body: op.body }); return;
    case 'close': await closeIssue(gh, op.number); return;
    case 'assign': return assign(gh, op.number);
    default: throw new Error(`unbekannte Operation ${op.op}`);
  }
}

// Erst die Zuweisung loest die Mail aus. Scheitert sie, laufen die uebrigen
// Schritte weiter, der Lauf endet rot, und der naechste Abgleich holt sie nach.
async function assign(gh, number) {
  const why = await assignOwner(gh, number, OWNER);
  if (!why) return;
  console.error(`::error::Issue #${number} ohne Zustaendigen, es geht keine Mail raus: ${mask(why)}`);
  process.exitCode = 1;
}

const opLine = (op) => {
  if (op.op === 'rerun') return `- rerun ${op.file} Lauf ${op.runId}`;
  if (op.op === 'create') return `- create "${op.title}" (${op.key})`;
  return `- ${op.op} #${op.number}`;
};

async function main() {
  if (!TOKEN) throw new Error('GH_TOKEN oder GITHUB_TOKEN fehlt (auch fuer --dry-run: Logs brauchen Anmeldung)');
  const gh = makeGh({ repo: REPO, token: TOKEN });
  const workflows = await loadWorkflows(gh);
  const issues = await listIssues(gh, { label: LABEL, state: 'open' });
  for (const wf of workflows) await complete(gh, wf);

  for (const wf of workflows) console.log(`${wf.file}: ${describe(wf)}`);
  console.log(`${workflows.length} Workflows, ${issues.length} offene Melder-Issues (Label ${LABEL})`);

  const ops = decide({ repo: REPO, now: Date.now(), owner: OWNER, workflows, issues });
  for (const op of ops) console.log(opLine(op));
  if (!ops.length) console.log('- nichts zu tun');
  if (DRY) return;

  const ctx = { labelReady: false };
  for (const op of ops) await apply(gh, op, ctx);
}

main().catch((e) => {
  console.error('Fehler:', mask(e?.message || e));
  process.exit(1);
});

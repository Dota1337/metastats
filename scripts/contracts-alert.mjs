#!/usr/bin/env node
// Holt den gekuerzten Vertragsstatus von der Box und gleicht die GitHub-Aufgaben
// mit Label contract-broken ab. Logik: scripts/lib/contracts-alert.mjs.
//
// Laeuft in .github/workflows/contracts-alert.yml. Env:
//   CONTRACTS_STATUS_URL   z. B. http://<box>:4100/contracts-status
//   CONTRACTS_READ_TOKEN   geteiltes Geheimnis mit refresh-api (nur fuer HMAC)
//   GITHUB_TOKEN, GITHUB_REPOSITORY
// Optionen:
//   --dry-run              nur ausgeben, was passieren wuerde
//   --status-file <pfad>   gekuerzten Status aus Datei statt von der Box
//
// Das Repo ist oeffentlich: der Statustext wird hier nie ins Log geschrieben,
// nur die Operationen (Titel sind bereits neutral).

import { readFileSync } from 'node:fs';
import { decide, sign, LABEL } from './lib/contracts-alert.mjs';

const args = process.argv.slice(2);
const DRY = args.includes('--dry-run');
const fileIdx = args.indexOf('--status-file');
const STATUS_FILE = fileIdx >= 0 ? args[fileIdx + 1] : null;

const REPO = process.env.GITHUB_REPOSITORY || 'Dota1337/metastats';
const GH = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;

async function fetchStatus() {
  if (STATUS_FILE) return { kind: 'report', report: JSON.parse(readFileSync(STATUS_FILE, 'utf8')) };
  const url = process.env.CONTRACTS_STATUS_URL;
  const token = process.env.CONTRACTS_READ_TOKEN;
  if (!url || !token) throw new Error('CONTRACTS_STATUS_URL / CONTRACTS_READ_TOKEN fehlen');
  let why = '';
  // refresh-api startet bei jedem Deploy neu — kurze Luecken ueberbruecken.
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ts = String(Date.now());
    try {
      const res = await fetch(url, {
        headers: { 'X-Ms-Ts': ts, 'X-Ms-Sig': sign(token, ts) },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { kind: 'report', report: await res.json() };
      why = `HTTP ${res.status}`;
      if (res.status === 401) break; // falsches Token wird durch Warten nicht besser
    } catch (err) {
      why = err?.name === 'TimeoutError' ? 'Zeitueberschreitung' : 'keine Verbindung';
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 20_000));
  }
  return { kind: 'unreachable', why };
}

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${GH}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && !(method === 'POST' && path === '/labels' && res.status === 422)) {
    throw new Error(`GitHub ${method} ${path} → HTTP ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

async function listIssues() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh('GET', `/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    all.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < 100) break;
  }
  return all.map((i) => ({ number: i.number, state: i.state, title: i.title, body: i.body || '' }));
}

async function apply(op) {
  switch (op.op) {
    case 'create': return gh('POST', '/issues', { title: op.title, body: op.body, labels: [LABEL] });
    case 'comment': return gh('POST', `/issues/${op.number}/comments`, { body: op.body });
    // title nur beim Wechsel rot <-> gelb (" (Warnung)" im Titel)
    case 'edit': return gh('PATCH', `/issues/${op.number}`, op.title ? { body: op.body, title: op.title } : { body: op.body });
    case 'reopen':
      await gh('PATCH', `/issues/${op.number}`, { state: 'open' });
      return gh('POST', `/issues/${op.number}/comments`, { body: op.comment });
    case 'close':
      await gh('POST', `/issues/${op.number}/comments`, { body: op.comment });
      return gh('PATCH', `/issues/${op.number}`, { state: 'closed', state_reason: 'completed' });
    default: throw new Error(`unbekannte Operation ${op.op}`);
  }
}

const input = await fetchStatus();
if (input.kind === 'report') input.now = Date.now();
if (!GH && !DRY) throw new Error('GITHUB_TOKEN fehlt');
const issues = GH ? await listIssues() : [];
const ops = decide(input, issues);

console.log(input.kind === 'report'
  ? `Status: ${input.report.summary?.ok ?? '?'} ok, ${input.report.summary?.warn ?? 0} gelb, ${(input.report.summary?.broken ?? 0) + (input.report.summary?.error ?? 0)} rot`
  : `Status: nicht abrufbar (${input.why})`);
for (const op of ops) console.log(`- ${op.op}${op.number ? ` #${op.number}` : ''}${op.title ? ` "${op.title}"` : ''}`);
if (ops.length === 0) console.log('- nichts zu tun');

if (!DRY) {
  if (ops.some((o) => o.op === 'create')) await gh('POST', '/labels', { name: LABEL, color: 'B60205', description: 'Laufzeit-Vertrag rot (automatisch)' });
  for (const op of ops) await apply(op);
}

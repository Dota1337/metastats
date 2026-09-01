// Verhaltens-Tests der Disziplin-Hooks.
//
// check-discipline-hooks.mjs prueft nur Anwesenheit (Events registriert,
// Scripts vorhanden, kein Drift gegen .claude/settings.json). Ob die Freigabe
// zum richtigen Zeitpunkt verfaellt, sagt es nicht — und genau daran haengt
// der Umbau vom 2026-08-16 (Freigabe ueberlebt den Compact).
//
// Alles laeuft gegen ein Temp-Verzeichnis via CLAUDE_PROJECT_DIR. Frueher
// wurde von Hand gegen den echten Hook getestet; die Leichen davon liegen als
// .git/metastats-discipline/test-*.json im Live-Zustand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const HOOKS = join(import.meta.dirname, '..');
const REAL_PROJECT = join(HOOKS, '..', '..');

/** Frisches Fake-Projekt: .claude/plan-current.md + leeres .git/. */
function makeProject({ plan = 'Plan-Inhalt' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'metastats-hooks-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  mkdirSync(join(dir, '.git'), { recursive: true });
  mkdirSync(join(dir, 'infra', 'claude-settings'), { recursive: true });
  writeFileSync(join(dir, 'infra', 'claude-settings', 'discipline.md'), '# Kernregeln\n');
  if (plan !== null) writeFileSync(join(dir, '.claude', 'plan-current.md'), plan);
  return dir;
}

/**
 * Hook mit JSON auf stdin laufen lassen. Die Hook-Scripts liegen bewusst im
 * echten Repo — nur PROJECT_DIR wird umgebogen, damit wir den echten Code
 * testen und nicht eine Kopie.
 */
function runHook(name, project, input) {
  const out = execFileSync(process.execPath, [join(HOOKS, name)], {
    input: JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project },
    encoding: 'utf8',
  });
  try { return JSON.parse(out || '{}'); } catch { return {}; }
}

function readSessionState(project, sessionId) {
  try {
    return JSON.parse(readFileSync(join(project, '.git', 'metastats-discipline', `${sessionId}.json`), 'utf8'));
  } catch {
    return {};
  }
}

async function loadState(project) {
  process.env.CLAUDE_PROJECT_DIR = project;
  // Cache-Buster: state.mjs liest PROJECT_DIR beim Import.
  return import(`./state.mjs?t=${Date.now()}${Math.random()}`);
}

function approve(project, sessionId, prompt = 'ja') {
  runHook('prompt-submit.mjs', project, { session_id: sessionId, prompt });
}

test('startup, clear und resume loeschen die Freigabe', () => {
  for (const source of ['startup', 'clear', 'resume']) {
    const project = makeProject();
    approve(project, 's1');
    assert.ok(readSessionState(project, 's1').approvedAt, `${source}: Freigabe wurde nicht gesetzt`);

    runHook('session-start.mjs', project, { session_id: 's1', source });
    assert.equal(readSessionState(project, 's1').approvedAt, null, `${source} haette loeschen muessen`);
    rmSync(project, { recursive: true, force: true });
  }
});

test('compact laesst eine plangebundene Freigabe stehen', () => {
  const project = makeProject();
  approve(project, 's2');
  runHook('session-start.mjs', project, { session_id: 's2', source: 'compact' });

  const s = readSessionState(project, 's2');
  assert.ok(s.approvedAt, 'Freigabe haette den Compact ueberleben muessen');
  assert.equal(s.survivedCompact, true);
  rmSync(project, { recursive: true, force: true });
});

test('compact loescht eine Freigabe ohne Plan-Bindung', () => {
  const project = makeProject({ plan: null });
  approve(project, 's3', 'trivial: nur ein Typo');
  assert.equal(readSessionState(project, 's3').planHash, null);

  runHook('session-start.mjs', project, { session_id: 's3', source: 'compact' });
  assert.equal(readSessionState(project, 's3').approvedAt, null);
  rmSync(project, { recursive: true, force: true });
});

test('PostCompact spielt den freigegebenen Plan wieder ein', () => {
  const project = makeProject({ plan: '# Plan\nEinzigartiger Marker 4711' });
  approve(project, 's4');
  runHook('session-start.mjs', project, { session_id: 's4', source: 'compact' });

  const out = runHook('post-compact.mjs', project, { session_id: 's4' });
  const ctx = out.hookSpecificOutput?.additionalContext || '';
  assert.match(ctx, /Einzigartiger Marker 4711/);
  assert.doesNotMatch(ctx, /Freigabe ist verfallen/);
  rmSync(project, { recursive: true, force: true });
});

test('PostCompact sagt ohne Freigabe klar, dass keine vorliegt', () => {
  const project = makeProject();
  const out = runHook('post-compact.mjs', project, { session_id: 'ohne-freigabe' });
  assert.match(out.hookSpecificOutput?.additionalContext || '', /KEINE gueltige Freigabe/);
  rmSync(project, { recursive: true, force: true });
});

test('wiederholtes "ok" fuellt den absoluten Deckel nicht nach', async () => {
  const project = makeProject();
  const { approvalStatus, MAX_PROMPTS_PER_TOPIC } = await loadState(project);

  approve(project, 's5');
  for (let i = 0; i < MAX_PROMPTS_PER_TOPIC + 1; i++) {
    // Kein Wort aus dem Freigabe-Regex am Anfang — sonst zaehlt der Prompt
    // selbst als Freigabe (`mach` steht dort drin).
    runHook('prompt-submit.mjs', project, { session_id: 's5', prompt: `und jetzt Schritt ${i}` });
    if (i % 5 === 0) approve(project, 's5'); // Zwischen-"ok", wie es real passiert
  }

  const status = approvalStatus('s5');
  assert.equal(status.ok, false);
  assert.match(status.reason, /erste[n]? Freigabe/);
  rmSync(project, { recursive: true, force: true });
});

test('geaenderte Plan-Datei blockt weiterhin', async () => {
  const project = makeProject();
  const { approvalStatus } = await loadState(project);

  approve(project, 's6');
  assert.equal(approvalStatus('s6').ok, true);

  writeFileSync(join(project, '.claude', 'plan-current.md'), 'ein ganz anderer Plan');
  const status = approvalStatus('s6');
  assert.equal(status.ok, false);
  assert.match(status.reason, /geaendert/);
  rmSync(project, { recursive: true, force: true });
});

test('neuer Code:-Task loescht die Freigabe', () => {
  const project = makeProject();
  approve(project, 's7');
  runHook('prompt-submit.mjs', project, { session_id: 's7', prompt: 'Code: etwas voellig anderes' });
  assert.equal(readSessionState(project, 's7').approvedAt, null);
  rmSync(project, { recursive: true, force: true });
});

test('PreCompact fasst den Freigabe-Zustand nicht mehr an', () => {
  const project = makeProject();
  approve(project, 's8');
  const before = readSessionState(project, 's8');
  runHook('compact-reset.mjs', project, { session_id: 's8', trigger: 'auto' });
  assert.deepEqual(readSessionState(project, 's8'), before);
  rmSync(project, { recursive: true, force: true });
});

test('der Schalter existiert und steht auf true', async () => {
  const project = makeProject();
  const { APPROVAL_SURVIVES_COMPACT } = await loadState(project);
  assert.equal(APPROVAL_SURVIVES_COMPACT, true, 'Rollback-Schalter fehlt oder ist aus');
  rmSync(project, { recursive: true, force: true });
  process.env.CLAUDE_PROJECT_DIR = REAL_PROJECT;
});

// --- Freigabe-Lecks, gefunden beim Bau des Schreib-Gates (2026-09-01) --------

test('eine Subagent-Fertigmeldung erteilt keine Freigabe', () => {
  const project = makeProject();
  const meldung = `<task-notification>\n<task-id>abc</task-id>\n${'Der Fix ist trivial. '.repeat(200)}`;
  runHook('prompt-submit.mjs', project, { session_id: 's20', prompt: meldung });
  assert.equal(readSessionState(project, 's20').approvedAt ?? null, null);
  rmSync(project, { recursive: true, force: true });
});

test('"trivial" in einem langen Prompt ist keine Freigabe', () => {
  const project = makeProject();
  const lang = `Erklaer mir bitte ausfuehrlich, warum du das fuer trivial haeltst. ${'x'.repeat(200)}`;
  runHook('prompt-submit.mjs', project, { session_id: 's21', prompt: lang });
  assert.equal(readSessionState(project, 's21').approvedAt ?? null, null);
  rmSync(project, { recursive: true, force: true });
});

test('"Code: ja" ist eine Freigabe, kein neues Thema', () => {
  const project = makeProject();
  approve(project, 's22');
  runHook('prompt-submit.mjs', project, { session_id: 's22', prompt: 'Code: ja' });
  assert.ok(readSessionState(project, 's22').approvedAt, 'Freigabe darf nicht geloescht sein');
  rmSync(project, { recursive: true, force: true });
});

// --- Negativtest des Schreib-Gates, beide Richtungen (Plan B4) ---------------

const PLAN_MIT_REVIEW = `# Plan
## Verdicts
- metastats-architect: PASS
- metastats-logic-flow-critic: NEEDS-ATTENTION

| Option | Vorteil | Nachteil |
|---|---|---|
| A | schnell | fragil |
| B | robust | teuer |
| C | mittel | mittel |
`;

const decision = (r) => r?.hookSpecificOutput?.permissionDecision ?? 'allow';

function gate(project, sessionId, tool_input, tool_name = 'Write') {
  return decision(runHook('write-gate.mjs', project, { session_id: sessionId, tool_name, tool_input }));
}

test('ohne Freigabe blocken beide Schreibwege: Write und sed -i', () => {
  const project = makeProject({ plan: PLAN_MIT_REVIEW });
  assert.equal(gate(project, 's30', { file_path: join(project, 'app', 'x.ts') }), 'deny');
  assert.equal(gate(project, 's30', { command: 'sed -i "s/a/b/" app/x.ts' }, 'Bash'), 'deny');
  rmSync(project, { recursive: true, force: true });
});

test('mit Freigabe und reviewtem Plan gehen beide durch', () => {
  const project = makeProject({ plan: PLAN_MIT_REVIEW });
  approve(project, 's31');
  assert.equal(gate(project, 's31', { file_path: join(project, 'app', 'x.ts') }), 'allow');
  assert.equal(gate(project, 's31', { command: 'sed -i "s/a/b/" app/x.ts' }, 'Bash'), 'allow');
  rmSync(project, { recursive: true, force: true });
});

test('Freigabe ohne Verdicts im Plan reicht nicht', () => {
  const project = makeProject({ plan: '# Plan\nnur Prosa, keine Review.' });
  approve(project, 's32');
  assert.equal(gate(project, 's32', { file_path: join(project, 'app', 'x.ts') }), 'deny');
  rmSync(project, { recursive: true, force: true });
});

test('WRITE_GATE=0 ist der Notausgang', () => {
  const project = makeProject({ plan: PLAN_MIT_REVIEW });
  const out = execFileSync(process.execPath, [join(HOOKS, 'write-gate.mjs')], {
    input: JSON.stringify({ session_id: 's33', tool_name: 'Write', tool_input: { file_path: join(project, 'app', 'x.ts') } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, WRITE_GATE: '0' },
    encoding: 'utf8',
  });
  assert.equal(out.trim(), '');
  rmSync(project, { recursive: true, force: true });
});

test('das Gate sperrt seine eigene Reparatur nicht ein', () => {
  const project = makeProject({ plan: PLAN_MIT_REVIEW });
  assert.equal(gate(project, 's34', { file_path: join(project, 'scripts', 'hooks', 'write-gate.mjs') }), 'allow');
  assert.equal(gate(project, 's34', { file_path: join(project, 'infra', 'claude-settings', 'hooks.json') }), 'allow');
  rmSync(project, { recursive: true, force: true });
});

test('Maschinen-Prompts zaehlen das Freigabe-Fenster nicht leer', async () => {
  const project = makeProject();
  const { approvalStatus, MAX_PROMPTS_PER_APPROVAL } = await loadState(project);

  approve(project, 's9');
  // Eine Multi-Review nach AGENTS.md meldet pro Agent einmal zurueck. Frueher
  // verbrauchte allein das 2 der 8 erlaubten Prompts — die vorgeschriebene
  // Review hat also die Freigabe fuer die Implementation aufgefressen.
  for (let i = 0; i < MAX_PROMPTS_PER_APPROVAL + 3; i++) {
    runHook('prompt-submit.mjs', project, {
      session_id: 's9',
      prompt: '<task-notification>metastats-architect: PASS</task-notification>',
    });
  }

  assert.equal(readSessionState(project, 's9').promptsSinceApproval, 0);
  assert.equal(approvalStatus('s9').ok, true);
  rmSync(project, { recursive: true, force: true });
});

test('echte User-Prompts zaehlen weiterhin mit', async () => {
  const project = makeProject();
  const { approvalStatus, MAX_PROMPTS_PER_APPROVAL } = await loadState(project);

  approve(project, 's10');
  for (let i = 0; i <= MAX_PROMPTS_PER_APPROVAL; i++) {
    runHook('prompt-submit.mjs', project, { session_id: 's10', prompt: `und jetzt Schritt ${i}` });
  }

  const status = approvalStatus('s10');
  assert.equal(status.ok, false);
  rmSync(project, { recursive: true, force: true });
});

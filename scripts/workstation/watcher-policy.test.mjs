// Tests fuer den Entscheidungskern des Prozess-Waechters. Laeuft ueberall
// (auch im Linux-CI), weil decide() nur Prozesslisten auswertet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, waechterLebt, istClaudeHaupt, istSuchProgramm, istRgModus,
  CPU_DROSSEL_S, HERZ_ALT_MS, PRIO, schluessel,
} from './watcher-policy.mjs';

const CLAUDE = 'C:\\Users\\dtaub\\AppData\\Local\\Programs\\nodejs\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe';
const CLAUDE_DESKTOP = 'C:\\Users\\dtaub\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe';
const BASH = 'C:\\Program Files\\Git\\bin\\bash.exe';
const GREP = 'C:\\Program Files\\Git\\usr\\bin\\grep.exe';
const DU = 'C:\\Program Files\\Git\\usr\\bin\\du.exe';
const WIN_FIND = 'C:\\Windows\\system32\\find.exe';
const VSCODE = 'C:\\Users\\dtaub\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe';
const VSCODE_RG = 'C:\\Users\\dtaub\\AppData\\Local\\Programs\\Microsoft VS Code\\resources\\app\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe';
const NODE = 'C:\\Users\\dtaub\\AppData\\Local\\Programs\\nodejs\\node.exe';
const PY = 'C:\\Python312\\python.exe';
const PWSH = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';

const name = (exe) => exe.split('\\').pop();
const proc = (pid, ppid, exe, o = {}) => ({
  pid, ppid, name: name(exe), exe, cmd: o.cmd ?? `"${exe}"`,
  created: o.created ?? String(1_000_000 + pid), cpu: o.cpu ?? 1, prio: o.prio ?? PRIO.BELOW_NORMAL,
});

// Terminal (100) → Claude (200) → Bash-Tool (300) → grep (301)
const terminal = proc(100, 1, PWSH, { prio: PRIO.NORMAL });
const claude = proc(200, 100, CLAUDE);
const bash = proc(300, 200, BASH);
const grep = proc(301, 300, GREP, { cmd: 'grep -rn x .' });
const SELF = 999;

const pids = (liste) => liste.map((p) => p.pid).sort((a, b) => a - b);

test('Erkennung: Claude Code am Pfad, nicht Claude Desktop, rg-Modus ist keine Sitzung', () => {
  assert.equal(istClaudeHaupt(claude), true);
  assert.equal(istClaudeHaupt(proc(1, 0, 'C:\\Users\\dtaub\\.local\\bin\\claude.exe')), true);
  assert.equal(istClaudeHaupt(proc(1, 0, CLAUDE_DESKTOP)), false);
  const rg = proc(1, 0, CLAUDE, { cmd: 'rg --files-with-matches x D:\\Metastats' });
  assert.equal(istRgModus(rg), true);
  assert.equal(istClaudeHaupt(rg), false);
  assert.equal(istSuchProgramm(rg), true);
  assert.equal(istRgModus(proc(1, 0, CLAUDE, { cmd: `"${CLAUDE}" rg -n x` })), true);
  assert.equal(istRgModus(proc(1, 0, CLAUDE, { cmd: `"${CLAUDE}" --resume abc` })), false);
});

test('Erkennung: grep/du nur aus Git, Windows-find nie, jedes rg.exe', () => {
  assert.equal(istSuchProgramm(grep), true);
  assert.equal(istSuchProgramm(proc(1, 0, DU)), true);
  assert.equal(istSuchProgramm(proc(1, 0, WIN_FIND)), false);
  assert.equal(istSuchProgramm(proc(1, 0, VSCODE_RG)), true);
  assert.equal(istSuchProgramm(proc(1, 0, PY)), false);
  assert.equal(istSuchProgramm(proc(1, 0, NODE)), false);
  assert.equal(istSuchProgramm(proc(1, 0, BASH)), false);
});

test('verwaiste Claude-Suche: im Durchgang davor gesehen, Bash weg → beenden', () => {
  const r1 = decide([terminal, claude, bash, grep], { selfPid: SELF });
  assert.deepEqual(pids(r1.kill), []);
  assert.ok(r1.lineage.has(schluessel(grep)));
  const r2 = decide([terminal, claude, grep], { selfPid: SELF, lineage: r1.lineage });
  assert.deepEqual(pids(r2.kill), [301]);
  assert.equal(r2.kill[0].grund, 'verwaiste Claude-Suche');
});

test('verwaiste Suche zum ersten Mal gesehen: gesenkte Prioritaet → beenden, normale → bleibt', () => {
  const r = decide([claude, proc(301, 300, GREP)], { selfPid: SELF });
  assert.deepEqual(pids(r.kill), [301]);
  const normal = decide([claude, proc(301, 300, GREP, { prio: PRIO.NORMAL })], { selfPid: SELF });
  assert.deepEqual(pids(normal.kill), []);
});

test('Suche in einer verwaisten Git-Bash zaehlt als verwaist', () => {
  const r = decide([claude, proc(300, 250, BASH), grep], { selfPid: SELF });
  assert.deepEqual(pids(r.kill), [301]);
  assert.deepEqual(pids(r.lower), [], 'die verwaiste Bash wird nicht angefasst');
});

test('angehaengte Suche mit wenig CPU bleibt', () => {
  const r = decide([terminal, claude, bash, grep], { selfPid: SELF });
  assert.deepEqual(pids(r.kill), []);
  assert.deepEqual(pids(r.idle), []);
});

test('angehaengte Suche ueber 120 s CPU → Leerlauf, nicht beenden', () => {
  const lang = proc(301, 300, GREP, { cpu: CPU_DROSSEL_S + 1 });
  const r = decide([terminal, claude, bash, lang], { selfPid: SELF });
  assert.deepEqual(pids(r.idle), [301]);
  assert.deepEqual(pids(r.kill), []);
  const genau = decide([terminal, claude, bash, proc(301, 300, GREP, { cpu: CPU_DROSSEL_S })], { selfPid: SELF });
  assert.deepEqual(pids(genau.idle), [], 'genau 120 s ist noch nicht drueber');
});

test('Claude-Python ueber 120 s CPU → Leerlauf; schon im Leerlauf → nichts', () => {
  const py = proc(302, 300, PY, { cpu: 121 });
  assert.deepEqual(pids(decide([claude, bash, py], { selfPid: SELF }).idle), [302]);
  const schon = proc(302, 300, PY, { cpu: 500, prio: PRIO.IDLE });
  const r = decide([claude, bash, schon], { selfPid: SELF });
  assert.deepEqual(pids(r.idle), []);
  assert.deepEqual(pids(r.kill), []);
});

test('verwaiste Python aus Claude bleibt — wird hoechstens gedrosselt', () => {
  const py = proc(302, 300, PY);
  const r1 = decide([claude, bash, py], { selfPid: SELF });
  const r2 = decide([claude, py], { selfPid: SELF, lineage: r1.lineage });
  assert.deepEqual(pids(r2.kill), []);
  assert.deepEqual(pids(r2.idle), []);
  const heiss = decide([claude, { ...py, cpu: 300 }], { selfPid: SELF, lineage: r1.lineage });
  assert.deepEqual(pids(heiss.idle), [302]);
  assert.deepEqual(pids(heiss.kill), []);
});

test('VS-Code-rg bleibt — angehaengt wie verwaist', () => {
  const code = proc(400, 1, VSCODE, { prio: PRIO.NORMAL });
  const rg = proc(401, 400, VSCODE_RG, { prio: PRIO.NORMAL, cpu: 900 });
  const r = decide([claude, code, rg], { selfPid: SELF });
  assert.deepEqual([...pids(r.kill), ...pids(r.idle), ...pids(r.lower)], []);
  const waise = decide([claude, proc(401, 400, VSCODE_RG, { prio: PRIO.NORMAL })], { selfPid: SELF });
  assert.deepEqual(pids(waise.kill), []);
});

test('Windows-find bleibt, auch als Waise mit gesenkter Prioritaet', () => {
  const r = decide([claude, proc(500, 450, WIN_FIND)], { selfPid: SELF });
  assert.deepEqual(pids(r.kill), []);
});

test('node-Waise aus Claude bleibt', () => {
  const n = proc(303, 300, NODE);
  const r1 = decide([claude, bash, n], { selfPid: SELF });
  const r2 = decide([claude, n], { selfPid: SELF, lineage: r1.lineage });
  assert.deepEqual(pids(r2.kill), []);
});

test('neu vergebene PID: fremder Prozess erbt weder Claude-Herkunft noch Stammbaum', () => {
  // Elternteil juenger als das Kind → die PID 300 gehoert inzwischen jemand anderem
  const fremd = proc(301, 200, GREP, { created: '500', prio: PRIO.NORMAL });
  const r = decide([claude, fremd], { selfPid: SELF });
  assert.deepEqual(pids(r.lower), [], 'nicht als Claude-Nachfahre gesenkt');
  // gleiche PID, andere Startzeit → nicht derselbe Prozess wie im Stammbaum
  const lineage = new Set([`301@${grep.created}`]);
  const neuerProzess = proc(301, 300, GREP, { created: '9999999', prio: PRIO.NORMAL });
  const r2 = decide([claude, neuerProzess], { selfPid: SELF, lineage });
  assert.deepEqual(pids(r2.kill), []);
});

test('der Waechter selbst und seine Kinder bleiben unberuehrt', () => {
  const ich = proc(SELF, 200, NODE, { prio: PRIO.NORMAL });
  const kind = proc(1000, SELF, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', { prio: PRIO.NORMAL, cpu: 500 });
  const suche = proc(1001, SELF, GREP, { prio: PRIO.IDLE });
  const r = decide([claude, ich, kind, suche], { selfPid: SELF, lineage: new Set([schluessel(suche)]) });
  assert.deepEqual([...pids(r.kill), ...pids(r.idle), ...pids(r.lower)], []);
});

test('Prioritaet gesenkt nur fuer Claude, ihre Nachfahren und agentdb', () => {
  const liste = [
    proc(200, 100, CLAUDE, { prio: PRIO.NORMAL }),
    proc(210, 200, NODE, { prio: PRIO.NORMAL, cmd: 'node mcp-server.js' }),
    proc(220, 1, NODE, { prio: PRIO.NORMAL, cmd: 'node D:\\Metastats\\metastats\\scripts\\agentdb\\server.mjs' }),
    proc(230, 1, CLAUDE_DESKTOP, { prio: PRIO.NORMAL }),
    proc(240, 1, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', { prio: PRIO.NORMAL }),
    proc(250, 1, 'D:\\Games\\game.exe', { prio: 13 }),
    proc(260, 200, NODE, { prio: PRIO.BELOW_NORMAL }),
  ];
  const r = decide(liste, { selfPid: SELF });
  assert.deepEqual(pids(r.lower), [200, 210, 220]);
  assert.deepEqual(r.lower.map((p) => p.grund), ['Claude-Sitzung', 'Claude-Nachfahre', 'agentdb']);
  assert.deepEqual([...pids(r.kill), ...pids(r.idle)], []);
});

test('Claude-rg-Modus: angehaengt bleibt, verwaist aus dem Stammbaum wird beendet', () => {
  const rg = proc(310, 200, CLAUDE, { cmd: 'rg -n x D:\\Metastats\\metastats\\app' });
  const r1 = decide([claude, rg], { selfPid: SELF });
  assert.deepEqual(pids(r1.kill), []);
  const r2 = decide([proc(310, 200, CLAUDE, { cmd: rg.cmd })], { selfPid: SELF, lineage: r1.lineage });
  assert.deepEqual(pids(r2.kill), [310]);
  assert.equal(r2.claudeDa, false, 'der rg-Modus zaehlt nicht als laufende Sitzung');
});

test('Stammbaum vergisst verschwundene Prozesse; claudeDa folgt der Sitzung', () => {
  const r1 = decide([claude, bash, grep], { selfPid: SELF });
  assert.equal(r1.claudeDa, true);
  assert.equal(r1.lineage.size, 2);
  const r2 = decide([claude], { selfPid: SELF, lineage: r1.lineage });
  assert.equal(r2.lineage.size, 0);
  assert.equal(decide([bash], { selfPid: SELF }).claudeDa, false);
});

test('fehlende Prioritaet (NaN) loest nichts aus; Zyklen brechen nicht', () => {
  const r = decide([proc(301, 300, GREP, { prio: NaN })], { selfPid: SELF });
  assert.deepEqual(pids(r.kill), []);
  const a = proc(10, 11, GREP, { created: '5' });
  const b = proc(11, 10, BASH, { created: '5' });
  assert.doesNotThrow(() => decide([a, b], { selfPid: SELF }));
});

test('Herzschlag: frisch + lebt → laeuft; alt, tot, fehlend → frei; unlesbar + frisch → laeuft', () => {
  const now = 10_000_000;
  const lebt = (pid) => pid === 42;
  assert.equal(waechterLebt({ pid: 42, mtimeMs: now - 1000 }, now, lebt), true);
  assert.equal(waechterLebt({ pid: 42, mtimeMs: now - HERZ_ALT_MS }, now, lebt), false);
  assert.equal(waechterLebt({ pid: 43, mtimeMs: now - 1000 }, now, lebt), false);
  assert.equal(waechterLebt(null, now, lebt), false);
  assert.equal(waechterLebt({ pid: -1, mtimeMs: now - 1000 }, now, lebt), true);
  assert.equal(waechterLebt({ pid: -1, mtimeMs: now - HERZ_ALT_MS - 1 }, now, lebt), false);
});

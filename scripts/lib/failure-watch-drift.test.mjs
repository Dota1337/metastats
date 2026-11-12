// Der Fehler-Melder wird per workflow_run nur von Workflows geweckt, deren
// `name:` in seiner Liste steht. Ein neuer oder umbenannter Workflow ohne
// Eintrag faellt sonst erst beim 15-Minuten-Abgleich auf (oder bei einem
// Ausfall der Box gar nicht). Regex statt YAML-Bibliothek, Muster
// deploy-filter.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF_DIR = join(ROOT, '.github', 'workflows');
const SELF = 'failure-watch.yml';
const unquote = (s) => s.trim().replace(/^(['"])(.*)\1$/, '$2');

function names() {
  const out = new Map(); // name -> Datei
  for (const f of readdirSync(WF_DIR).filter((x) => /\.ya?ml$/.test(x) && x !== SELF)) {
    const m = /^name:\s*(.+?)\s*$/m.exec(readFileSync(join(WF_DIR, f), 'utf8'));
    assert.ok(m, `${f}: kein name: — GitHub zeigt dann den Pfad, workflow_run braucht den Namen`);
    out.set(unquote(m[1]), f);
  }
  return out;
}

function watchList() {
  const lines = readFileSync(join(WF_DIR, SELF), 'utf8').split(/\r?\n/);
  const at = lines.findIndex((l) => /^\s*workflows:\s*$/.test(l));
  assert.ok(at > 0, 'workflow_run.workflows fehlt');
  const out = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim() || l.trim().startsWith('#')) continue;
    const m = /^\s*-\s*(.+?)\s*$/.exec(l);
    if (!m) break;
    out.push(unquote(m[1]));
  }
  return out;
}

test('jeder Workflow weckt den Fehler-Melder (name: steht in der workflow_run-Liste)', () => {
  const all = names();
  assert.ok(all.size >= 15, `nur ${all.size} Workflows gefunden — Suche kaputt?`);
  const listed = new Set(watchList());
  const missing = [...all].filter(([n]) => !listed.has(n)).map(([n, f]) => `${n} (${f})`);
  assert.deepEqual(missing, [], 'fehlen in failure-watch.yml unter on.workflow_run.workflows');
});

test('jede Zeile der workflow_run-Liste gehoert zu einer Workflow-Datei, keine doppelt', () => {
  const all = names();
  const list = watchList();
  assert.deepEqual(list.filter((n) => !all.has(n)), [], 'Eintraege ohne Workflow-Datei (umbenannt oder geloescht?)');
  assert.equal(new Set(list).size, list.length, 'doppelte Eintraege');
});

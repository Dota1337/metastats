// Jede app/lib-Datei, die ein Box-Skript (scripts/**) laedt, muss im
// Pfad-Filter von .github/workflows/deploy-hetzner.yml stehen. Sonst loest eine
// Aenderung nur an dieser Datei keinen Box-Deploy aus, und die Box laeuft still
// mit der alten Fassung weiter (reference_dual_module_patterns). Auch
// mittelbare Importe zaehlen (app/lib/a.mjs importiert ./b.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (abs) => relative(ROOT, abs).split('\\').join('/');
const IMPORT_RE = /(?:from|import)\s*['"]([^'"]+\.mjs)['"]/g;

function filterPaths() {
  const yml = readFileSync(join(ROOT, '.github/workflows/deploy-hetzner.yml'), 'utf8');
  return new Set([...yml.matchAll(/^\s*-\s*'([^']+)'\s*$/gm)].map((m) => m[1]));
}

function importsOf(abs) {
  return [...readFileSync(abs, 'utf8').matchAll(IMPORT_RE)].map((m) => resolve(dirname(abs), m[1]));
}

test('alle von Box-Skripten geladenen app/lib-Dateien stehen im Deploy-Filter', () => {
  const filter = filterPaths();
  const scriptFiles = readdirSync(join(ROOT, 'scripts'), { recursive: true })
    .map(String)
    .filter((f) => f.endsWith('.mjs') && !f.endsWith('.test.mjs'))
    .map((f) => join(ROOT, 'scripts', f));

  const needed = new Map(); // app/lib-Pfad -> wer ihn laedt
  const queue = [];
  for (const file of scriptFiles) {
    for (const dep of importsOf(file)) {
      const p = rel(dep);
      if (p.startsWith('app/lib/') && !needed.has(p)) { needed.set(p, rel(file)); queue.push(dep); }
    }
  }
  while (queue.length) {
    const file = queue.pop();
    for (const dep of importsOf(file)) {
      const p = rel(dep);
      if (p.startsWith('app/lib/') && !needed.has(p)) { needed.set(p, rel(file)); queue.push(dep); }
    }
  }

  assert.ok(needed.size >= 5, `nur ${needed.size} app/lib-Importe gefunden — Suche kaputt?`);
  const missing = [...needed].filter(([p]) => !filter.has(p)).map(([p, by]) => `${p} (geladen von ${by})`);
  assert.deepEqual(missing, [], 'fehlen im Pfad-Filter von deploy-hetzner.yml');
});

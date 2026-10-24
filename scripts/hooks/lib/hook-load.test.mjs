// Tests der Ladepruefung (Runde 10, Sicherheitsdurchsicht 24.10.2026).
// Alles gegen ein Wegwerf-Projekt im Temp-Ordner.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pruefeHooks, schalter, exporte, importe } from './hook-load.mjs';

function projekt(dateien) {
  const dir = mkdtempSync(join(tmpdir(), 'hook-load-'));
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(dir, pfad)), { recursive: true });
    writeFileSync(join(dir, pfad), inhalt);
  }
  return dir;
}
const HOOKS = (...skripte) => JSON.stringify({
  hooks: { PreToolUse: [{ matcher: 'Bash', hooks: skripte.map((s) => ({ type: 'command', command: `node "$CLAUDE_PROJECT_DIR/${s}"` })) }] },
});
const leer = { home: join(tmpdir(), 'gibt-es-nicht'), env: {} };

test('sauberer Stand: keine Fehler', () => {
  const p = projekt({
    'infra/claude-settings/hooks.json': HOOKS('scripts/hooks/a.mjs'),
    'scripts/hooks/a.mjs': "import { y } from './lib/b.mjs';\nconst m = await import('./lib/b.mjs');\nm.y();\n",
    'scripts/hooks/lib/b.mjs': 'export function y() {}\n',
  });
  const r = pruefeHooks(p, leer);
  assert.deepEqual(r.fehler, []);
  assert.equal(r.geprueft, 2);
  rmSync(p, { recursive: true, force: true });
});

test('gate-faellt-offen-bei-fehlender-datei: fehlende Datei, kaputte Syntax, umbenannter Name', () => {
  const p = projekt({
    'infra/claude-settings/hooks.json': HOOKS('scripts/hooks/a.mjs', 'scripts/hooks/weg.mjs', 'scripts/hooks/kaputt.mjs', 'scripts/hooks/dyn.mjs'),
    'scripts/hooks/a.mjs': "import { x } from './lib/b.mjs';\nimport './lib/fehlt.mjs';\n",
    'scripts/hooks/kaputt.mjs': 'const = 1;\n',
    'scripts/hooks/dyn.mjs': "let gp;\ntry { gp = await import('./lib/b.mjs'); } catch {}\ngp.nichtDa();\n",
    'scripts/hooks/lib/b.mjs': 'export const y = 1;\n',
  });
  const r = pruefeHooks(p, leer).fehler.join('\n');
  assert.match(r, /a\.mjs braucht aus \.\/lib\/b\.mjs: x/);
  assert.match(r, /importiert \.\/lib\/fehlt\.mjs — Datei fehlt/);
  assert.match(r, /scripts\/hooks\/weg\.mjs fehlt/);
  assert.match(r, /kaputt\.mjs:/);
  assert.match(r, /dyn\.mjs braucht aus \.\/lib\/b\.mjs: nichtDa/);
  rmSync(p, { recursive: true, force: true });
});

test('hooks-abschaltbar-settings-local: Schalter werden gemeldet', () => {
  const p = projekt({
    '.claude/settings.local.json': JSON.stringify({ disableAllHooks: true }),
    '.claude/settings.json': JSON.stringify({ env: { WRITE_GATE: '0' } }),
  });
  const w = schalter(p, leer.home, { SEARCH_GATE: '0' }).join('\n');
  assert.match(w, /settings\.local\.json: "disableAllHooks": true/);
  assert.match(w, /settings\.json: env\.WRITE_GATE=0/);
  assert.match(w, /Umgebung: SEARCH_GATE=0/);
  assert.deepEqual(schalter(projekt({}), leer.home, {}), []);
  rmSync(p, { recursive: true, force: true });
});

test('Export- und Import-Erkennung', () => {
  const ex = exporte('export function a() {}\nexport async function b() {}\nexport const c = 1;\nexport { d, e as f };\nexport default 1;\n');
  for (const n of ['a', 'b', 'c', 'd', 'f', 'default']) assert.ok(ex.has(n), n);
  assert.equal(ex.has('e'), false);
  assert.equal(exporte("export * from './x.mjs';\n"), null);
  const im = importe("import { readFileSync } from 'node:fs';\nimport {\n  a,\n  b as c,\n} from './x.mjs';\n");
  assert.deepEqual(im, [{ spec: './x.mjs', namen: ['a', 'b'] }]);
  // Beispiele in Kommentaren sind keine Importe
  assert.deepEqual(importe("// x = await import('./y.mjs')\n/* import { a } from './z.mjs'; */\n"), []);
  assert.deepEqual(importe("// x = await import('./y.mjs')\r\nconst a = 1;\r\n"), []);   // CRLF wie nach git checkout
});

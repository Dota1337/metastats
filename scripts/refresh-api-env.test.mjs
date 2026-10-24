// Waechter fuer die eigene Env-Datei von refresh-api (Sicherheitsdurchsicht
// 24.10.2026, geteilte-env-datei): der Dienst bekommt nur die Schluessel aus
// einer Positivliste. Die steht an zwei Stellen — ENV_KEYS in
// scripts/refresh-api-server.mjs (Lader beim Handstart) und KEYS im
// Hilfsskript infra/hetzner/metastats-refresh-api-env.sh (Unit-Start). Liest
// der Dienst oder eine seiner importierten Dateien einen weiteren Schluessel,
// fehlt er auf der Box still — deshalb hier der Abgleich gegen alle
// process.env-Zugriffe im Importbaum.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = resolve(ROOT, 'scripts/refresh-api-server.mjs');
const HELPER = resolve(ROOT, 'infra/hetzner/metastats-refresh-api-env.sh');
const UNIT = resolve(ROOT, 'infra/hetzner/metastats-refresh-api.service');
const lies = (f) => readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');

function serverKeys() {
  const m = lies(SERVER).match(/const ENV_KEYS = \[([^\]]*)\]/);
  assert.ok(m, 'ENV_KEYS fehlt in refresh-api-server.mjs');
  return [...m[1].matchAll(/'([A-Z0-9_]+)'/g)].map((x) => x[1]).sort();
}

function helperKeys() {
  const m = lies(HELPER).match(/^KEYS='([^']*)'/m);
  assert.ok(m, 'KEYS fehlt im Hilfsskript');
  return m[1].split('|').sort();
}

// Alle relativen Importe ab refresh-api-server.mjs, je Datei die gelesenen Schluessel.
function gelesen() {
  const keys = new Map();
  const dynamisch = [];
  const seen = new Set();
  const todo = [SERVER];
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const s = lies(f);
    for (const m of s.matchAll(/(?:from|import\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const p = resolve(dirname(f), m[1]);
      if (existsSync(p)) todo.push(p);
    }
    const rel = relative(ROOT, f).replace(/\\/g, '/');
    for (const m of s.matchAll(/process\.env(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/g)) {
      const k = m[1] || m[2];
      if (!keys.has(k)) keys.set(k, new Set());
      keys.get(k).add(rel);
    }
    // process.env[variable] laesst sich nicht pruefen — loadEnv selbst ist die Ausnahme.
    for (const m of s.matchAll(/process\.env\[(?!\s*['"])([^\]]*)\]/g)) {
      if (!(rel === 'scripts/refresh-api-server.mjs' && m[1].trim() === 'k')) dynamisch.push(`${rel}: process.env[${m[1]}]`);
    }
  }
  return { keys, dynamisch, dateien: seen.size };
}

test('Positivliste im Dienst und im Hilfsskript sind gleich', () => {
  assert.deepEqual(helperKeys(), serverKeys());
});

// Setzt systemd selbst beim Start, steht nie in einer Env-Datei.
const VON_SYSTEMD = ['CREDENTIALS_DIRECTORY'];

test('der Dienst liest keinen Schluessel ausserhalb der Positivliste', () => {
  const erlaubt = new Set([...serverKeys(), ...VON_SYSTEMD]);
  const { keys, dynamisch, dateien } = gelesen();
  assert.ok(dateien > 1, 'Importbaum nicht gefunden');
  const fremd = [...keys].filter(([k]) => !erlaubt.has(k)).map(([k, v]) => `${k} (${[...v].join(', ')})`);
  assert.deepEqual(fremd, [], `neuer Schluessel — in ENV_KEYS und im Hilfsskript ergaenzen: ${fremd.join('; ')}`);
  assert.deepEqual(dynamisch, [], 'dynamischer Zugriff auf process.env laesst sich nicht pruefen');
});

test('die Unit nutzt das Hilfsskript und sperrt die gemeinsame Datei', () => {
  const u = lies(UNIT);
  assert.match(u, /^ExecStartPre=\+\/usr\/local\/bin\/metastats-refresh-api-env\.sh$/m);
  assert.match(u, /^EnvironmentFile=-\/run\/metastats-refresh-api\/env$/m);
  assert.match(u, /^InaccessiblePaths=.*\/etc\/metastats-crawler(\s|$)/m);
  assert.doesNotMatch(u, /^EnvironmentFile=-?\/etc\/metastats-crawler\/env/m);
  assert.doesNotMatch(u, /^User=root$/m);
  const nutzer = u.match(/^User=(\S+)$/m)?.[1];
  assert.ok(nutzer, 'User= fehlt');
  assert.match(lies(resolve(ROOT, 'infra/hetzner/sysusers-metastats.conf')), new RegExp(`^u ${nutzer}\\s`, 'm'), `${nutzer} fehlt in sysusers-metastats.conf`);
});

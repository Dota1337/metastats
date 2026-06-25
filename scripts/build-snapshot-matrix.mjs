#!/usr/bin/env node
/**
 * Auto-generate app/lib/snapshot-matrix.generated.mjs aus app/lib/snapshot-matrix.ts.
 *
 * Architektur-Pattern: TS-SoT, MJS auto-generiert (Multi-Review 2026-06-25
 * Option C). publish-snapshot-bundle.mjs konsumiert die generierte .mjs und
 * NICHT die TS-Datei direkt — damit kein menschlicher Sync zwischen
 * TS-Konsumenten (Vercel-Routes) und MJS-Konsumenten (Hetzner-Publisher)
 * mehr nötig ist. Drift-Vektor = null.
 *
 * Trigger: manuell via `npm run build:snapshot-matrix`. Optional als
 * Pre-Push-Hook (siehe infra/git-hooks/pre-push) damit Commits nie mit
 * outdated generated-Datei landen.
 *
 * Output ist im Git committed — Hetzner-Box braucht nicht selbst tsc zu
 * laufen (auch wenn tsc dort verfügbar ist).
 *
 * Memory: reference_dual_module_patterns.md.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'app/lib/snapshot-matrix.ts');
const TMP_DIR = resolve(ROOT, 'app/lib/.tsc-tmp');
const TMP_OUT = resolve(TMP_DIR, 'snapshot-matrix.js');
const DST = resolve(ROOT, 'app/lib/snapshot-matrix.generated.mjs');

if (!existsSync(SRC)) {
  console.error(`SoT not found: ${SRC}`);
  process.exit(1);
}

// tsc in temp-Verzeichnis ausgeben (damit Next.js den .js-Build nicht parallel
// zur .ts-Datei in app/lib/ findet). Danach umschaufeln zu .generated.mjs.
const tscArgs = [
  'tsc',
  SRC,
  '--outDir', TMP_DIR,
  '--target', 'es2022',
  '--module', 'esnext',
  '--moduleResolution', 'bundler',
  '--skipLibCheck',
  '--declaration', 'false',
  '--allowSyntheticDefaultImports',
  '--esModuleInterop',
];

console.log(`[build:snapshot-matrix] tsc ${SRC}`);
const r = spawnSync('npx', tscArgs, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  cwd: ROOT,
});
if (r.status !== 0) {
  console.error(`[build:snapshot-matrix] tsc exited ${r.status}`);
  process.exit(r.status ?? 1);
}

if (!existsSync(TMP_OUT)) {
  console.error(`[build:snapshot-matrix] expected ${TMP_OUT} after tsc, not found`);
  process.exit(1);
}

const header = `// AUTO-GENERATED from app/lib/snapshot-matrix.ts — DO NOT EDIT.
// Regenerate via \`npm run build:snapshot-matrix\`.
// Architektur-Pattern: TS-SoT, MJS auto-generiert (Multi-Review 2026-06-25,
// Option C). Konsumiert von scripts/publish-snapshot-bundle.mjs.
// Memory: reference_dual_module_patterns.md.

`;
const code = readFileSync(TMP_OUT, 'utf8');
writeFileSync(DST, header + code);

// Aufräumen
rmSync(TMP_DIR, { recursive: true, force: true });

console.log(`[build:snapshot-matrix] OK → ${DST}`);
console.log(`[build:snapshot-matrix]    ${code.split('\n').length} lines`);

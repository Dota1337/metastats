// Pfad zu npm-cli.js neben dem laufenden Node.
//
// npm wird ueber process.execPath + npm-cli.js gestartet, nicht ueber `npx`
// oder `npm.cmd`: spawn ohne Shell kann .cmd auf Windows nicht starten
// (EINVAL), und mit Shell trifft ein Zeitlimit nur die cmd.exe, die
// Node-Enkel laufen als Waisen weiter (Riot-Key-Vorfall 2026-09-18).
//
// Nutzer: scripts/check-npm-audit.mjs, scripts/agentdb/install-deps.mjs.

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function npmCliCandidates() {
  const d = dirname(process.execPath);
  return [
    join(d, 'node_modules', 'npm', 'bin', 'npm-cli.js'),        // Windows-Installer
    join(d, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'), // Linux/macOS
  ];
}

/** Absoluter Pfad zu npm-cli.js oder null. */
export function findNpmCli() {
  const hit = npmCliCandidates().find((p) => existsSync(p));
  if (hit) return hit;
  // Rueckfall: unter `npm run` setzt npm selbst npm_execpath.
  const env = process.env.npm_execpath;
  if (env && /npm-cli\.js$/.test(env) && existsSync(env)) return env;
  return null;
}

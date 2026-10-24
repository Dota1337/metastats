#!/usr/bin/env node
// Ladepruefung der Disziplin-Hooks (Logik in lib/hook-load.mjs).
//
// Aufruf:  node scripts/hooks/check-hook-load.mjs [--json]
//   ohne --json  Klartext, Exit 1 bei Fehlern (Warnungen allein: Exit 0)
//   --json       { fehler, warnungen, geprueft } fuer session-start.mjs
//
// Laeuft beim Sitzungsstart als eigener Prozess: stirbt die Pruefung selbst,
// bleibt der Start-Hook stehen und meldet genau das.
import { pruefeHooks } from './lib/hook-load.mjs';

const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const r = pruefeHooks(projectDir);

if (process.argv.includes('--json')) {
  process.stdout.write(JSON.stringify(r));
  process.exit(0);
}

for (const w of r.warnungen) console.warn(`  WARNUNG: ${w}`);
if (r.fehler.length) {
  console.error('Disziplin-Hooks nicht ladbar:');
  for (const f of r.fehler) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`  Disziplin-Hooks ladbar (${r.geprueft} Dateien geprueft).`);

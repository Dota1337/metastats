#!/usr/bin/env node
/**
 * Pre-push-Gate 9: sind die Disziplin-Hooks noch da?
 *
 * Der Sinn der ganzen Konstruktion ist, dass sie NICHT stillschweigend
 * verschwinden kann. feedback_disable_gateguard.md zeigt das Muster: ein Hook,
 * der nervt, wird abgeschaltet — und danach erinnert sich niemand daran.
 * Deshalb: Abschalten ist erlaubt, aber es muss durch einen Commit gehen und
 * im Diff sichtbar sein.
 *
 * Geprueft wird:
 *   1. infra/claude-settings/hooks.json deklariert alle Pflicht-Events
 *   2. jedes referenzierte Script existiert
 *   3. die installierte .claude/settings.json ist nicht dahinter zurueck
 *      (sonst laeuft lokal etwas anderes als im Repo steht)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = 'infra/claude-settings/hooks.json';
// Runde 5 (2026-09-01): PreToolUse ist zurueck, jetzt als scripts/hooks/write-gate.mjs.
// Runde 4 (2026-08-18) hatte das alte plan-gate.mjs auf dreifache User-Anweisung
// entfernt, weil es mitten in freigegebener Arbeit blockte — die Freigabe-Erkennung
// war auf den Zeilenanfang verankert und „Code: Ja, entferne es" loeschte die
// Freigabe, statt sie zu erteilen. Beide Ursachen sind in prompt-submit.mjs
// behoben und in state.test.mjs festgenagelt. plan-gate.mjs ist geloescht; die
// Policy liegt in scripts/hooks/lib/gate-policy.mjs und ist testbar.
const REQUIRED = ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'PostCompact', 'Stop', 'PreToolUse'];
// Events, die auf JEDEN Tool-Call feuern wuerden, brauchen einen Matcher —
// sonst kostet ein 80-ms-Node-Start bei jedem Read und Grep.
const MATCHER_REQUIRED = ['PreToolUse', 'PostToolUse'];

const problems = [];

if (!existsSync(SRC)) {
  console.error(`${SRC} fehlt — die Hook-Quelle ist weg.`);
  process.exit(1);
}

const managed = JSON.parse(readFileSync(SRC, 'utf8')).hooks || {};

for (const ev of REQUIRED) {
  const entries = managed[ev];
  if (!Array.isArray(entries) || entries.length === 0) {
    problems.push(`${SRC}: Event ${ev} fehlt oder ist leer.`);
  }
}

for (const ev of MATCHER_REQUIRED) {
  for (const entry of managed[ev] || []) {
    if (!entry.matcher) problems.push(`${SRC}: ${ev} ohne matcher — feuert auf jeden Tool-Call.`);
  }
}

// Jedes referenzierte Script muss existieren — ein Hook auf eine geloeschte
// Datei ist eine Attrappe: er laeuft, tut nichts, und faellt nie auf.
const refs = new Set();
JSON.stringify(managed).replace(/scripts\/[A-Za-z0-9_./-]+\.mjs/g, (m) => { refs.add(m); return m; });
for (const r of refs) {
  if (!existsSync(r)) problems.push(`${SRC} referenziert ${r} — Datei existiert nicht.`);
}

// Drift zwischen Repo-Quelle und lokaler Installation.
const dst = join('.claude', 'settings.json');
if (!existsSync(dst)) {
  problems.push(`${dst} fehlt — Run: npm run setup-hooks`);
} else {
  let installed = {};
  try { installed = JSON.parse(readFileSync(dst, 'utf8')).hooks || {}; }
  catch { problems.push(`${dst} ist kein gueltiges JSON.`); }
  // Event-genau pruefen, nicht per String-Containment ueber die ganze Datei:
  // ein Hook, der unter dem falschen Event installiert ist, waere sonst gruen.
  // Bei einem Gate ist das die schlimmere Fehlerklasse — es faellt still offen
  // aus, ohne dass irgendetwas meldet, dass es nie gefeuert hat.
  for (const [ev, entries] of Object.entries(managed)) {
    const flatEv = JSON.stringify(installed[ev] || []);
    const evRefs = new Set();
    JSON.stringify(entries).replace(/scripts\/[A-Za-z0-9_./-]+\.mjs/g, (m) => { evRefs.add(m); return m; });
    for (const r of evRefs) {
      if (!flatEv.includes(r)) problems.push(`${dst}: ${r} fehlt unter ${ev} — Run: npm run setup-hooks`);
    }
  }
}

if (problems.length) {
  console.error('Disziplin-Hooks unvollstaendig:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('');
  console.error('Wenn das Abschalten gewollt ist: infra/claude-settings/hooks.json aendern,');
  console.error('scripts/check-discipline-hooks.mjs mit anpassen und beides committen.');
  process.exit(1);
}

console.log(`  Disziplin-Hooks vollstaendig (${REQUIRED.length} Events, ${refs.size} Scripts).`);

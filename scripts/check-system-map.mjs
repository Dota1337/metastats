#!/usr/bin/env node
/**
 * Prüft die generierte Systemkarte gegen den Code.
 *
 * Fängt die Fehlerklasse, die weder tsc noch ein Review sieht: eine Kette, die
 * ins Leere zeigt. Der Marktwert-Sync verschwand genau so — das aufrufende
 * Script lief nicht mehr, und niemand bemerkte, dass der Aufruf dadurch tot
 * war. Diese Prüfung ist statisch und offline, damit sie in pre-push und CI
 * laufen kann.
 *
 * Fehler (Exit 1):
 *   • ExecStart zeigt auf ein Script, das es im Repo nicht gibt
 *   • Unit-Referenz (OnSuccess/Conflicts/After/…) auf eine unbekannte Unit
 *   • ein Timer aktiviert einen Service, den es nicht gibt
 *   • Code startet eine Unit, die es nicht gibt
 *
 * Hinweise (Exit 0):
 *   • Scripts, die von nichts aufgerufen werden
 *   • Services ohne Laufzeit-Vertrag (Abdeckungslücke von infra/contracts.json)
 *
 * Usage: node scripts/check-system-map.mjs [--strict]
 *   --strict  lässt auch Hinweise fehlschlagen
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const STRICT = process.argv.includes('--strict');

// Units, die das Betriebssystem stellt — nicht im Repo und das ist korrekt.
const EXTERNAL_UNITS = new Set([
  'postgresql.service',
  'network-online.target',
  'systemd-networkd-wait-online.service',
]);

// Scripts, die bewusst nur manuell laufen (Ops-Werkzeuge, einmalige Migrationen).
// Bewusst kurz halten: jeder Eintrag hier ist eine Ausnahme von der Regel
// "jedes Script hat einen Aufrufer".
const MANUAL_ONLY = new Set([
  'scripts/db-exec.mjs',
  'scripts/build-system-map.mjs',
  'scripts/check-system-map.mjs',
]);

const map = JSON.parse(readFileSync(resolve(ROOT, 'infra', 'system-map.json'), 'utf8'));

const errors = [];
const notes = [];

const unitNames = new Set(map.units.map(u => u.name));
const knownUnit = (n) => unitNames.has(n) || EXTERNAL_UNITS.has(n);

// --- 1. ExecStart-Scripts existieren? ---------------------------------------
for (const u of map.units) {
  for (const s of u.scripts) {
    if (!existsSync(resolve(ROOT, s))) {
      errors.push(`${u.name}: ExecStart zeigt auf ${s} — Datei existiert nicht`);
    }
  }
}

// --- 2. Unit-Referenzen auflösbar? ------------------------------------------
for (const u of map.units) {
  for (const key of ['OnSuccess', 'OnFailure', 'Conflicts', 'Wants', 'After', 'Requires', 'Before']) {
    for (const target of u[key] || []) {
      if (!knownUnit(target)) {
        errors.push(`${u.name}: ${key}=${target} — Unit unbekannt (weder im Repo noch System-Unit)`);
      }
    }
  }
}

// --- 3. Timer aktiviert existierenden Service? ------------------------------
for (const t of map.units.filter(u => u.kind === 'timer')) {
  if (!knownUnit(t.activates)) {
    errors.push(`${t.name}: aktiviert ${t.activates} — Service existiert nicht`);
  }
  const planned = (t.onCalendar?.length || 0) + (t.interval?.length || 0);
  if (planned === 0) {
    errors.push(`${t.name}: weder OnCalendar noch Intervall — der Timer feuert nie`);
  }
}

// --- 4. Code startet existierende Units? ------------------------------------
for (const e of map.scriptEdges.filter(x => x.via === 'systemctl-start')) {
  if (!knownUnit(e.to)) {
    errors.push(`${e.from}: startet ${e.to} — Unit existiert nicht im Repo`);
  }
}

// --- 5. Scripts ohne Aufrufer ------------------------------------------------
const called = new Set();
for (const u of map.units) for (const s of u.scripts) called.add(s);
for (const w of map.workflows) for (const s of w.scripts) called.add(s);
for (const n of map.npmScripts) for (const s of n.scripts) called.add(s);
for (const e of map.scriptEdges) if (e.via === 'spawn') called.add(e.to);

const allScripts = readdirSync(resolve(ROOT, 'scripts'))
  .filter(f => f.endsWith('.mjs'))
  .map(f => `scripts/${f}`);
const orphans = allScripts.filter(s => !called.has(s) && !MANUAL_ONLY.has(s));

// Eine Liste aus 45 Zeilen liest niemand. Werkzeuge, die schon am Namen als
// Einmal-/Diagnose-Skript erkennbar sind, werden nur gezählt; übrig bleibt,
// was tatsächlich verwaist aussieht. Das Muster dient allein der Sortierung
// des Hinweises — es trifft keine Aussage über Korrektheit.
const TOOL_PREFIXES = /^scripts\/(test-|validate-|apply-|enrich-|fix-|import-|restore-|add-historical-|measure-|smoke-|verify-inflight)/;
const tools = orphans.filter(s => TOOL_PREFIXES.test(s));
const suspicious = orphans.filter(s => !TOOL_PREFIXES.test(s));

if (suspicious.length) {
  notes.push(`${suspicious.length} Scripts ohne Aufrufer (Unit/Workflow/npm/spawn):`);
  for (const o of suspicious) notes.push(`    ${o}`);
}
if (tools.length) {
  notes.push(`dazu ${tools.length} offensichtliche Ops-/Testwerkzeuge ohne Aufrufer (erwartbar)`);
}

// --- 6. Services ohne Laufzeit-Vertrag --------------------------------------
const owners = new Set(Object.keys(map.contractsByOwner));
const uncovered = map.units
  .filter(u => u.kind === 'service' && u.scripts.length && !owners.has(u.name))
  .map(u => u.name);
if (uncovered.length) {
  notes.push(`${uncovered.length} Services ohne Laufzeit-Vertrag in infra/contracts.json:`);
  for (const s of uncovered) notes.push(`    ${s}`);
}

// --- Ausgabe ----------------------------------------------------------------
if (errors.length) {
  console.log('FEHLER — kaputte Referenzen in der Systemkarte:');
  for (const e of errors) console.log(`  ${e}`);
  console.log('');
}
if (notes.length) {
  console.log('Hinweise:');
  for (const n of notes) console.log(`  ${n}`);
  console.log('');
}
if (!errors.length && !notes.length) console.log('Systemkarte konsistent.');
else console.log(`${errors.length} Fehler, ${notes.filter(n => !n.startsWith('    ')).length} Hinweis-Gruppen.`);

process.exit(errors.length || (STRICT && notes.length) ? 1 : 0);

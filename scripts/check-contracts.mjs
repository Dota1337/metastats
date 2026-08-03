#!/usr/bin/env node
/**
 * Prüft die Laufzeit-Verträge aus infra/contracts.json gegen die echten DBs.
 *
 * Der zentrale Lauf fängt den Fall ab, den ein Watchdog strukturell nicht
 * sehen kann: eine Pipeline, die gar nicht erst gestartet ist. Ein Watchdog
 * beobachtet Läufe — dieser Check beobachtet Ergebnisse.
 *
 * Usage:
 *   node scripts/check-contracts.mjs                 # alle
 *   node scripts/check-contracts.mjs --id marketvalue/supabase-mirror
 *   node scripts/check-contracts.mjs --owner metastats-daily-crawl.service
 *   node scripts/check-contracts.mjs --json
 *
 * Exit-Codes:
 *   0  alle geprüften Verträge erfüllt (Skips sind ok)
 *   1  mindestens ein Vertrag verletzt oder nicht prüfbar (Fehler)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  loadEnv, loadContracts, checkContract, closePools,
} from './lib/contracts.mjs';

const args = process.argv.slice(2);
const arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const JSON_OUT = args.includes('--json');
const ONLY_ID = arg('--id');
const ONLY_OWNER = arg('--owner');
const OUT_PATH = arg('--out');

loadEnv();

let contracts = loadContracts();
if (ONLY_ID) contracts = contracts.filter(c => c.id === ONLY_ID);
if (ONLY_OWNER) contracts = contracts.filter(c => c.owner === ONLY_OWNER);

if (contracts.length === 0) {
  console.error('Kein Vertrag passt zum Filter.');
  process.exit(1);
}

const results = [];
for (const c of contracts) results.push(await checkContract(c));
await closePools();

const broken = results.filter(r => r.status === 'broken');
const errored = results.filter(r => r.status === 'error');
const skipped = results.filter(r => r.status === 'skipped');
const ok = results.filter(r => r.status === 'ok');

const report = {
  checkedAt: new Date().toISOString(),
  summary: { ok: ok.length, broken: broken.length, error: errored.length, skipped: skipped.length },
  results,
};

if (OUT_PATH) {
  // Best-effort: ein nicht schreibbarer Statuspfad darf den Check nicht kippen.
  try {
    mkdirSync(dirname(OUT_PATH), { recursive: true });
    writeFileSync(OUT_PATH, JSON.stringify(report, null, 2));
  } catch (err) {
    console.error(`[warn] Status-Datei ${OUT_PATH} nicht schreibbar: ${err.message}`);
  }
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const mark = { ok: 'OK    ', broken: 'BRUCH ', error: 'FEHLER', skipped: 'skip  ' };
  const width = Math.max(...results.map(r => r.id.length));
  for (const r of results) {
    console.log(`${mark[r.status]} ${r.id.padEnd(width)}  ${r.detail}`);
  }
  console.log(
    `\n${ok.length} erfüllt · ${broken.length} verletzt · ` +
    `${errored.length} nicht prüfbar · ${skipped.length} übersprungen`,
  );
  if (broken.length || errored.length) {
    console.log('\nVerletzt:');
    for (const r of [...broken, ...errored]) {
      console.log(`  ${r.id}  (${r.owner})\n    ${r.detail}`);
    }
  }
}

process.exit(broken.length || errored.length ? 1 : 0);

#!/usr/bin/env node
/**
 * Misst, welcher Anteil der tatsächlich gespielten Comp-Familien einen
 * MetaTFT-Guide bekommt — gegen die DB, nicht gegen die Importdatei.
 *
 * Der Vorgänger (verify-comp-augments-coverage.mjs) maß gegen die redaktionelle
 * tftacademy-Slug-Map. Diese Datei misst gegen die generierte Familien-Map und
 * ersetzt ihn damit.
 *
 * Usage:
 *   node scripts/verify-metatft-family-coverage.mjs [--days 7] [--top 50]
 */

import pg from 'pg';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Gleicher .env.local-Parser wie im abgelösten Coverage-Check — das Repo hat
// kein dotenv als Dependency.
function readEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = readEnv();

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const days = Number(argVal('--days', 7));
const topN = Number(argVal('--top', 50));

const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL fehlt');
  process.exit(1);
}

// Passwort-Sonderzeichen in der URL encodieren (gleiches Muster wie im
// Vorgänger-Check, damit beide dieselben Connection-Strings vertragen).
function encodePasswordInPgUrl(url) {
  const m = /^(postgres(?:ql)?:\/\/[^:]+:)([^@]*)(@.*)$/.exec(url);
  if (!m) return url;
  return m[1] + encodeURIComponent(decodeURIComponent(m[2])) + m[3];
}

async function main() {
  const setJson = JSON.parse(readFileSync(resolve('public', 'tft-set.json'), 'utf8'));
  const set = Number(setJson.set ?? setJson.setNumber ?? setJson.current);
  const bundle = JSON.parse(readFileSync(resolve('public', `tft-metatft-comps-${set}.json`), 'utf8'));
  const familyMap = bundle.familyMap || {};

  console.log(`MetaTFT-Familien-Coverage: Top-${topN} Familien (Set ${set}, letzte ${days}d, master+)\n`);

  const client = new pg.Client({ connectionString: encodePasswordInPgUrl(DATABASE_URL) });
  await client.connect();
  // Die Aggregation steht in der DB (Migration 0054), nicht hier. Grund: der
  // Laufzeit-Vertrag `metatft-comps/familien-abdeckung` misst dieselbe Zahl von
  // der Box aus über PostgREST, und PostgREST kann kein GROUP BY mit
  // regexp_replace. Zwei Kopien derselben SQL wären garantiert irgendwann
  // uneinig darüber, was „abgedeckt" heisst.
  //
  // Was die Funktion normalisiert und warum das VOR dem GROUP BY passieren
  // muss, steht in der Migration. Kurzfassung: bis 2026-08-05 wurde das
  // `@<level>` erst hier in JS entfernt — also nach Aggregation und Top-N-Cut.
  // Jede Familie zählte einmal pro Trait-Level, `ManaTrait__Bard` stand mit
  // 5.325 und 3.845 doppelt in der Miss-Liste statt einmal mit 12.038, und das
  // Ergebnis war um +4,4 pp zu hoch (74,4 % statt 70,0 %).
  const r = await client.query(
    'SELECT family_key, total_games FROM get_metatft_family_coverage($1::int, $2::int, $3::int)',
    [days, set, topN],
  );
  await client.end();

  const matched = [];
  const missing = [];
  for (const row of r.rows) {
    // `family_key` ist bereits der Map-Schlüssel. Ein cluster_key ohne
    // `@<level>` bleibt unverändert und findet dann schlicht keinen Guide.
    if (familyMap[row.family_key]) matched.push({ ...row, cluster: familyMap[row.family_key] });
    else missing.push({ ...row });
  }

  const totalGames = r.rows.reduce((s, x) => s + Number(x.total_games), 0);
  const matchedGames = matched.reduce((s, x) => s + Number(x.total_games), 0);
  const distinctClusters = new Set(matched.map(x => x.cluster)).size;

  console.log(`  Familien getroffen : ${matched.length}/${r.rows.length}`);
  console.log(`  Volumen abgedeckt  : ${((matchedGames / totalGames) * 100).toFixed(1)} %`);
  console.log(`  distinkte Cluster  : ${distinctClusters} (je weniger, desto mehr Familien teilen sich einen Guide)`);

  if (missing.length) {
    console.log(`\n  ohne Guide (Top 15):`);
    for (const x of missing.slice(0, 15)) {
      console.log(`    ${String(x.total_games).padStart(7)}  ${x.family_key.replace(/(?:TFT\d*|Set\d+|DA)_(?:\d+_)?/g, '')}`);
    }
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

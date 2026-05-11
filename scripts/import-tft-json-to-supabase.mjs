#!/usr/bin/env node
// One-shot helper: writes an existing public/tft-stats-{region}.json into the
// Supabase daily-stats tables. Used to seed Day-1 data with the crawl we
// already have on disk; after this the regular daily crawler keeps the tables
// fresh.
//
// Usage:
//   node scripts/import-tft-json-to-supabase.mjs --region euw1
//   node scripts/import-tft-json-to-supabase.mjs --file public/tft-stats-euw1.json
//   node scripts/import-tft-json-to-supabase.mjs --region euw1 --day 2026-05-11

import { readFileSync, existsSync } from 'node:fs';
import { writeTftStatsToSupabase } from './lib/tft-supabase-writer.mjs';

const args = process.argv.slice(2);
const arg = (k, def) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : def; };

const region = (arg('--region', 'euw1') || 'euw1').toLowerCase();
const file = arg('--file', `public/tft-stats-${region}.json`);
const dayOverride = arg('--day');

if (!existsSync(file)) {
  console.error(`File not found: ${file}`);
  process.exit(1);
}

const payload = JSON.parse(readFileSync(file, 'utf8'));
// Day: caller can override, otherwise we use the crawl's collectedAt date,
// otherwise today.
const day = dayOverride
  || (payload.collectedAt ? new Date(payload.collectedAt).toISOString().slice(0, 10) : null)
  || new Date().toISOString().slice(0, 10);

console.log(`Importing ${file}`);
console.log(`  region=${region}  day=${day}  patch=${payload.patch}  set=${payload.set}`);
console.log(`  matches=${payload.matchesAnalyzed}  units=${Object.keys(payload.byUnit || {}).length}  items=${Object.keys(payload.byItem || {}).length}`);

writeTftStatsToSupabase({
  region,
  day,
  patch: payload.patch,
  setNumber: payload.set,
  payload,
}).then(() => {
  console.log('Done.');
}).catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});

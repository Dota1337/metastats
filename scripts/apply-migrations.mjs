#!/usr/bin/env node
// Apply a list of migration files (in order) against DATABASE_URL.
// Reads .env.local for DATABASE_URL. Uses pg with statement_timeout off so
// large DDL doesn't trip the pooler.
//
// Usage:
//   node scripts/apply-migrations.mjs 0016 0017 0018
//   node scripts/apply-migrations.mjs 0070_tft_region_divergence_anchor.sql   (bei doppelter Nummer)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

function readEnv() {
  const text = readFileSync('.env.local', 'utf8');
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

function parseDbUrl(url) {
  const m = /^postgresql:\/\/([^:]+):([^@]+)@([^:\/]+):(\d+)\/(.+)$/.exec(url);
  if (!m) throw new Error('Cannot parse DATABASE_URL');
  return { user: m[1], password: m[2], host: m[3], port: Number(m[4]), database: m[5] };
}

const env = readEnv();
const url = env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL missing in .env.local'); process.exit(1); }
const cfg = parseDbUrl(url);

const versions = process.argv.slice(2);
if (versions.length === 0) {
  console.error('Pass migration version prefixes, e.g. 0016 0017 0018');
  process.exit(1);
}

const client = new pg.Client({
  user: cfg.user, password: cfg.password, host: cfg.host, port: cfg.port,
  database: cfg.database,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 0,
});

// Ganzer Dateiname oder Nummer. Eine Nummer, die auf mehrere Dateien passt
// (0043, 0070 gibt es doppelt), bricht ab: vorher nahm das Skript still die
// erste, und wer 0070 meinte, bekam vielleicht die andere
// (Sicherheitsdurchsicht 24.10.2026). Aufgeloest wird alles VOR dem
// Verbinden, damit ein falsches Argument nicht nach halb eingespielter Liste
// auffaellt.
function resolveFile(v) {
  const dir = 'supabase/migrations';
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')
    && (f === v || f === `${v}.sql` || f.startsWith(`${v}_`)));
  if (files.length === 0) throw new Error(`keine Migration passt auf '${v}'`);
  if (files.length > 1) {
    throw new Error(`'${v}' passt auf ${files.length} Dateien (${files.join(', ')}) — `
      + 'den ganzen Dateinamen angeben');
  }
  return join(dir, files[0]);
}

async function main() {
  const targets = versions.map(resolveFile);
  console.log(`[connect] ${cfg.host}:${cfg.port}/${cfg.database}`);
  await client.connect();
  for (const file of targets) {
    console.log(`[apply]   ${file}`);
    const sql = readFileSync(file, 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('commit');
      console.log(`  OK`);
    } catch (e) {
      await client.query('rollback').catch(() => {});
      console.error(`  FAIL: ${e.message}`);
      throw e;
    }
  }
  await client.end();
  console.log('[done]');
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1); });

#!/usr/bin/env node
// Applies every migration in supabase/migrations/*.sql to the Supabase
// Postgres database. Idempotent — uses `create … if not exists` / `create
// policy` guards, so re-running it on an already-migrated DB is safe (the
// CREATE POLICY statements will error on duplicates; those errors are
// caught and reported but don't abort the run).
//
// Reads DATABASE_URL from .env.local (Postgres connection string from
// Supabase Studio → Project Settings → Database → Connection string).
// Falls back to the SUPABASE_DB_URL env var so CI can pass the secret
// without writing it to disk.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dirname, '..', 'supabase', 'migrations');

function readEnv() {
  const envPath = resolve(__dirname, '..', '.env.local');
  if (!existsSync(envPath)) return {};
  const env = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

async function main() {
  const env = { ...process.env, ...readEnv() };
  const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: SUPABASE_DB_URL (or DATABASE_URL) not set.');
    console.error('');
    console.error('Get the connection string from:');
    console.error('  Supabase Studio → Project Settings → Database → Connection string → URI');
    console.error('  Pick "Transaction Pooler" (the long one starting with `postgresql://postgres.<ref>:`).');
    console.error('Then add to .env.local:');
    console.error('  DATABASE_URL=postgresql://postgres.bwawxwgxxfafbruebixa:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres');
    process.exit(1);
  }

  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
  if (files.length === 0) {
    console.log('No migrations found.');
    return;
  }

  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`\n=== Applying ${file} ===`);
      // Split on semicolons but keep DO blocks intact. For our simple schema
      // a naive split is fine — none of the migrations use $$ delimiters.
      const statements = sql
        .split(/;\s*\n/)
        .map(s => s.trim())
        .filter(s => s && !s.startsWith('--'));
      for (const stmt of statements) {
        const firstLine = stmt.split('\n')[0].slice(0, 80);
        try {
          await client.query(stmt);
          console.log(`  ✓ ${firstLine}`);
        } catch (e) {
          // CREATE POLICY without IF NOT EXISTS errors on second run — that's
          // expected, log as warning and continue.
          if (/policy "[^"]+" for/i.test(e.message) && /already exists/i.test(e.message)) {
            console.log(`  ↻ ${firstLine} (already exists)`);
          } else {
            console.error(`  ✗ ${firstLine}`);
            console.error(`    ${e.message}`);
            throw e;
          }
        }
      }
    }
    console.log('\nDone.');
  } finally {
    await client.end();
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });

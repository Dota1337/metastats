#!/usr/bin/env node
// Runs a single .sql file against DATABASE_URL (Supabase Postgres),
// statement-by-statement, printing any rows returned. Unlike
// apply-supabase-migrations.mjs this does NOT re-run every migration — it
// executes exactly the file you pass, so it's safe for one-off DDL / perf
// migrations / diagnostics.
//
// Usage:
//   node scripts/db-exec.mjs supabase/migrations/0020_xxx.sql
//   node scripts/db-exec.mjs /tmp/diag.sql

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

// Supabase passwords often contain reserved URL chars (#, @, …). pg's URL
// parser rejects those unless percent-encoded, so re-encode the password.
function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const rest = after.slice(atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  const user = userinfo.slice(0, colonIdx);
  const pass = userinfo.slice(colonIdx + 1);
  return `${url.slice(0, schemeEnd + 3)}${user}:${encodeURIComponent(pass)}${rest}`;
}

// Zerlegt eine .sql-Datei in Einzel-Statements. Ein Semikolon trennt NUR,
// wenn es nicht in einem Kommentar, String-Literal oder $$-Block steht.
// Exportiert, damit scripts/test-db-exec-split.mjs das pruefen kann.
export function splitStatements(sql) {
  const statements = [];
  let buf = '';
  let dollarTag = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (dollarTag) {
      // Look for the matching closing dollar tag.
      if (c === '$' && sql.slice(i, i + dollarTag.length) === dollarTag) {
        buf += dollarTag;
        i += dollarTag.length - 1;
        dollarTag = null;
        continue;
      }
      buf += c;
      continue;
    }
    // `--` line comment: bis zum Zeilenende opak. Ohne das trennt ein
    // Semikolon IM Kommentar das Statement und der Rest landet als eigenes
    // "Statement" beim Server ("syntax error at or near ..."). Genau das ist
    // am 2026-08-02 mit Migration 0051 passiert.
    if (c === '-' && sql[i + 1] === '-') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      buf += sql.slice(i, end);
      i = end - 1;
      continue;
    }
    // `/* … */` Blockkommentar — dito. Postgres erlaubt Verschachtelung,
    // deshalb mitzaehlen statt beim ersten `*/` aufzuhoeren.
    if (c === '/' && sql[i + 1] === '*') {
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === '/' && sql[j + 1] === '*') { depth++; j += 2; continue; }
        if (sql[j] === '*' && sql[j + 1] === '/') { depth--; j += 2; continue; }
        j++;
      }
      buf += sql.slice(i, j);
      i = j - 1;
      continue;
    }
    // Einfach gequoteter String — ein Semikolon darin ist Nutzlast, kein
    // Trenner. '' innerhalb ist das SQL-Escape fuer ein Apostroph.
    if (c === "'") {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") { j++; break; }
        j++;
      }
      buf += sql.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === '$') {
      // Detect a `$tag$` opener.
      const rest = sql.slice(i);
      const m = rest.match(/^(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
      if (m) {
        dollarTag = m[1];
        buf += dollarTag;
        i += dollarTag.length - 1;
        continue;
      }
    }
    if (c === ';' && (sql[i + 1] === '\n' || sql[i + 1] === undefined || /\s/.test(sql[i + 1]))) {
      // Statement boundary — flush.
      statements.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) statements.push(buf);
  // Strip whole-line comments (the SQL parser ignores them, but they pollute
  // the headline preview we print per statement).
  const cleaned = statements
    .map(s => s.split('\n').filter(l => !l.trim().startsWith('--')).join('\n').trim())
    // Ein Rest, der nur noch aus einem Blockkommentar besteht, ist kein
    // Statement. Postgres nimmt es zwar klaglos an, aber es taucht als
    // sinnloses "0 rows" im Protokoll auf. Die Ersetzung dient NUR dem
    // Leer-Test — abgeschickt wird der unveraenderte Text.
    .filter(s => s.replace(/\/\*[\s\S]*?\*\//g, '').trim().length > 0);
  // BEKANNTE GRENZE: die `--`-Zeilenfilterung oben greift auch INNERHALB von
  // $$-Bloecken, entfernt dort also Kommentare aus dem gespeicherten
  // Funktionsrumpf. Fuer uns bisher folgenlos (unsere Funktionen tragen keine
  // Zeilenkommentare), aber beim naechsten Anlass sauber loesen statt hier
  // still weiterzuleben.
  // Re-bind for the loop below.
  statements.length = 0;
  for (const s of cleaned) statements.push(s);
  return statements;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('usage: node scripts/db-exec.mjs <file.sql>');
    process.exit(1);
  }
  const env = { ...process.env, ...readEnv() };
  const dbUrl = env.SUPABASE_DB_URL || env.DATABASE_URL;
  if (!dbUrl) { console.error('ERROR: DATABASE_URL not set'); process.exit(1); }

  const sql = readFileSync(resolve(file), 'utf8');
  const statements = splitStatements(sql);

  const client = new pg.Client({ connectionString: encodePasswordInPgUrl(dbUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  let failures = 0;
  try {
    for (const stmt of statements) {
      const head = stmt.split('\n')[0].slice(0, 90);
      try {
        const res = await client.query(stmt);
        if (Array.isArray(res.rows) && res.rows.length > 0) {
          console.log(`\n▶ ${head}`);
          console.dir(res.rows, { depth: null, maxArrayLength: 50 });
        } else {
          console.log(`✓ ${head}  (${res.rowCount ?? 0} rows)`);
        }
      } catch (e) {
        failures++;
        console.error(`✗ ${head}\n    ${e.message}`);
      }
    }
  } finally {
    await client.end();
  }
  console.log(`\nDone. ${statements.length} statement(s), ${failures} failure(s).`);
  if (failures > 0) process.exit(1);
}

// Nur ausfuehren, wenn direkt aufgerufen — der Import fuer den Splitter-Test
// (scripts/test-db-exec-split.mjs) darf keine DB-Verbindung aufmachen.
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
}

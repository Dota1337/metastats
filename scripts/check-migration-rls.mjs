#!/usr/bin/env node
// Waechter: jede Tabelle, die eine Migration in public anlegt, braucht in
// irgendeiner Migration `enable row level security`.
//
// Warum: am 2026-09-29 meldete Supabase vier Tabellen ohne Zeilenschutz
// (rls_disabled_in_public). Drei davon kamen aus 0067/0068 — dort wurde nur das
// Leserecht entzogen, RLS blieb aus. Ueber den Anon-Schluessel, der im Browser
// steht, waren sie damit beschreibbar und leerbar. 0079 hat das behoben; dieser
// Check verhindert, dass die naechste Migration dasselbe noch einmal tut.
//
// Rein textlich, bewusst grob: er liest supabase/migrations/*.sql in
// Reihenfolge, merkt sich angelegte, geloeschte und umbenannte Tabellen und
// jede RLS-Einschaltung. Was nach der letzten Migration angelegt, nicht
// geloescht und nie geschuetzt ist, ist rot. Die Live-Pruefung der echten
// Datenbank macht der taegliche Vertrag sicherheit/anon-lockout
// (security_anon_leaks, seit 0079 auch fuer Schreibrechte).

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join('supabase', 'migrations');

// Tabellennamen: optional public., optional in Anfuehrungszeichen.
const NAME = String.raw`(?:public\.)?"?([a-z_][a-z0-9_]*)"?`;
const CREATE = new RegExp(String.raw`create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?` + NAME + String.raw`\s*(?:\(|partition\s+of|as\b)`, 'gi');
const TEMP = /create\s+(?:temp|temporary)\s+table/i;
const OTHER_SCHEMA = /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?"?(?!public\b)[a-z_]+"?\."?[a-z_]/i;
const RLS = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?` + NAME + String.raw`\s+enable\s+row\s+level\s+security`, 'gi');
const DROP = new RegExp(String.raw`drop\s+table\s+(?:if\s+exists\s+)?` + NAME, 'gi');
const RENAME = new RegExp(String.raw`alter\s+table\s+(?:if\s+exists\s+)?` + NAME + String.raw`\s+rename\s+to\s+"?([a-z_][a-z0-9_]*)"?`, 'gi');

// Kommentare raus, damit ein auskommentiertes `enable row level security`
// nicht zaehlt.
const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

const created = new Map();   // name -> Migration, in der sie angelegt wurde
const protectedTables = new Set();

// Migrationen, die nur auf der Hetzner-Datenbank laufen, erreicht der
// Anon-Schluessel nicht (dort gibt es keine oeffentliche REST-Schnittstelle).
// Sie tragen den Marker im Kopf, z. B. 0046.
const HETZNER_ONLY = /HETZNER-LOCAL-PG ONLY/;

const files = readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();
for (const f of files) {
  const raw = readFileSync(join(DIR, f), 'utf8');
  if (HETZNER_ONLY.test(raw)) continue;
  const sql = stripComments(raw);
  // Anweisungen einzeln, damit temp/andere Schemata sauber rausfallen.
  for (const stmt of sql.split(';')) {
    if (TEMP.test(stmt) || OTHER_SCHEMA.test(stmt)) continue;
    for (const m of stmt.matchAll(CREATE)) {
      const name = m[1].toLowerCase();
      if (!created.has(name)) created.set(name, f);
    }
  }
  for (const m of sql.matchAll(RLS)) protectedTables.add(m[1].toLowerCase());
  for (const m of sql.matchAll(DROP)) { created.delete(m[1].toLowerCase()); protectedTables.delete(m[1].toLowerCase()); }
  for (const m of sql.matchAll(RENAME)) {
    const [from, to] = [m[1].toLowerCase(), m[2].toLowerCase()];
    if (created.has(from)) { created.set(to, created.get(from)); created.delete(from); }
    if (protectedTables.delete(from)) protectedTables.add(to);
  }
}

const missing = [...created].filter(([name]) => !protectedTables.has(name));
if (missing.length > 0) {
  console.error(`[migration-rls] ${missing.length} Tabelle(n) ohne Zeilenschutz:`);
  for (const [name, f] of missing) console.error(`  ${name}  (angelegt in ${f})`);
  console.error('  Fix: in der Migration `alter table public.<name> enable row level security;`'
    + ' plus `revoke all on public.<name> from anon, authenticated;`');
  process.exit(1);
}
console.log(`[migration-rls] ok — ${created.size} Tabellen, alle mit Zeilenschutz.`);

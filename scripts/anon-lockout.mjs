#!/usr/bin/env node
// Notfall-Sperre: nimmt den oeffentlichen Rollen (anon, authenticated) jedes
// Recht in public, das sie nicht haben sollen. Nur Rechte — keine Tabelle,
// keine Spalte, keine Zeile wird angefasst.
//
// Wann: der Vertrag sicherheit/anon-lockout (infra/contracts.json) ist rot,
// d. h. eine Migration oder ein Klick in Supabase Studio hat ein Recht
// zurueckgeholt. Vorher stand an dieser Stelle "0055 erneut anwenden" — das
// scheitert seit Wochen, weil 0055 zwoelf Funktionen beim Namen nennt, die es
// nicht mehr gibt (Sicherheitsdurchsicht 24.10.2026). Dieses Skript ruft
// public.security_anon_lockdown() aus Migration 0104 — dieselbe Funktion, die
// die Migration selbst benutzt. Sie nennt keine Namen, fragt den Katalog, was
// heute da ist, und laeuft deshalb beliebig oft:
//   - jede Tabelle, Sicht und Sequenz in public: alle Rechte von anon weg, von
//     authenticated auch — ausser SELECT/INSERT/UPDATE/DELETE auf matches
//     (Owner-Policies player_id = auth.uid())
//   - jede Funktion in public, die anon oder authenticated aufrufen darf:
//     service_role bekommt EXECUTE ausdruecklich, dann weg fuer PUBLIC/anon/authenticated
//   - Standardrechte fuer neue Funktionen: kein EXECUTE fuer PUBLIC/anon/authenticated
//   - zum Schluss Nachpruefen ueber security_anon_leaks(), sonst Abbruch
//
// Standard ist ein Probelauf: alles in einer Transaktion, Ergebnis messen,
// ROLLBACK. Erst --apply schreibt.
//
//   node scripts/anon-lockout.mjs           # Probelauf, zeigt, was sich aendern wuerde
//   node scripts/anon-lockout.mjs --apply   # wirklich sperren
//
// Verbindung: DATABASE_URL aus .env.local, sonst SUPABASE_DB_URL aus der Umgebung.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

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

// Supabase-Passwoerter enthalten oft #, @ … — wie in db-exec.mjs neu kodieren.
function encodePasswordInPgUrl(url) {
  const schemeEnd = url.indexOf('://');
  if (schemeEnd < 0) return url;
  const after = url.slice(schemeEnd + 3);
  const atIdx = after.lastIndexOf('@');
  if (atIdx < 0) return url;
  const userinfo = after.slice(0, atIdx);
  const colonIdx = userinfo.indexOf(':');
  if (colonIdx < 0) return url;
  return `${url.slice(0, schemeEnd + 3)}${userinfo.slice(0, colonIdx)}:`
    + `${encodeURIComponent(userinfo.slice(colonIdx + 1))}${after.slice(atIdx)}`;
}

// Die Sperre selbst steht in der Datenbank (public.security_anon_lockdown aus
// Migration 0104) — eine Quelle fuer Migration und Notfall. Sie prueft am Ende
// selbst nach und bricht ab, wenn ausser authenticated auf matches noch etwas
// offen ist.
const LOCKOUT = 'select public.security_anon_lockdown() as n';

// Alle Rechte der oeffentlichen Rollen in public als flache Liste — vorher und
// nachher verglichen ergibt das, was die Sperre geaendert hat.
const SNAPSHOT = `
select coalesce(json_agg(k order by k), '[]') as j from (
  select 'rel ' || c.relname || ' ' || r.rolname || ' ' || a.privilege_type as k
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(c.relacl) a
  join pg_roles r on r.oid = a.grantee
  where n.nspname = 'public' and r.rolname in ('anon', 'authenticated')
  union all
  select 'fn ' || p.oid::regprocedure::text || ' ' || r.rolname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join (select rolname from pg_roles where rolname in ('anon', 'authenticated')) r
  where n.nspname = 'public' and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
) x`;

async function main() {
  const env = { ...process.env, ...readEnv() };
  const dbUrl = env.DATABASE_URL || env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('DATABASE_URL (.env.local) oder SUPABASE_DB_URL fehlt.');
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: encodePasswordInPgUrl(dbUrl), ssl: { rejectUnauthorized: false } });
  await client.connect();
  let committed = false;
  try {
    await client.query('begin');
    await client.query(`set local lock_timeout = '5s'`);
    await client.query(`set local statement_timeout = '60s'`);
    const before = (await client.query(SNAPSHOT)).rows[0].j;
    const vorhanden = (await client.query(
      "select to_regprocedure('public.security_anon_lockdown()') is not null as da")).rows[0].da;
    if (!vorhanden) {
      throw new Error('public.security_anon_lockdown() fehlt — zuerst Migration 0104 einspielen '
        + '(node scripts/apply-migrations.mjs 0104)');
    }
    const n = (await client.query(LOCKOUT)).rows[0].n;
    if (n === -1) throw new Error('keine Rollen anon/authenticated — das ist nicht die Supabase-Datenbank');
    const after = (await client.query(SNAPSHOT)).rows[0].j;
    const removed = before.filter((k) => !after.includes(k));

    console.log(`Rechte der oeffentlichen Rollen in public: vorher ${before.length}, nachher ${after.length}.`);
    for (const k of removed.slice(0, 40)) console.log(`  weg: ${k}`);
    if (removed.length > 40) console.log(`  … und ${removed.length - 40} weitere`);
    console.log('Bleibt (gewollt, nur authenticated auf matches):');
    for (const k of after) console.log(`  ${k}`);
    const unexpected = after.filter((k) => !k.startsWith('rel matches authenticated '));
    if (unexpected.length) {
      throw new Error(`nach der Sperre noch ${unexpected.length} Rechte ausserhalb davon — nichts geschrieben`);
    }

    if (APPLY) {
      await client.query('commit');
      committed = true;
      await client.query(`notify pgrst, 'reload schema'`);
      console.log(removed.length ? `GESPERRT: ${removed.length} Rechte entzogen.` : 'Nichts zu tun — alles war schon gesperrt.');
    } else {
      console.log(`PROBELAUF: ${removed.length} Rechte wuerden entzogen. Nichts geschrieben (ROLLBACK). Mit --apply wirklich sperren.`);
    }
  } finally {
    if (!committed) await client.query('rollback').catch(() => {});
    await client.end();
  }
}

main().catch((e) => {
  console.error('FEHLER:', e.message);
  process.exit(1);
});

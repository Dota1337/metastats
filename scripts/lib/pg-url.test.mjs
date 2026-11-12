/**
 * Tests fuer die Wahl der Supabase-Verbindung.
 *
 * Warum: Auf der Box zeigt DATABASE_URL auf die Hetzner-PG, nur SUPABASE_DB_URL
 * auf Supabase. Ein Skript, das die Tagesstatistik umschreibt und dabei die
 * falsche Datenbank erwischt, scheitert im besten Fall laut — im schlechtesten
 * schreibt es in Tabellen gleichen Namens, die niemand liest.
 *
 * Lauf: npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  applyStatementTimeout, encodePasswordInPgUrl, pgStatementTimeout, pgUrlHost, supabasePgUrl,
} from './pg-url.mjs';

const POOLER = 'postgresql://postgres.abc:geheim@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
const DIRECT = 'postgresql://postgres:geheim@db.abcdefgh.supabase.co:5432/postgres';
const HETZNER = 'postgresql://crawler:geheim@127.0.0.1:5432/metastats';

test('SUPABASE_DB_URL gewinnt, auch wenn DATABASE_URL auf die Hetzner-PG zeigt (Box)', () => {
  assert.equal(supabasePgUrl({ SUPABASE_DB_URL: POOLER, DATABASE_URL: HETZNER }), POOLER);
});

test('nur DATABASE_URL: Supabase-Pooler und Direkt-Host werden genommen (lokal)', () => {
  assert.equal(supabasePgUrl({ DATABASE_URL: POOLER }), POOLER);
  assert.equal(supabasePgUrl({ DATABASE_URL: DIRECT }), DIRECT);
  assert.equal(supabasePgUrl({ DATABASE_URL: POOLER.replace('pooler.supabase.com', 'POOLER.SUPABASE.COM') }),
    POOLER.replace('pooler.supabase.com', 'POOLER.SUPABASE.COM'));
});

test('nur DATABASE_URL auf die Hetzner-PG: Fehler mit Host, ohne Passwort', () => {
  assert.throws(() => supabasePgUrl({ DATABASE_URL: HETZNER }), (err) => {
    assert.match(err.message, /127\.0\.0\.1/);
    assert.match(err.message, /SUPABASE_DB_URL setzen/);
    assert.doesNotMatch(err.message, /geheim/);
    return true;
  });
});

test('Hosts, die nur so aussehen wie Supabase, werden abgelehnt', () => {
  for (const host of ['supabase.com.evil.example', 'notsupabase.com', 'supabase.company', 'pooler.supabase.com.']) {
    assert.throws(() => supabasePgUrl({ DATABASE_URL: `postgresql://u:geheim@${host}:5432/postgres` }),
      /zeigt nicht auf Supabase/, host);
  }
});

test('nichts gesetzt oder nur Leerzeichen: Fehler', () => {
  assert.throws(() => supabasePgUrl({}), /weder SUPABASE_DB_URL noch DATABASE_URL/);
  assert.throws(() => supabasePgUrl({ SUPABASE_DB_URL: '   ', DATABASE_URL: '' }), /weder SUPABASE_DB_URL noch DATABASE_URL/);
  // Leerzeichen-SUPABASE_DB_URL faellt auf die Pruefung von DATABASE_URL zurueck.
  assert.throws(() => supabasePgUrl({ SUPABASE_DB_URL: ' ', DATABASE_URL: HETZNER }), /zeigt nicht auf Supabase/);
});

test('SUPABASE_DB_URL ohne Host wird nicht still benutzt', () => {
  assert.throws(() => supabasePgUrl({ SUPABASE_DB_URL: 'kaputt' }), /keine Postgres-URL/);
  assert.throws(() => supabasePgUrl({ SUPABASE_DB_URL: 'postgresql://u:p@:5432/x' }), /keine Postgres-URL/);
});

test('Passwort mit @ / # wird kodiert, der Host trotzdem richtig erkannt', () => {
  const raw = 'postgresql://postgres.abc:p@ss/w#rd@aws-1-eu-west-1.pooler.supabase.com:5432/postgres';
  assert.equal(pgUrlHost(raw), 'aws-1-eu-west-1.pooler.supabase.com');
  assert.equal(supabasePgUrl({ DATABASE_URL: raw }),
    'postgresql://postgres.abc:p%40ss%2Fw%23rd@aws-1-eu-west-1.pooler.supabase.com:5432/postgres');
  // Bereits kodiert bleibt gleich (kein doppeltes Kodieren).
  assert.equal(encodePasswordInPgUrl(supabasePgUrl({ DATABASE_URL: raw })), supabasePgUrl({ DATABASE_URL: raw }));
});

test('pgUrlHost: Port, Pfad, Abfrage und IPv6', () => {
  assert.equal(pgUrlHost('postgres://u:p@Host.Example:6543/db?sslmode=require'), 'host.example');
  assert.equal(pgUrlHost('postgres://host.example'), 'host.example');
  assert.equal(pgUrlHost('postgres://u:p@[::1]:5432/db'), '[::1]');
  assert.equal(pgUrlHost('kein-schema'), null);
  assert.equal(pgUrlHost(undefined), null);
});

// --- Zeitgrenze per SET (der Supabase-Pooler verwirft die pg-Option) ---------

// Falscher pg-Client fuer pg-pool: zeichnet jede Abfrage auf, beantwortet sie
// per Callback oder Promise (pg-pool nutzt Callbacks, der Haken await).
function fakeClientClass(log, { failSetConfig = false } = {}) {
  return class FakeClient extends EventEmitter {
    // pg-pool gibt nur Clients mit _queryable && !_ending zur Wiederverwendung frei.
    _queryable = true;
    _ending = false;
    connect(cb) { setImmediate(() => cb(null)); }
    query(text, values, cb) {
      if (typeof values === 'function') { cb = values; values = undefined; }
      const sql = typeof text === 'string' ? text : text.text;
      log.push(/set_config\('statement_timeout'/.test(sql) ? `SET ${values?.[0]}` : sql);
      const err = failSetConfig && /set_config/.test(sql) ? new Error('SET kaputt') : null;
      const res = { rows: [], rowCount: 0 };
      if (cb) { setImmediate(() => cb(err, err ? undefined : res)); return undefined; }
      return err ? Promise.reject(err) : Promise.resolve(res);
    }
    end(cb) { if (cb) setImmediate(cb); return Promise.resolve(); }
  };
}

test('pgStatementTimeout: SET laeuft je neuer Verbindung VOR der ersten Abfrage', async () => {
  const log = [];
  const pool = new pg.Pool({ Client: fakeClientClass(log), max: 1, ...pgStatementTimeout(600_000) });
  await pool.query('select 1');
  await pool.query('select 2'); // gleiche Verbindung: kein zweites SET
  assert.deepEqual(log, ['SET 600000', 'select 1', 'select 2']);
  await pool.end();
});

test('pgStatementTimeout: scheitert das SET, scheitert die Abfrage laut (nicht still 2 min)', async () => {
  const log = [];
  const pool = new pg.Pool({ Client: fakeClientClass(log, { failSetConfig: true }), max: 1, ...pgStatementTimeout(300_000) });
  await assert.rejects(pool.query('select 1'), /SET kaputt/);
  assert.ok(!log.includes('select 1'), 'die eigentliche Abfrage darf ohne Grenze nicht laufen');
  await pool.end();
});

test('applyStatementTimeout: Einzel-Client bekommt den Wert als Parameter', async () => {
  const calls = [];
  await applyStatementTimeout({ query: async (sql, params) => { calls.push([sql, params]); } }, 240_000);
  assert.deepEqual(calls, [["select set_config('statement_timeout', $1, false)", ['240000']]]);
});

test('ungueltige Grenzen werfen sofort', async () => {
  for (const bad of [0, -1, 1.5, '600000', NaN, undefined]) {
    assert.throws(() => pgStatementTimeout(bad), /positive ganze Zahl/, String(bad));
    await assert.rejects(applyStatementTimeout({ query: async () => {} }, bad), /positive ganze Zahl/);
  }
});

// Waechter: in Skripten, die Supabase ansprechen, wirkt eine pg-Option ueber
// 2 min nicht (Pooler verwirft sie) — sie wuerde nur so tun als ob. Unter 2 min
// ist sie heute still wirkungslos, aber kein Ausfall (bewusst nicht verboten,
// Plan 12.11.2026 Punkt 4A).
test('Waechter: keine pg-Option statement_timeout > 120 s (oder 0) in Supabase-Skripten', () => {
  const scriptsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(d, e.name))) : [join(d, e.name)]);
  const bad = [];
  let seen = 0;
  for (const f of walk(scriptsDir).filter((f) => /\.(mjs|js|cjs)$/.test(f) && !f.endsWith('pg-url.test.mjs'))) {
    const src = readFileSync(f, 'utf8');
    if (!/supabasePgUrl|SUPABASE_DB_URL/.test(src)) continue;
    for (const m of src.matchAll(/statement_timeout\s*:\s*([0-9_]+)/g)) {
      seen++;
      const v = Number(m[1].replace(/_/g, ''));
      if (v === 0 || v > 120_000) bad.push(`${f}: ${m[1]}`);
    }
  }
  assert.ok(seen > 0, 'Waechter findet gar keine Option mehr — Muster pruefen');
  assert.deepEqual(bad, [], 'statt der Option pgStatementTimeout/applyStatementTimeout aus pg-url.mjs nutzen');
});

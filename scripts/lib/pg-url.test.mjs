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
import { encodePasswordInPgUrl, pgUrlHost, supabasePgUrl } from './pg-url.mjs';

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

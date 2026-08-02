#!/usr/bin/env node
// Regressionstest fuer den Statement-Splitter aus scripts/db-exec.mjs.
//
// Anlass: Migration 0051 hatte ein Semikolon in einem `--`-Kommentar. Der
// Splitter trennte dort, das halbe Statement ging als eigenes Statement an
// den Server -> "syntax error at or near ...". Auf der Box faellt das nicht
// auf, weil dort `psql -f` laeuft — der Bug traf nur den Supabase-Pfad.
//
// Ein Semikolon trennt NUR, wenn es nicht in einem Zeilenkommentar, einem
// Blockkommentar, einem String-Literal oder einem $$-Block steht.

import { splitStatements } from './db-exec.mjs';
import { readFileSync, existsSync } from 'node:fs';

let failed = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  console.log(`  ${ok ? 'OK  ' : 'FAIL'} ${name}${ok ? '' : `  (erwartet ${expected}, war ${actual})`}`);
  if (!ok) failed++;
}

console.log('=== splitStatements ===');

check('zwei einfache Statements',
  splitStatements('select 1;\nselect 2;\n').length, 2);

check('Semikolon im Zeilenkommentar trennt NICHT',
  splitStatements('-- Hinweis: a; b\nselect 1;\n').length, 1);

check('Semikolon im Blockkommentar trennt NICHT',
  splitStatements('/* a; b */\nselect 1;\n').length, 1);

check('verschachtelter Blockkommentar',
  splitStatements('/* aussen /* innen; */ noch aussen; */\nselect 1;\n').length, 1);

check('Semikolon im String-Literal trennt NICHT',
  splitStatements("select 'a;b' as x;\n").length, 1);

check('escapetes Apostroph im String',
  splitStatements("select 'it''s a; test' as x;\n").length, 1);

check('Semikolons im $$-Block trennen NICHT',
  splitStatements('create function f() returns int language sql as $$ select 1; $$;\n').length, 1);

check('benannter $tag$-Block',
  splitStatements('create function g() returns int language sql as $body$ select 1; select 2; $body$;\n').length, 1);

check('Kommentar zwischen zwei Statements',
  splitStatements('select 1;\n-- dazwischen; mit Semikolon\nselect 2;\n').length, 2);

check('Statement ohne abschliessendes Semikolon',
  splitStatements('select 1').length, 1);

check('nur Kommentare -> keine Statements',
  splitStatements('-- nur; ein Kommentar\n/* und; noch einer */\n').length, 0);

// Der konkrete Ausloeser: die echte Migration muss genau 2 Statements ergeben
// (alter table + comment on column).
console.log('=== Regression: Migration 0051 ===');
const mig = 'supabase/migrations/0051_tft_mv_games_played.sql';
if (existsSync(mig)) {
  check('0051 ergibt 2 Statements', splitStatements(readFileSync(mig, 'utf8')).length, 2);
} else {
  console.log('  SKIP (Datei nicht gefunden)');
}

// Gegenprobe: dieselbe Datei mit einem Semikolon im Kommentar haette frueher
// zerrissen — jetzt nicht mehr.
console.log('=== Gegenprobe: Semikolon im Kommentar einer echten Migration ===');
check('kuenstliches ";" im Kommentar bleibt harmlos',
  splitStatements('-- Spalte X; siehe Ticket\nalter table t add column c int;\n').length, 1);

console.log('');
if (failed > 0) { console.error(`=== ${failed} FEHLER ===`); process.exit(1); }
console.log('=== alle Tests gruen ===');
